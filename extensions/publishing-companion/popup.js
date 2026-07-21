const status = document.querySelector("#status");
const detail = document.querySelector("#detail");
const retry = document.querySelector("#retry");

async function check() {
  status.className = "status checking";
  status.querySelector("span").textContent = "Checking local companion…";
  retry.disabled = true;
  try {
    const response = await fetch("http://127.0.0.1:8792/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
    const health = await response.json();
    if (!health.automationReady) throw new Error("Browser automation is not available in this process.");
    if (!health.extensionBridge) throw new Error("Restart the companion to load its extension bridge.");
    status.className = "status ready";
    status.querySelector("span").textContent = "Ready to publish";
    detail.textContent = "Keep the computer powered on. Scheduled posts will use the manually saved Chrome sessions.";
  } catch (error) {
    status.className = "status offline";
    status.querySelector("span").textContent = "Companion is offline";
    detail.textContent = error instanceof Error
      ? `${error.message} Double-click Start Publishing Companion.cmd, then check again.`
      : "Double-click Start Publishing Companion.cmd, then check again.";
  } finally {
    retry.disabled = false;
  }
}

retry.addEventListener("click", check);
void check();
