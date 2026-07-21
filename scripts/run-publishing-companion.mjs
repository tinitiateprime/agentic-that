import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
const serverEntry = path.join(projectRoot, "services", "publishing", "queue-runner", "server", "index.ts");
const serviceRoot = path.dirname(path.dirname(serverEntry));
const port = Number(process.env.PUBLISH_QUEUE_SERVICE_PORT || 8792);
const restartDelayMs = Math.max(1000, Number(process.env.PUBLISH_QUEUE_COMPANION_RESTART_DELAY_MS || 5000));

let child = null;
let stopping = false;

async function companionAlreadyRunning() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.service === "agenticthat-publish-queue-runner";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function wait(delayMs) {
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

async function run() {
  if (await companionAlreadyRunning()) {
    console.log(`Publishing companion is already running on http://127.0.0.1:${port}.`);
    return;
  }

  while (!stopping) {
    console.log(`Starting publishing companion on http://127.0.0.1:${port}...`);
    child = spawn(process.execPath, ["--import", tsxLoader, serverEntry], {
      cwd: serviceRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });

    const result = await new Promise(resolve => {
      child.once("error", error => resolve({ error }));
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    child = null;

    if (stopping) break;
    const reason = result.error?.message || (result.signal ? `signal ${result.signal}` : `exit code ${result.code ?? 1}`);
    console.error(`Publishing companion stopped (${reason}). Restarting in ${Math.round(restartDelayMs / 1000)} seconds...`);
    await wait(restartDelayMs);
  }
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  child?.kill(signal);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

await run();
