import dotenv from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import { migrationChecksum, migrationChecksumMatches } from "./migration-checksum.mjs";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

if (!process.env.DATABASE_URL?.trim() && !process.env.SUPABASE_DB_URL?.trim()) {
  throw new Error("DATABASE_URL or SUPABASE_DB_URL is required for database migrations.");
}

// This is the only entrypoint allowed to perform production DDL. Importing the
// existing stores creates the legacy WhatsApp/platform base tables before the
// versioned SQL migrations are applied.
process.env.RUN_DATABASE_MIGRATIONS = "true";
const { getPlatformSql } = await import("../src/platform/server/auth-store.js");
const sql = await getPlatformSql();
const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

try {
  await sql`CREATE SCHEMA IF NOT EXISTS agentic_that`;
  await sql`REVOKE ALL ON SCHEMA agentic_that FROM PUBLIC`;
  await sql`
    CREATE TABLE IF NOT EXISTS agentic_that.schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{12}_[a-z0-9_]+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));

  for (const name of names) {
    const source = await readFile(new URL(name, migrationsDirectory), "utf8");
    const digest = migrationChecksum(source);
    const [applied] = await sql`
      SELECT checksum FROM agentic_that.schema_migrations WHERE name = ${name}`;
    if (applied) {
      if (!migrationChecksumMatches(source, applied.checksum)) {
        throw new Error(`Applied migration ${name} was modified. Create a new migration instead.`);
      }
      continue;
    }

    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext('agentic-that-schema-migrations'))`;
      const [concurrent] = await transaction`
        SELECT checksum FROM agentic_that.schema_migrations WHERE name = ${name}`;
      if (concurrent) {
        if (!migrationChecksumMatches(source, concurrent.checksum)) {
          throw new Error(`Applied migration ${name} has an unexpected checksum.`);
        }
        return;
      }
      await transaction.unsafe(source);
      await transaction`
        INSERT INTO agentic_that.schema_migrations(name, checksum)
        VALUES (${name}, ${digest})`;
    });
    process.stdout.write(`Applied ${name}.\n`);
  }

  const [status] = await sql`
    SELECT
      to_regclass('public.platform_users') IS NOT NULL AS platform_users_ready,
      to_regclass('public.workspace_memberships') IS NOT NULL AS memberships_ready,
      to_regclass('public.rbac_roles') IS NOT NULL AS roles_ready,
      to_regclass('public.companion_devices') IS NOT NULL AS companion_devices_ready,
      to_regclass('public.jobs') IS NOT NULL AS jobs_ready,
      to_regclass('agentic_that.publishing_staged_uploads') IS NOT NULL AS staged_uploads_ready,
      to_regclass('agentic_that.telegram_accounts') IS NOT NULL AS telegram_ready,
      to_regclass('agentic_that.publishing_uploads') IS NOT NULL AS publishing_ready,
      to_regclass('public.platform_auth_tokens') IS NOT NULL AS auth_security_ready,
      to_regclass('public.notification_templates') IS NOT NULL AS notification_templates_ready,
      to_regclass('public.notification_deliveries') IS NOT NULL AS notification_deliveries_ready,
      to_regprocedure('public.companion_claim_jobs(text,text,integer)') IS NOT NULL AS companion_rpc_ready,
      (SELECT value FROM public.job_control_settings WHERE key = 'minimum_companion_version') AS minimum_companion_version`;
  const required = [
    "platform_users_ready", "memberships_ready", "roles_ready", "companion_devices_ready",
    "jobs_ready", "staged_uploads_ready", "telegram_ready", "publishing_ready",
    "auth_security_ready", "notification_templates_ready", "notification_deliveries_ready", "companion_rpc_ready",
  ];
  const missing = required.filter((key) => !status?.[key]);
  if (missing.length || status?.minimum_companion_version !== "2.1.17") {
    throw new Error(`Database verification failed${missing.length ? `: ${missing.join(", ")}` : "."}`);
  }
  process.stdout.write("All platform, messaging, and Companion database migrations are ready.\n");
} finally {
  await sql.end();
}
