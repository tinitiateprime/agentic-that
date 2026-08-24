import type { AutomationDatabase } from "./database.ts";
import { withImmediateTransaction } from "./database.ts";

const MIGRATION_KEY = "server-architecture-sqlite-v5";

export function migrateAutomationSchema(database: AutomationDatabase) {
  withImmediateTransaction(database, () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        key        TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS social_accounts (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        platform     TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'x', 'linkedin', 'youtube')),
        display_name TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'PENDING_LOGIN'
                     CHECK (status IN ('PENDING_LOGIN', 'CONNECTED', 'LOGIN_REQUIRED', 'PAUSED', 'DISABLED')),
        enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS social_accounts_workspace_idx
        ON social_accounts (workspace_id, platform);

      CREATE TABLE IF NOT EXISTS browser_profiles (
        account_id       TEXT PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,
        storage_key      TEXT NOT NULL UNIQUE,
        version          INTEGER NOT NULL DEFAULT 0,
        encryption_state TEXT NOT NULL DEFAULT 'LOCAL_DEVELOPMENT_ONLY'
                         CHECK (encryption_state IN ('LOCAL_DEVELOPMENT_ONLY', 'ENCRYPTED')),
        last_saved_at    TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS login_sessions (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL,
        account_id    TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        platform      TEXT NOT NULL CHECK (platform IN ('instagram')),
        surface       TEXT NOT NULL DEFAULT 'visible' CHECK (surface IN ('visible', 'website')),
        state         TEXT NOT NULL
                      CHECK (state IN ('STARTING', 'AWAITING_USER', 'CONNECTED', 'FAILED', 'CANCELLED', 'EXPIRED')),
        error_code    TEXT,
        error_message TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        completed_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS login_sessions_account_idx
        ON login_sessions (account_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS login_sessions_one_active_account_idx
        ON login_sessions (account_id)
        WHERE state IN ('STARTING', 'AWAITING_USER');

      CREATE TABLE IF NOT EXISTS publishing_jobs (
        id                TEXT PRIMARY KEY,
        workspace_id      TEXT NOT NULL,
        account_id        TEXT NOT NULL REFERENCES social_accounts(id),
        execution_mode    TEXT NOT NULL DEFAULT 'LIVE' CHECK (execution_mode IN ('DRY_RUN', 'LIVE')),
        validation_stage  TEXT NOT NULL DEFAULT 'LOCAL' CHECK (validation_stage IN ('LOCAL', 'INSTAGRAM_PREVIEW')),
        state             TEXT NOT NULL DEFAULT 'SCHEDULED'
                          CHECK (state IN ('SCHEDULED', 'PUBLISHING', 'VERIFYING', 'PUBLISHED', 'FAILED', 'LOGIN_REQUIRED', 'UNCERTAIN', 'CANCELLED')),
        scheduled_at      TEXT NOT NULL,
        original_timezone TEXT NOT NULL DEFAULT 'UTC',
        caption           TEXT NOT NULL DEFAULT '',
        media             TEXT NOT NULL DEFAULT '[]',
        idempotency_key   TEXT NOT NULL,
        lease_owner       TEXT,
        lease_expires_at  TEXT,
        fencing_token     INTEGER,
        attempt_count     INTEGER NOT NULL DEFAULT 0,
        platform_post_id  TEXT,
        platform_post_url TEXT,
        error_code        TEXT,
        error_message     TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        UNIQUE (workspace_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS publishing_jobs_due_idx
        ON publishing_jobs (state, scheduled_at);
      CREATE INDEX IF NOT EXISTS publishing_jobs_account_idx
        ON publishing_jobs (account_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS account_execution_locks (
        account_id       TEXT PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,
        lease_owner      TEXT,
        lease_expires_at TEXT NOT NULL,
        fencing_token    INTEGER NOT NULL DEFAULT 0,
        updated_at       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS publishing_attempts (
        id            TEXT PRIMARY KEY,
        job_id        TEXT NOT NULL REFERENCES publishing_jobs(id) ON DELETE CASCADE,
        account_id    TEXT NOT NULL REFERENCES social_accounts(id),
        worker_id     TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        state         TEXT NOT NULL,
        started_at    TEXT NOT NULL,
        completed_at  TEXT,
        detail        TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS scraping_jobs (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL,
        platform      TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook')),
        public_url    TEXT NOT NULL,
        state         TEXT NOT NULL DEFAULT 'SCHEDULED'
                      CHECK (state IN ('SCHEDULED', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED')),
        result_key    TEXT,
        error_code    TEXT,
        error_message TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        completed_at  TEXT
      );

      CREATE TABLE IF NOT EXISTS job_events (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        job_id       TEXT NOT NULL,
        job_type     TEXT NOT NULL CHECK (job_type IN ('publishing', 'scraping')),
        event_type   TEXT NOT NULL,
        detail       TEXT NOT NULL DEFAULT '{}',
        created_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS job_events_job_idx
        ON job_events (job_id, created_at);
    `);

    const loginColumns = database.prepare("PRAGMA table_info(login_sessions)").all() as Array<{ name: string }>;
    if (!loginColumns.some(column => column.name === "surface")) {
      database.exec(`
        ALTER TABLE login_sessions
        ADD COLUMN surface TEXT NOT NULL DEFAULT 'visible'
          CHECK (surface IN ('visible', 'website'))
      `);
    }
    const publishingColumns = database.prepare("PRAGMA table_info(publishing_jobs)").all() as Array<{ name: string }>;
    if (!publishingColumns.some(column => column.name === "execution_mode")) {
      database.exec(`
        ALTER TABLE publishing_jobs
        ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'LIVE'
          CHECK (execution_mode IN ('DRY_RUN', 'LIVE'))
      `);
    }
    if (!publishingColumns.some(column => column.name === "validation_stage")) {
      database.exec(`
        ALTER TABLE publishing_jobs
        ADD COLUMN validation_stage TEXT NOT NULL DEFAULT 'LOCAL'
          CHECK (validation_stage IN ('LOCAL', 'INSTAGRAM_PREVIEW'))
      `);
    }
    database.exec(`
      CREATE INDEX IF NOT EXISTS publishing_jobs_mode_due_idx
      ON publishing_jobs (execution_mode, validation_stage, state, scheduled_at)
    `);

    database.prepare(`
      INSERT OR IGNORE INTO schema_migrations (key, applied_at)
      VALUES (?, ?)
    `).run(MIGRATION_KEY, new Date().toISOString());
  });
}

export function automationSchemaReady(database: AutomationDatabase) {
  const row = database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'publishing_jobs'
  `).get() as { name: string } | undefined;
  return row?.name === "publishing_jobs";
}
