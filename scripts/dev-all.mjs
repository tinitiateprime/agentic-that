import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import net from "node:net";
import path from "node:path";
import "./copy-telegram-console.mjs";

const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
const projectRoot = process.cwd();
const host = process.env.HOST || "127.0.0.1";
const publishingOnly = process.env.DEV_PUBLISHING_ONLY === "true";
const portAttempts = Number(process.env.DEV_PORT_ATTEMPTS || 20);
const reservedPorts = new Set();

function positivePort(value, fallback, name) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return port;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen({ host, port });
  });
}

async function findPort(preferredPort, label) {
  for (let offset = 0; offset < portAttempts; offset += 1) {
    const port = preferredPort + offset;
    if (port > 65535 || reservedPorts.has(port)) continue;
    if (!(await isPortFree(port))) continue;
    reservedPorts.add(port);
    if (port !== preferredPort) {
      console.log(`[dev] ${label} port ${preferredPort} is busy; using ${port}.`);
    }
    return port;
  }

  throw new Error(
    `No free port found for ${label} from ${preferredPort} to ${Math.min(65535, preferredPort + portAttempts - 1)}.`
  );
}

const sitePort = await findPort(
  positivePort(process.env.PORT || process.env.DEV_PORT, 5173, "PORT"),
  "Site"
);
const telegramPort = await findPort(
  positivePort(process.env.TELEGRAM_SERVICE_PORT || process.env.SERVICE_PORT, 8787, "TELEGRAM_SERVICE_PORT"),
  "Telegram"
);
const instagramPort = await findPort(
  positivePort(process.env.INSTAGRAM_SERVICE_PORT, 8791, "INSTAGRAM_SERVICE_PORT"),
  "Instagram"
);
const facebookPort = await findPort(
  positivePort(process.env.FACEBOOK_SERVICE_PORT, 8793, "FACEBOOK_SERVICE_PORT"),
  "Facebook"
);
const publishQueuePort = await findPort(
  positivePort(process.env.PUBLISH_QUEUE_SERVICE_PORT, 8792, "PUBLISH_QUEUE_SERVICE_PORT"),
  "Publish Queue"
);

const siteUrl = `http://${host}:${sitePort}`;
const telegramUrl = `${siteUrl}/console`;
const instagramUrl = `${siteUrl}/scraper/instagram`;
const facebookUrl = `${siteUrl}/scraper/facebook`;
const publishQueueUrl = `${siteUrl}/publishing`;
// Browsers always use same-origin /api routes. Only Next.js receives these
// loopback service targets, so a remote user's browser never calls its own
// localhost by mistake.
const instagramApiUrl = `http://127.0.0.1:${instagramPort}`;
const facebookApiUrl = `http://127.0.0.1:${facebookPort}`;
const telegramApiUrl = `http://127.0.0.1:${telegramPort}`;
const publishQueueApiUrl = `http://127.0.0.1:${publishQueuePort}`;

console.log(`\nAgenticThat ${publishingOnly ? "publishing" : "development"} workspace`);
console.log(`  Website            ${siteUrl}`);
if (!publishingOnly) {
  console.log(`  Telegram           ${telegramUrl}`);
  console.log(`  Instagram          ${instagramUrl}`);
  console.log(`  Facebook           ${facebookUrl}`);
}
console.log(`  Publish Queue      ${publishQueueUrl}`);
console.log("  Press Ctrl+C once to stop every service.\n");

