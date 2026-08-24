import type { AutomationSql } from "./database.ts";

const MIGRATION_KEY = "server-architecture-v1";

export async function migrateAutomationSchema(sql: AutomationSql) {
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${MIGRATION_KEY}))`;
    await tx`CREATE SCHEMA IF NOT EXISTS agentic_that_server`;
    await tx`REVOKE ALL ON SCHEMA agentic_that_server FROM PUBLIC`;

    await tx`
      CREATE TABLE IF NOT EXISTS agentic_that_server.schema_migrations (
        key        TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    const [applied] = await tx<{ key: string }[]>`
      SELECT key FROM agentic_that_server.schema_migrations WHERE key = ${MIGRATION_KEY}`;
    if (applied) return;

    await tx`
      CREATE TABLE IF NOT EXISTS agentic_that_server.social_accounts (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        platform     TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'x', 'linkedin', 'youtube')),
        display_name TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'PENDING_LOGIN'
                     CHECK (status IN ('PENDING_LOGIN', 'CONNECTED', 'LOGIN_REQUIRED', 'PAUSED', 'DISABLED')),
        enabled      BOOLEAN NOT NULL DEFAULT true,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await tx`
      CREATE INDEX IF NOT EXISTS server_social_accounts_workspace_idx
      ON agentic_that_server.social_accounts (workspace_id, platform)`;

    await tx`
      CREATE TABLE IF NOT EXISTS agentic_that_server.browser_profiles (
        account_id       TEXT PRIMARY KEY REFERENCES agentic_that_server.social_accounts(id) ON DELETE CASCADE,
        storage_key      TEXT NOT NULL UNIQUE,
        version          BIGINT NOT NULL DEFAULT 0,
        encryption_state TEXT NOT NULL DEFAULT 'LOCAL_DEVELOPMENT_ONLY'
                         CHECK (encryption_state IN ('LOCAL_DEVELOPMENT_ONLY', 'ENCRYPTED')),
        last_saved_at    TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;

    await tx`
      CREATE TABLE IF NOT EXISTS agentic_that_server.publishing_jobs (
        id                TEXT PRIMARY KEY,
        workspace_id      TEXT NOT NULL,
        account_id        TEXT NOT NULL REFERENCES agentic_that_server.social_accounts(id),
        state             TEXT NOT NULL DEFAULT 'SCHEDULED'
                          CHECK (state IN ('SCHEDULED', 'PUBLISHING', 'VERIFYING', 'PUBLISHED', 'FAILED', 'LOGIN_REQUIRED', 'UNCERTAIN', 'CANCELLED')),
        scheduled_at      TIMESTAMPTZ NOT NULL,
        original_timezone TEXT NOT NULL DEFAULT 'UTC',
        caption           TEXT NOT NULL DEFAULT '',
        media             JSONB NOT NULL DEFAULT '[]'::jsonb,
        idempotency_key   TEXT NOT NULL,
        lease_owner       TEXT,
        lease_expires_at  TIMESTAMPTZ,
        fencing_token     BIGINT,
        attempt_count     INTEGER NOT NULL DEFAULT 0,
        platform_post_id  TEXT,
        platform_post_url TEXT,
        error_code        TEXT,
        error_message     TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, idempotency_key)
      )`;
    await tx`
      CREATE INDEX IF NOT EXISTS server_publishing_jobs_due_idx
      ON agentic_that_server.publishing_jobs (state, scheduled_at)`;
    await tx`
      CREATE INDEX IF NOT EXISTS server_publishing_jobs_account_idx
      ON agentic_that_server.publishing_jobs (account_id, created_at DESC)`;

    await tx`
      CREATE TABLE IF NOT EXISTS agentic_that_server.account_execution_locks (
        account_id       TEXT PRIMARY KEY REFERENCES agentic_that_server.social_accounts(id) ON DELETE CASCADE,
        lease_owner      TEXT,
        lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
        fencing_token    BIGINT NOT NULL DEFAULT 0,
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;

    await tx`
      CREATE TABLE IF NOT EXISTS agentic_that_server.publishing_attempts (
        id            TEXT PRIMARY KEY,
        job_id        TEXT NOT NULL REFERENCES agentic_that_server.publishing_jobs(id) ON DELETE CASCADE,
        account_id    TEXT NOT NULL REFERENCES agentic_that_server.social_accounts(id),
        worker_id     TEXT NOT NULL,
        fencing_token BIGINT NOT NULL,
        state         TEXT NOT NULL,
        started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at  TIMESTAMPTZ,
        detail        JSONB NOT NULL DEFAULT '{}'::jsonb
      )`;

    await tx`
      CREATE TABLE IF NOT EXISTS agentic_that_server.scraping_jobs (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        platform     TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook')),
        public_url   TEXT NOT NULL,
        state        TEXT NOT NULL DEFAULT 'SCHEDULED'
                     CHECK (state IN ('SCHEDULED', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED')),
        result_key   TEXT,
        error_code   TEXT,
        error_message TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ
      )`;

    await tx`
      CREATE TABLE IF NOT EXISTS agentic_that_server.job_events (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        job_id       TEXT NOT NULL,
        job_type     TEXT NOT NULL CHECK (job_type IN ('publishing', 'scraping')),
        event_type   TEXT NOT NULL,
        detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await tx`
      CREATE INDEX IF NOT EXISTS server_job_events_job_idx
      ON agentic_that_server.job_events (job_id, created_at)`;

    await tx`
      INSERT INTO agentic_that_server.schema_migrations (key)
      VALUES (${MIGRATION_KEY})
      ON CONFLICT (key) DO NOTHING`;
  });
}

export async function automationSchemaReady(sql: AutomationSql) {
  const [status] = await sql<{ relation: string | null }[]>`
    SELECT to_regclass('agentic_that_server.publishing_jobs') AS relation`;
  return Boolean(status?.relation);
}
