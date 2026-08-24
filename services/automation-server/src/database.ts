import postgres from "postgres";
import type { AutomationConfig } from "./config.ts";
import { isLoopbackHost } from "./config.ts";

export type AutomationSql = ReturnType<typeof postgres>;

function databaseName(url: URL) {
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

export function assertSafeAutomationDatabase(
  config: AutomationConfig,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!config.databaseUrl) {
    throw new Error("SERVER_ARCHITECTURE_DATABASE_URL is required for automation database operations.");
  }
  if (config.databaseUrl.includes("...") || /\[YOUR-PASSWORD\]/i.test(config.databaseUrl)) {
    throw new Error("SERVER_ARCHITECTURE_DATABASE_URL still contains a placeholder.");
  }

  const sharedUrls = [env.DATABASE_URL, env.SUPABASE_DB_URL, env.SUPABASE_DATABASE_URL]
    .map(value => value?.trim())
    .filter(Boolean);
  if (sharedUrls.includes(config.databaseUrl)) {
    throw new Error(
      "Refusing to use the current AgenticThat database. Configure a separate SERVER_ARCHITECTURE_DATABASE_URL.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(config.databaseUrl);
  } catch {
    throw new Error("SERVER_ARCHITECTURE_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("SERVER_ARCHITECTURE_DATABASE_URL must use postgres:// or postgresql://.");
  }
  if (!isLoopbackHost(parsed.hostname) && !config.allowRemoteDatabase) {
    throw new Error(
      "Refusing a remote automation database. Set SERVER_ARCHITECTURE_ALLOW_REMOTE_DATABASE=true only for an isolated staging or production database.",
    );
  }

  const name = databaseName(parsed);
  if (!name) throw new Error("SERVER_ARCHITECTURE_DATABASE_URL must include a database name.");
  if (config.databasePurpose === "production") {
    if (config.databaseNameConfirmation !== name) {
      throw new Error(
        "Production database confirmation is missing. Set SERVER_ARCHITECTURE_CONFIRM_PRODUCTION_DATABASE to the exact database name.",
      );
    }
  } else if (!/(agenticthat|agentic_that).*(server|staging|development|dev|test)|(server|staging|development|dev|test).*(agenticthat|agentic_that)/i.test(name)) {
    throw new Error(
      "Development and staging database names must clearly contain AgenticThat and server, staging, development, dev, or test.",
    );
  }

  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: name,
    purpose: config.databasePurpose,
    local: isLoopbackHost(parsed.hostname),
  };
}

export function createAutomationSql(config: AutomationConfig) {
  assertSafeAutomationDatabase(config);
  return postgres(config.databaseUrl, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
}
