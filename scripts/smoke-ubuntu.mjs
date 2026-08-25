import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxLoader = require.resolve("tsx");
const nextBin = require.resolve("next/dist/bin/next");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agenticthat-ubuntu-smoke-"));
const children = [];
let smokeBrowser = null;

const safeBaseEnvironment = {
  PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
  LANG: process.env.LANG || "C.UTF-8",
  NO_COLOR: "1",
};

function start(name, args, environment) {
  const output = [];
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: { ...safeBaseEnvironment, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = chunk => {
    output.push(String(chunk));
    while (output.join("").length > 8_000) output.shift();
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  children.push({ name, child, output });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.ok || (response.status >= 300 && response.status < 400)) return;
    } catch {
      // The service may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const diagnostics = children
    .map(({ name, output }) => `\n[${name}]\n${output.join("").slice(-4_000)}`)
    .join("");
  throw new Error(`Smoke endpoint did not become ready: ${url}${diagnostics}`);
}

async function stopChildren() {
  const waitForExit = child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  });
  for (const { child } of children) if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([
    Promise.all(children.map(({ child }) => waitForExit(child))),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
  const remaining = children.filter(({ child }) => child.exitCode === null && child.signalCode === null);
  for (const { child } of remaining) child.kill("SIGKILL");
  await Promise.all(remaining.map(({ child }) => waitForExit(child)));
}

try {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, ".next", "routes-manifest.json"), "utf8"));
  const rewrites = [
    ...manifest.rewrites.beforeFiles,
    ...manifest.rewrites.afterFiles,
    ...manifest.rewrites.fallback,
  ].map(route => route.source);
  for (const source of [
    "/api/scraping/instagram/:path*",
    "/api/scraping/facebook/:path*",
    "/api/telegram/:path*",
  ]) {
    if (!rewrites.includes(source)) throw new Error(`The production build is missing ${source}.`);
  }

  start("instagram", ["--import", tsxLoader, "services/scraping/instagram/src/server.ts"], {
    INSTAGRAM_DATA_DIR: path.join(temporaryRoot, "instagram"),
    INSTAGRAM_SERVICE_PORT: "8791",
  });
  start("facebook", ["--import", tsxLoader, "services/scraping/facebook/src/server.ts"], {
    FACEBOOK_DATA_DIR: path.join(temporaryRoot, "facebook"),
    FACEBOOK_SERVICE_PORT: "8793",
  });
  start("telegram", ["--import", tsxLoader, "services/messaging/telegram/src/server.ts"], {
    NODE_ENV: "production",
    SERVICE_HOST: "127.0.0.1",
    SERVICE_PORT: "8787",
    DATA_DIR: path.join(temporaryRoot, "telegram"),
    SESSION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    USER_PROVISIONING_KEY: "smoke-only-provisioning-key-that-is-not-secret",
    SESSION_COOKIE_SECURE: "true",
    CORS_ORIGIN: "http://127.0.0.1:4173",
    TELEGRAM_API_ID: "1",
    TELEGRAM_API_HASH: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  start("automation", ["--import", tsxLoader, "services/automation-server/src/server.ts"], {
    SERVER_ARCHITECTURE_DEPLOYMENT: "production",
    SERVER_ARCHITECTURE_HOST: "127.0.0.1",
    SERVER_ARCHITECTURE_PORT: "8800",
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "smoke-only-internal-token-longer-than-thirty-two-chars",
    SERVER_ARCHITECTURE_DATA_DIR: path.join(temporaryRoot, "automation"),
    SERVER_ARCHITECTURE_DATABASE_FILE: path.join(temporaryRoot, "automation", "automation.db"),
    SERVER_ARCHITECTURE_AUTO_MIGRATE: "true",
    SERVER_SINGLE_HOST_ACKNOWLEDGED: "true",
    SERVER_PROFILE_STORAGE_ENCRYPTED: "true",
    SERVER_BACKUPS_CONFIGURED: "true",
  });
  start("site", [nextBin, "start", "-H", "127.0.0.1", "-p", "4173"], {
    NODE_ENV: "production",
    NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS: "false",
    PLATFORM_AUTH_DATA_PATH: path.join(temporaryRoot, "platform-auth.json"),
    PLATFORM_DOCUMENT_DATA_PATH: path.join(temporaryRoot, "platform-documents.json"),
    DATABASE_URL: "",
    SUPABASE_DB_URL: "",
    SUPABASE_DATABASE_URL: "",
    SERVICE_TOKEN_PRIVATE_KEY: "",
    SERVICE_TOKEN_PUBLIC_KEY: "",
    SERVER_AUTOMATION_DASHBOARD_ENABLED: "true",
    SERVER_AUTOMATION_ORIGIN: "http://127.0.0.1:8800",
    SERVER_AUTOMATION_INTERNAL_TOKEN: "smoke-only-internal-token-longer-than-thirty-two-chars",
  });

  for (const url of [
    "http://127.0.0.1:8800/ready",
    "http://127.0.0.1:8787/health",
    "http://127.0.0.1:8791/api/scraping/instagram/health",
    "http://127.0.0.1:8793/api/scraping/facebook/health",
    "http://127.0.0.1:4173/",
    "http://127.0.0.1:4173/api/telegram/health",
    "http://127.0.0.1:4173/api/scraping/instagram/health",
    "http://127.0.0.1:4173/api/scraping/facebook/health",
    "http://127.0.0.1:4173/publishing",
    "http://127.0.0.1:4173/config-manager",
  ]) await waitFor(url);

  smokeBrowser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const page = await smokeBrowser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const pathname of ["/", "/publishing", "/config-manager", "/scraper/instagram", "/scraper/facebook"]) {
    const response = await page.goto(`http://127.0.0.1:4173${pathname}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response || response.status() >= 400) throw new Error(`Browser smoke failed for ${pathname}.`);
    const body = await page.locator("body").innerText();
    if (/Internal Server Error|Application error: a server-side exception/i.test(body)) {
      throw new Error(`Browser smoke rendered an application error for ${pathname}.`);
    }
  }

  process.stdout.write(
    "Ubuntu smoke passed: browser pages, automation readiness, Telegram proxy, Instagram proxy, Facebook proxy, publishing, and Config Manager.\n",
  );
} finally {
  await smokeBrowser?.close().catch(() => undefined);
  await stopChildren();
  await rm(temporaryRoot, { recursive: true, force: true });
}
