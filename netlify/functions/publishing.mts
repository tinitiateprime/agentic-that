import type { Config } from "@netlify/functions";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

type LocalServer = {
  origin: string;
  server: Server;
};

let localServerPromise: Promise<LocalServer> | null = null;

function publishingPath(pathname: string) {
  if (pathname.startsWith("/api/publishing")) {
    return "/api" + pathname.slice("/api/publishing".length);
  }
  if (pathname.startsWith("/publishing/uploads")) {
    return "/uploads" + pathname.slice("/publishing/uploads".length);
  }
  return pathname;
}

function configuredExternalOrigin(incomingUrl: URL) {
  const configured = process.env.PUBLISH_QUEUE_API_URL?.trim();
  if (!configured) return null;

  try {
    const target = new URL(configured);
    const siteOrigin = process.env.URL ? new URL(process.env.URL).origin : "";
    if (target.origin === incomingUrl.origin || target.origin === siteOrigin) return null;
    return target.origin;
  } catch {
    return null;
  }
}

async function getLocalServer() {
  process.env.SERVERLESS = "true";
  process.env.DATA_STORE ||= "netlify-blobs";
  process.env.PUBLISH_QUEUE_DATA_PATH ||= "/tmp/agentic-that-publishing/store.json";
  process.env.PUBLISH_QUEUE_UPLOAD_DIR ||= "/tmp/agentic-that-publishing/uploads";
  process.env.UPLOAD_DIR ||= process.env.PUBLISH_QUEUE_UPLOAD_DIR;

  localServerPromise ??= (async () => {
    const { createPublishingHttpServer } = await import("../../services/publishing/queue-runner/server/index.ts");
    const server = createPublishingHttpServer({
      host: "127.0.0.1",
      port: 0,
      startBackgroundServices: false,
    });
    await new Promise<void>((resolve, reject) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once("listening", resolve);
      server.once("error", reject);
    });

    const address = server.address() as AddressInfo;
    return { origin: `http://127.0.0.1:${address.port}`, server };
  })();

  return localServerPromise;
}

function requestBody(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  return request.arrayBuffer();
}

function responseHeaders(headers: Headers) {
  const output = new Headers(headers);
  output.delete("connection");
  output.delete("content-encoding");
  output.delete("content-length");
  output.delete("keep-alive");
  output.delete("transfer-encoding");
  return output;
}

export default async function handler(request: Request) {
  try {
    const incomingUrl = new URL(request.url);
    const path = publishingPath(incomingUrl.pathname) + incomingUrl.search;
    const externalOrigin = configuredExternalOrigin(incomingUrl);
    const targetOrigin = externalOrigin || (await getLocalServer()).origin;
    const headers = new Headers(request.headers);

    headers.set("x-forwarded-host", incomingUrl.host);
    headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));

    const response = await fetch(new URL(path, targetOrigin), {
      body: await requestBody(request),
      headers,
      method: request.method,
      redirect: "manual",
    });

    return new Response(response.body, {
      headers: responseHeaders(response.headers),
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    console.error("Publishing API failed", error);
    return Response.json({
      message: error instanceof Error ? error.message : "Publish Queue Runner is unavailable.",
    }, { status: 500 });
  }
}

export const config: Config = {
  path: ["/api/publishing/*", "/publishing/uploads/*"],
  memory: 1024,
};
