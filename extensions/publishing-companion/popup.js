const status = document.querySelector("#status");
const detail = document.querySelector("#detail");
const retry = document.querySelector("#retry");
const trustForm = document.querySelector("#trust-form");
const trustedOriginInput = document.querySelector("#trusted-origin");
const trustMessage = document.querySelector("#trust-message");
const trustedList = document.querySelector("#trusted-list");
const extensionVersion = document.querySelector("#extension-version");
const TRUSTED_ORIGINS_KEY = "trustedDashboardOrigins";
const { normalizeDashboardOrigin, hasStaticBridgeForOrigin, trustedScriptId } = globalThis.AgenticThatTrustedOrigins;

extensionVersion.textContent = chrome.runtime.getManifest().version;

function validHttpsOrigin(value) {
  const url = new URL(normalizeDashboardOrigin(value));
  if (url.protocol !== "https:") throw new Error("Use the HTTPS website address.");
  return url.origin;
}

async function trustedOrigins() {
  const stored = await chrome.storage.local.get(TRUSTED_ORIGINS_KEY);
  if (!Array.isArray(stored[TRUSTED_ORIGINS_KEY])) return [];
  return [...new Set(stored[TRUSTED_ORIGINS_KEY].flatMap(origin => {
    try { return [normalizeDashboardOrigin(origin)]; } catch { return []; }
  }))];
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
      await chrome.scripting.unregisterContentScripts({ ids: [trustedScriptId(origin)] }).catch(() => undefined);
      if (!hasStaticBridgeForOrigin(origin)) {
        await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => undefined);
      }
      await renderTrustedOrigins();
    });
    row.append(label, remove);
    trustedList.append(row);
  }
}

async function companionHealth() {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8792/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(2_500),
      });
      if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  const reason = lastError instanceof Error ? lastError.message : "No response.";
  throw new Error(`Nothing answered at 127.0.0.1:8792 (${reason})`);
}

async function check() {
  status.className = "status checking";
  status.querySelector("span").textContent = "Checking local companion…";
  retry.disabled = true;
  try {
    const health = await companionHealth();
    if (!health.chromeInstalled) throw new Error("Google Chrome or Microsoft Edge is required for external login.");
    if (!health.automationReady) throw new Error("Browser automation is not available in this process.");
    if (!health.extensionBridge) throw new Error("Restart Companion to load its browser bridge.");
    status.className = "status ready";
    status.querySelector("span").textContent = "Ready";
    detail.textContent = "Publishing and local scraping are available. This extension is needed only when AgenticThat is opened in your browser.";
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
    if (!hasStaticBridgeForOrigin(origin)) {
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) throw new Error("Website permission was not approved.");
      const id = trustedScriptId(origin);
      await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => undefined);
      await chrome.scripting.registerContentScripts([{
        id,
        matches: [`${origin}/*`],
        js: ["dashboard-bridge.js"],
        runAt: "document_start",
        persistAcrossSessions: true,
      }]);
    }
    const next = [...new Set([...(await trustedOrigins()), origin])];
    await chrome.storage.local.set({ [TRUSTED_ORIGINS_KEY]: next });
    if (!(await trustedOrigins()).includes(origin)) throw new Error("Chrome did not save the trusted website.");
    trustedOriginInput.value = "";
    trustMessage.textContent = "Trusted. Refresh the AgenticThat website tab.";
    await renderTrustedOrigins();
  } catch (error) {
    trustMessage.textContent = error instanceof Error ? error.message : "The website could not be trusted.";
  }
});

void check();
void renderTrustedOrigins();
