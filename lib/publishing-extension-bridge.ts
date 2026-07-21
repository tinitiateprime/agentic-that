const PAGE_SOURCE = "agenticthat-publishing-dashboard";
const EXTENSION_SOURCE = "agenticthat-publishing-extension";
const PING_TYPE = "agenticthat.publishing.extension.ping.v1";
const READY_TYPE = "agenticthat.publishing.extension.ready.v1";
const REQUEST_TYPE = "agenticthat.publishing.page.request.v1";
const RESPONSE_TYPE = "agenticthat.publishing.page.response.v1";

type ExtensionDetails = {
  version: string;
  extensionBaseUrl: string;
};

type ProxyResponse = {
  ok: boolean;
  status: number;
  statusText?: string;
  headers?: Array<[string, string]>;
  bodyText?: string;
  bodyBase64?: string;
  error?: string;
};

let cachedDetails: ExtensionDetails | null = null;
let lastDetectionAt = 0;

function requestId() {
  return `publishing_${Date.now()}_${crypto.randomUUID()}`;
}

function postAndWait<T>(message: Record<string, unknown>, responseType: string, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const id = String(message.requestId);
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("The publishing extension did not respond."));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.source !== EXTENSION_SOURCE || data.type !== responseType || data.requestId !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data as T);
    }

    window.addEventListener("message", onMessage);
    window.postMessage(message, window.location.origin);
  });
}

export async function detectPublishingExtension(force = false) {
  if (typeof window === "undefined") return null;
  if (!force && cachedDetails && Date.now() - lastDetectionAt < 30_000) return cachedDetails;

  const id = requestId();
  try {
    const response = await postAndWait<Record<string, unknown>>({
      source: PAGE_SOURCE,
      type: PING_TYPE,
      requestId: id,
    }, READY_TYPE, 900);
    if (typeof response.version !== "string" || typeof response.extensionBaseUrl !== "string") return null;
    cachedDetails = { version: response.version, extensionBaseUrl: response.extensionBaseUrl };
    lastDetectionAt = Date.now();
    return cachedDetails;
  } catch {
    cachedDetails = null;
    lastDetectionAt = Date.now();
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const sliceSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += sliceSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + sliceSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function serializeBody(body: BodyInit | null | undefined) {
  if (body === undefined || body === null) return {};
  if (typeof body === "string") return { bodyText: body };
  if (body instanceof URLSearchParams) return { bodyText: body.toString() };
  if (body instanceof FormData) throw new Error("Multipart requests must use the staged publishing upload flow.");
  if (body instanceof Blob) return { bodyBase64: bytesToBase64(new Uint8Array(await body.arrayBuffer())) };
  if (body instanceof ArrayBuffer) return { bodyBase64: bytesToBase64(new Uint8Array(body)) };
  if (ArrayBuffer.isView(body)) {
    return { bodyBase64: bytesToBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)) };
  }
  throw new Error("This request body cannot be sent through the publishing extension.");
}

export async function publishingExtensionFetch(path: string, init: RequestInit = {}) {
  const extension = await detectPublishingExtension();
  if (!extension) return null;

  const id = requestId();
  const headers = [...new Headers(init.headers).entries()];
  const body = await serializeBody(init.body);
  const responseMessage = await postAndWait<{
    response?: ProxyResponse;
  }>({
    source: PAGE_SOURCE,
    type: REQUEST_TYPE,
    requestId: id,
    path,
    method: init.method ?? "GET",
    headers,
    ...body,
  }, RESPONSE_TYPE, 30_000);

  const response = responseMessage.response;
  if (!response?.ok) {
    return new Response(JSON.stringify({
      message: response?.error || "The publishing companion is unavailable.",
    }), {
      status: response?.status || 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const responseBody = response.status === 204 || response.status === 205 || response.status === 304
    ? null
    : typeof response.bodyText === "string"
      ? response.bodyText
      : typeof response.bodyBase64 === "string"
        ? base64ToBytes(response.bodyBase64)
        : null;
  return new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function extensionMediaProxyUrl(path: string, options: { compact?: boolean; controls?: boolean } = {}) {
  if (!cachedDetails || !path.startsWith("/uploads/")) return null;
  const query = new URLSearchParams({ path });
  if (options.compact) query.set("compact", "1");
  if (options.controls) query.set("controls", "1");
  return `${cachedDetails.extensionBaseUrl}media-proxy.html?${query}`;
}

export function publishingExtensionIsActive() {
  return cachedDetails !== null;
}
