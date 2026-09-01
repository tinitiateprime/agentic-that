importScripts("trusted-origins.js");

const COMPANION_ORIGIN = "http://127.0.0.1:8792";
const REQUEST_TYPE = "agenticthat.publishing.proxy.request.v1";
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"]);
const TRUSTED_ORIGINS_KEY = "trustedDashboardOrigins";
const BUILT_IN_ORIGINS = new Set(["https://agentic-that.netlify.app"]);
const { normalizeDashboardOrigin, hasStaticBridgeForOrigin, trustedScriptId } = globalThis.AgenticThatTrustedOrigins;

async function savedTrustedOrigins() {
  const stored = await chrome.storage.local.get(TRUSTED_ORIGINS_KEY);
  if (!Array.isArray(stored[TRUSTED_ORIGINS_KEY])) return [];
  const normalized = stored[TRUSTED_ORIGINS_KEY].flatMap(origin => {
    try { return [normalizeDashboardOrigin(origin)]; } catch { return []; }
  });
  return [...new Set(normalized)];
}

async function isAllowedDashboard(urlText) {
  try {
    const url = new URL(urlText || "");
    if (BUILT_IN_ORIGINS.has(url.origin)) return true;
    if ((url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && (url.protocol === "http:" || url.protocol === "https:")) return true;
    return (await savedTrustedOrigins()).includes(url.origin);
  } catch {
    return false;
  }
}

async function restoreTrustedContentScripts() {
  const registrations = await chrome.scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registrations.map(item => item.id));
  for (const origin of await savedTrustedOrigins()) {
    const id = trustedScriptId(origin);
    if (hasStaticBridgeForOrigin(origin)) {
      if (registeredIds.has(id)) {
        await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => undefined);
      }
      continue;
    }
    if (registeredIds.has(id)) continue;
    const allowed = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    if (!allowed) continue;
    await chrome.scripting.registerContentScripts([{
      id,
      matches: [`${origin}/*`],
      js: ["dashboard-bridge.js"],
      runAt: "document_start",
      persistAcrossSessions: true,
    }]);
  }
}

async function companionFetch(path, options, attempts = 1) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(`${COMPANION_ORIGIN}${path}`, options);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  const url = new URL(value, COMPANION_ORIGIN);
  if (url.origin !== COMPANION_ORIGIN) return null;
  if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/uploads/")) return null;
  return `${url.pathname}${url.search}`;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function proxyRequest(message, sender) {
  const senderUrl = sender.url || sender.tab?.url || sender.origin;
  if (!(await isAllowedDashboard(senderUrl))) {
    return { ok: false, status: 403, error: "This page is not a trusted AgenticThat dashboard." };
  }

  const path = safePath(message.path);
  const method = String(message.method || "GET").toUpperCase();
  if (!path || !ALLOWED_METHODS.has(method)) {
    return { ok: false, status: 400, error: "The Companion request is invalid." };
  }

  const headers = new Headers();
  for (const entry of Array.isArray(message.headers) ? message.headers : []) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const name = String(entry[0]);
    if (/^(host|origin|referer|content-length|connection)$/i.test(name)) continue;
    headers.set(name, String(entry[1]));
  }
  headers.set("X-AgenticThat-Extension", chrome.runtime.getManifest().version);

  let body;
  if (typeof message.bodyText === "string") body = message.bodyText;
  if (typeof message.bodyBase64 === "string") body = base64ToBytes(message.bodyBase64);

  try {
    const response = await companionFetch(path, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      cache: "no-store",
      redirect: "manual",
    }, method === "GET" && path === "/api/health" ? 3 : 1);
    const responseHeaders = [...response.headers.entries()];
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json") || contentType.startsWith("text/")) {
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        bodyText: await response.text(),
      };
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    const sliceSize = 32 * 1024;
    for (let offset = 0; offset < buffer.length; offset += sliceSize) {
      binary += String.fromCharCode(...buffer.subarray(offset, offset + sliceSize));
    }
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyBase64: btoa(binary),
    };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: error instanceof Error
        ? `Companion did not answer at 127.0.0.1:8792: ${error.message}`
        : "Companion did not answer at 127.0.0.1:8792.",
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== REQUEST_TYPE) return false;
  proxyRequest(message, sender).then(sendResponse, error => {
    sendResponse({
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : "The extension could not complete the request.",
    });
  });
  return true;
});

chrome.runtime.onInstalled.addListener(() => { void restoreTrustedContentScripts().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { void restoreTrustedContentScripts().catch(console.error); });
