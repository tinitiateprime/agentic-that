import { createServer, type IncomingMessage } from "node:http";
import { handleFacebookRequest } from "./api.ts";

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const server = createServer(async (incoming, outgoing) => {
  const method = incoming.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await requestBody(incoming);
  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) requestHeaders.set(key, value.join(", "));
    else if (value) requestHeaders.set(key, value);
  }
  const host = incoming.headers.host || "127.0.0.1:8793";
  const response = await handleFacebookRequest(new Request(new URL(incoming.url || "/", `http://${host}`), { method, body, headers: requestHeaders }));
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});

const port = Number(process.env.FACEBOOK_SERVICE_PORT || 8793);
server.listen(port, "127.0.0.1", () => console.log(`Facebook scraper API listening on http://127.0.0.1:${port}`));
