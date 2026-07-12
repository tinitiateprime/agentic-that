import type { Config, Context } from "@netlify/functions";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createTelegramHttpServer } from "../../integrations/telegram/src/server.ts";

type LocalServer = {
  origin: string;
  server: Server;
};

let localServerPromise: Promise<LocalServer> | null = null;

async function getLocalServer() {
  process.env.SERVERLESS = "true";
  process.env.DATA_STORE ||= "netlify-blobs";

  localServerPromise ??= (async () => {
    const server = await createTelegramHttpServer({ startListeners: false });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address() as AddressInfo;
    return {
      origin: `http://127.0.0.1:${address.port}`,
      server
    };
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

export default async function handler(request: Request, _context: Context) {
  const local = await getLocalServer();
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, local.origin);
  const headers = new Headers(request.headers);

  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));

  const response = await fetch(targetUrl, {
    body: await requestBody(request),
    headers,
    method: request.method,
    redirect: "manual"
  });

  return new Response(response.body, {
    headers: responseHeaders(response.headers),
    status: response.status,
    statusText: response.statusText
  });
}

export const config: Config = {
  path: "/v1/*"
};