const commonEnv = { ...process.env, HOST: host };
const services = [
  {
    name: "site",
    color: "\u001b[36m",
    command: process.execPath,
    args: [path.join(projectRoot, "scripts", "dev-next.mjs")],
    cwd: projectRoot,
    env: {
      ...commonEnv,
      PORT: String(sitePort),
      DEV_PORT_ATTEMPTS: "1",
      TELEGRAM_SERVICE_PORT: String(telegramPort),
      TELEGRAM_API_URL: telegramApiUrl,
      INSTAGRAM_SERVICE_PORT: String(instagramPort),
      INSTAGRAM_API_URL: instagramApiUrl,
      NEXT_PUBLIC_INSTAGRAM_API_URL: "",
      FACEBOOK_SERVICE_PORT: String(facebookPort),
      FACEBOOK_API_URL: facebookApiUrl,
      NEXT_PUBLIC_FACEBOOK_API_URL: "",
      PUBLISH_QUEUE_SERVICE_PORT: String(publishQueuePort),
      PUBLISH_QUEUE_API_URL: publishQueueApiUrl,
      NEXT_PUBLIC_PUBLISH_QUEUE_API_URL: "",
      NEXT_PUBLIC_TELEGRAM_DASHBOARD_URL: "/console",
      ...(publishingOnly ? { SERVER_AUTOMATION_DASHBOARD_ENABLED: "true" } : {}),
    },
  },
  {
    name: "telegram",
    color: "\u001b[32m",
    command: process.execPath,
    args: ["--import", tsxLoader, path.join(projectRoot, "services", "messaging", "telegram", "src", "server.ts")],
    cwd: path.join(projectRoot, "services", "messaging", "telegram"),
    env: {
      ...commonEnv,
      SERVICE_HOST: host,
      SERVICE_PORT: String(telegramPort),
      CORS_ORIGIN: siteUrl,
    },
  },
  {
    name: "instagram",
    color: "\u001b[35m",
    command: process.execPath,
    args: ["--import", tsxLoader, path.join(projectRoot, "services", "scraping", "instagram", "src", "server.ts")],
    cwd: projectRoot,
    env: {
      ...commonEnv,
      INSTAGRAM_SERVICE_PORT: String(instagramPort),
    },
  },
  {
    name: "publishing",
    color: "\u001b[33m",
    command: process.execPath,
    args: ["--import", tsxLoader, path.join(projectRoot, "services", "publishing", "queue-runner", "server", "index.ts")],
    cwd: path.join(projectRoot, "services", "publishing", "queue-runner"),
    env: {
      ...commonEnv,
      PUBLISH_QUEUE_SERVICE_PORT: String(publishQueuePort),
      PUBLISH_QUEUE_WEB_ORIGIN: siteUrl,
    },
  },
  {
    name: "facebook",
    color: "\u001b[34m",
    command: process.execPath,
    args: ["--import", tsxLoader, path.join(projectRoot, "services", "scraping", "facebook", "src", "server.ts")],
    cwd: projectRoot,
    env: {
      ...commonEnv,
      FACEBOOK_SERVICE_PORT: String(facebookPort),
    },
  },
].filter(service => !publishingOnly || service.name === "site" || service.name === "publishing");

const reset = "\u001b[0m";
const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const children = [];
let shuttingDown = false;
let finalExitCode = 0;
let finish;
const finished = new Promise((resolve) => { finish = resolve; });

function pipeLines(stream, service, target) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => {
    const prefix = useColor
      ? `${service.color}[${service.name}]${reset}`
      : `[${service.name}]`;
    target.write(`${prefix} ${line}\n`);
  });
}

function stopChildren() {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}

function beginShutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  finalExitCode = exitCode;
  stopChildren();

  const forceTimer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 5000);
  forceTimer.unref();

  Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  }))).then(() => {
    clearTimeout(forceTimer);
    finish();
  });
}

for (const service of services) {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: service.env,
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  pipeLines(child.stdout, service, process.stdout);
  pipeLines(child.stderr, service, process.stderr);

  child.once("error", (error) => {
    console.error(`[${service.name}] Failed to start: ${error.message}`);
    beginShutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`[${service.name}] Exited unexpectedly with ${reason}.`);
    beginShutdown(code && code > 0 ? code : 1);
  });
}

process.once("SIGINT", () => beginShutdown(0));
process.once("SIGTERM", () => beginShutdown(0));

await finished;
process.exitCode = finalExitCode;
