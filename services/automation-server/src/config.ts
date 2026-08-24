import path from "node:path";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export type AutomationConfig = {
  host: string;
  port: number;
  dataDirectory: string;
  databaseFile: string;
  internalToken: string;
  browserExecutablePath: string;
  loginTimeoutMs: number;
  executionEnabled: boolean;
  instagramPublishingEnabled: boolean;
  loginEnabled: boolean;
  scrapingEnabled: boolean;
  publishingDryRunEnabled: boolean;
  publishingPreviewEnabled: boolean;
  workerPollMs: number;
  liveWorkerCount: number;
  autoMigrate: boolean;
  allowPublicBind: boolean;
};

function enabled(value: string | undefined) {
  return TRUE_VALUES.has(String(value || "").trim().toLowerCase());
}

function port(value: string | undefined) {
  const parsed = Number(value || 8800);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("SERVER_ARCHITECTURE_PORT must be an integer between 1 and 65535.");
  }
  return parsed;
}

function loginTimeout(value: string | undefined) {
  const parsed = Number(value || 600_000);
  if (!Number.isInteger(parsed) || parsed < 60_000 || parsed > 1_800_000) {
    throw new Error("SERVER_LOGIN_TIMEOUT_MS must be between 60000 and 1800000 milliseconds.");
  }
  return parsed;
}

function workerPoll(value: string | undefined) {
  const parsed = Number(value || 2_000);
  if (!Number.isInteger(parsed) || parsed < 250 || parsed > 60_000) {
    throw new Error("SERVER_WORKER_POLL_MS must be between 250 and 60000 milliseconds.");
  }
  return parsed;
}

function liveWorkerCount(value: string | undefined) {
  const parsed = Number(value || 1);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error("SERVER_LIVE_WORKER_COUNT must be an integer between 1 and 8.");
  }
  return parsed;
}

export function loadAutomationConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AutomationConfig {
  const allowPublicBind = enabled(env.SERVER_ARCHITECTURE_ALLOW_PUBLIC_BIND);
  const host = String(env.SERVER_ARCHITECTURE_HOST || "127.0.0.1").trim();
  if (!LOOPBACK_HOSTS.has(host) && !allowPublicBind) {
    throw new Error(
      "Refusing a public automation-server bind. Set SERVER_ARCHITECTURE_ALLOW_PUBLIC_BIND=true only in an intentionally secured environment.",
    );
  }
  const dataDirectory = path.resolve(cwd, env.SERVER_ARCHITECTURE_DATA_DIR?.trim() || ".server-data");
  const databaseFile = path.resolve(
    cwd,
    env.SERVER_ARCHITECTURE_DATABASE_FILE?.trim() || path.join(dataDirectory, "automation.db"),
  );

  return {
    host,
    port: port(env.SERVER_ARCHITECTURE_PORT),
    dataDirectory,
    databaseFile,
    internalToken: env.SERVER_ARCHITECTURE_INTERNAL_TOKEN?.trim() || "",
    browserExecutablePath: env.SERVER_BROWSER_EXECUTABLE_PATH?.trim() || "",
    loginTimeoutMs: loginTimeout(env.SERVER_LOGIN_TIMEOUT_MS),
    executionEnabled: enabled(env.SERVER_EXECUTION_ENABLED),
    instagramPublishingEnabled: enabled(env.SERVER_INSTAGRAM_PUBLISHING_ENABLED),
    loginEnabled: enabled(env.SERVER_LOGIN_ENABLED),
    scrapingEnabled: enabled(env.SERVER_SCRAPING_ENABLED),
    publishingDryRunEnabled: enabled(env.SERVER_PUBLISHING_DRY_RUN_ENABLED),
    publishingPreviewEnabled: enabled(env.SERVER_PUBLISHING_PREVIEW_ENABLED),
    workerPollMs: workerPoll(env.SERVER_WORKER_POLL_MS),
    liveWorkerCount: liveWorkerCount(env.SERVER_LIVE_WORKER_COUNT),
    autoMigrate: enabled(env.SERVER_ARCHITECTURE_AUTO_MIGRATE),
    allowPublicBind,
  };
}

export function isLoopbackHost(host: string) {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}
