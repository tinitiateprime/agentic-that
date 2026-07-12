import { createServer, type IncomingMessage } from "node:http";
import { handleInstagramRequest } from "./api.ts";

async function bodyBuffer(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function requestUrl(request: IncomingMessage) {
  const host = request.headers.host || "127.0.0.1:8791";
  return new URL(request.url || "/", `http://${host}`).toString();
}

const server = createServer(async (incoming, outgoing) => {
  const method = incoming.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await bodyBuffer(incoming);
  const headers = new Headers();

  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value) headers.set(key, value);
  }

  const response = await handleInstagramRequest(new Request(requestUrl(incoming), { body, headers, method }));
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});

const port = Number(process.env.INSTAGRAM_SERVICE_PORT || 8791);
server.listen(port, "127.0.0.1", () => {
  console.log(`Instagram scraper API listening on http://127.0.0.1:${port}`);
});
