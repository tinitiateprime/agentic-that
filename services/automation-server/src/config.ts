import path from "node:path";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export type AutomationConfig = {
  host: string;
  port: number;
  dataDirectory: string;
  databaseFile: string;
  internalToken: string;
  executionEnabled: boolean;
  loginEnabled: boolean;
  scrapingEnabled: boolean;
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
    executionEnabled: enabled(env.SERVER_EXECUTION_ENABLED),
    loginEnabled: enabled(env.SERVER_LOGIN_ENABLED),
    scrapingEnabled: enabled(env.SERVER_SCRAPING_ENABLED),
    autoMigrate: enabled(env.SERVER_ARCHITECTURE_AUTO_MIGRATE),
    allowPublicBind,
  };
}

export function isLoopbackHost(host: string) {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}
