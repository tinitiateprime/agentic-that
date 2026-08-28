const status = document.querySelector("#status");
const detail = document.querySelector("#detail");
const retry = document.querySelector("#retry");
const trustForm = document.querySelector("#trust-form");
const trustedOriginInput = document.querySelector("#trusted-origin");
const trustMessage = document.querySelector("#trust-message");
const trustedList = document.querySelector("#trusted-list");
const TRUSTED_ORIGINS_KEY = "trustedDashboardOrigins";

function scriptId(origin) {
  let hash = 2166136261;
  for (const character of origin) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `agenticthat-dashboard-${(hash >>> 0).toString(16)}`;
}

function validHttpsOrigin(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:") throw new Error("Use the HTTPS website address.");
  return url.origin;
}

async function trustedOrigins() {
  const stored = await chrome.storage.local.get(TRUSTED_ORIGINS_KEY);
  return Array.isArray(stored[TRUSTED_ORIGINS_KEY]) ? stored[TRUSTED_ORIGINS_KEY] : [];
}

async function renderTrustedOrigins() {
  trustedList.replaceChildren();
  for (const origin of await trustedOrigins()) {
    const row = document.createElement("div");
    row.className = "trusted-origin";
    const label = document.createElement("span");
    label.textContent = origin;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      const next = (await trustedOrigins()).filter(item => item !== origin);
      await chrome.storage.local.set({ [TRUSTED_ORIGINS_KEY]: next });
      await chrome.scripting.unregisterContentScripts({ ids: [scriptId(origin)] }).catch(() => undefined);
      await chrome.permissions.remove({ origins: [`${origin}/*`] });
      await renderTrustedOrigins();
    });
    row.append(label, remove);
    trustedList.append(row);
  }
}

async function check() {
  status.className = "status checking";
  status.querySelector("span").textContent = "Checking local companion…";
  retry.disabled = true;
  try {
    const response = await fetch("http://127.0.0.1:8792/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
    const health = await response.json();
    if (!health.chromeInstalled) throw new Error("Google Chrome is required for browser publishing.");
    if (!health.automationReady) throw new Error("Browser automation is not available in this process.");
    if (!health.extensionBridge) throw new Error("Restart the companion to load its extension bridge.");
    status.className = "status ready";
    status.querySelector("span").textContent = "Ready";
    detail.textContent = "Publishing and local scraping are available. Keep this computer powered on while Companion is in use.";
  } catch (error) {
    status.className = "status offline";
    status.querySelector("span").textContent = "Companion is offline";
    detail.textContent = error instanceof Error
      ? `${error.message} Open AgenticThat Companion, then check again.`
      : "Open AgenticThat Companion, then check again.";
  } finally {
    retry.disabled = false;
  }
}

retry.addEventListener("click", check);
trustForm.addEventListener("submit", async event => {
  event.preventDefault();
  trustMessage.textContent = "";
  try {
    const origin = validHttpsOrigin(trustedOriginInput.value);
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error("Website permission was not approved.");
    const id = scriptId(origin);
    await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => undefined);
    await chrome.scripting.registerContentScripts([{
      id,
      matches: [`${origin}/*`],
      js: ["dashboard-bridge.js"],
      runAt: "document_start",
      persistAcrossSessions: true
    }]);
    const next = [...new Set([...(await trustedOrigins()), origin])];
    await chrome.storage.local.set({ [TRUSTED_ORIGINS_KEY]: next });
    trustedOriginInput.value = "";
    trustMessage.textContent = "Trusted. Refresh the AgenticThat website tab.";
    await renderTrustedOrigins();
  } catch (error) {
    trustMessage.textContent = error instanceof Error ? error.message : "The website could not be trusted.";
  }
});
void check();
void renderTrustedOrigins();
