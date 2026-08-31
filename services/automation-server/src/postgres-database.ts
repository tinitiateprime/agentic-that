import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres, { type Sql } from "postgres";
import type { AutomationConfig } from "./config.ts";

export type AutomationPostgres = Sql<{}>;
export const POSTGRES_MIGRATION_KEY = "production-pilot-postgres-v1";

export function createAutomationPostgres(
  config: AutomationConfig,
  poolMax = config.databasePoolMax,
): AutomationPostgres {
  if (config.databaseEngine !== "postgres" || !config.databaseUrl) {
    throw new Error("PostgreSQL automation storage is not configured.");
  }
  return postgres(config.databaseUrl, {
    max: poolMax,
    connect_timeout: 15,
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    prepare: false,
    onnotice: () => undefined,
  });
}

export async function automationPostgresReady(sql: AutomationPostgres) {
  try {
    const rows = await sql<{ key: string }[]>`
      SELECT key FROM automation_schema_migrations
      WHERE key = ${POSTGRES_MIGRATION_KEY}
    `;
    return rows[0]?.key === POSTGRES_MIGRATION_KEY;
  } catch {
    return false;
  }
}

export async function migrateAutomationPostgres(sql: AutomationPostgres, cwd = process.cwd()) {
  const migrationFile = path.join(
    cwd,
    "services",
    "automation-server",
    "migrations",
    "postgres",
    "0001_production_pilot.sql",
  );
  const migration = await readFile(migrationFile, "utf8");
  await sql.unsafe(migration);
  if (!await automationPostgresReady(sql)) {
    throw new Error("The PostgreSQL automation migration did not record its completion key.");
  }
}

export async function closeAutomationPostgres(sql: AutomationPostgres) {
  await sql.end({ timeout: 10 });
}
