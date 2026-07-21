const PAGE_SOURCE = "agenticthat-publishing-dashboard";
const EXTENSION_SOURCE = "agenticthat-publishing-extension";
const REQUEST_TYPE = "agenticthat.publishing.proxy.request.v1";

function extensionDetails(requestId) {
  return {
    source: EXTENSION_SOURCE,
    type: "agenticthat.publishing.extension.ready.v1",
    requestId,
    version: chrome.runtime.getManifest().version,
    extensionBaseUrl: chrome.runtime.getURL("")
  };
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.source !== PAGE_SOURCE || typeof message.requestId !== "string") return;

  if (message.type === "agenticthat.publishing.extension.ping.v1") {
    window.postMessage(extensionDetails(message.requestId), window.location.origin);
    return;
  }

  if (message.type !== "agenticthat.publishing.page.request.v1") return;
  chrome.runtime.sendMessage({
    type: REQUEST_TYPE,
    path: message.path,
    method: message.method,
    headers: message.headers,
    bodyText: message.bodyText,
    bodyBase64: message.bodyBase64
  }).then((response) => {
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: "agenticthat.publishing.page.response.v1",
      requestId: message.requestId,
      response
    }, window.location.origin);
  }).catch((error) => {
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: "agenticthat.publishing.page.response.v1",
      requestId: message.requestId,
      response: {
        ok: false,
        status: 503,
        error: error instanceof Error ? error.message : "The extension connection was interrupted."
      }
    }, window.location.origin);
  });
});

window.postMessage(extensionDetails("startup"), window.location.origin);
