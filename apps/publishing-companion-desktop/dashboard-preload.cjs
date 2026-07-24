const { ipcRenderer } = require("electron");

const PAGE_SOURCE = "agenticthat-publishing-dashboard";
const EXTENSION_SOURCE = "agenticthat-publishing-extension";
const PING_TYPE = "agenticthat.publishing.extension.ping.v1";
const REQUEST_TYPE = "agenticthat.publishing.page.request.v1";

function extensionDetails(requestId) {
  return {
    source: EXTENSION_SOURCE,
    type: "agenticthat.publishing.extension.ready.v1",
    requestId,
    version: "desktop",
    extensionBaseUrl: "http://127.0.0.1:8792/desktop/",
  };
}

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.source !== PAGE_SOURCE || typeof message.requestId !== "string") return;

  if (message.type === PING_TYPE) {
    window.postMessage(extensionDetails(message.requestId), window.location.origin);
    return;
  }

  if (message.type !== REQUEST_TYPE) return;
  ipcRenderer.invoke("companion:dashboard-proxy", {
    path: message.path,
    method: message.method,
    headers: message.headers,
    bodyText: message.bodyText,
    bodyBase64: message.bodyBase64,
  }).then(response => {
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: "agenticthat.publishing.page.response.v1",
      requestId: message.requestId,
      response,
    }, window.location.origin);
  }).catch(error => {
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: "agenticthat.publishing.page.response.v1",
      requestId: message.requestId,
      response: {
        ok: false,
        status: 503,
        error: error instanceof Error ? error.message : "The Companion bridge was interrupted.",
      },
    }, window.location.origin);
  });
});

window.addEventListener("DOMContentLoaded", () => {
  window.postMessage(extensionDetails("startup"), window.location.origin);
});
