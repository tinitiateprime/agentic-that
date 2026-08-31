import type { AutomationDatabase } from "./database.ts";
import { withImmediateTransaction } from "./database.ts";

const MIGRATION_KEY = "server-architecture-sqlite-v11";

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
        blob_etag        TEXT,
        content_sha256   TEXT,
        encrypted_size_bytes INTEGER,
        encryption_key_id TEXT,
        encryption_key_version TEXT,
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
        platform      TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'x', 'linkedin', 'youtube')),
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
        live_authorized   INTEGER NOT NULL DEFAULT 0 CHECK (live_authorized IN (0, 1)),
        state             TEXT NOT NULL DEFAULT 'SCHEDULED'
                          CHECK (state IN ('SCHEDULED', 'PUBLISHING', 'VERIFYING', 'PUBLISHED', 'FAILED', 'LOGIN_REQUIRED', 'UNCERTAIN', 'CANCELLED')),
        scheduled_at      TEXT NOT NULL,
        original_timezone TEXT NOT NULL DEFAULT 'UTC',
        caption           TEXT NOT NULL DEFAULT '',
        media             TEXT NOT NULL DEFAULT '[]',
        platform_options  TEXT NOT NULL DEFAULT '{}',
        idempotency_key   TEXT NOT NULL,
        lease_owner       TEXT,
        lease_expires_at  TEXT,
        fencing_token     INTEGER,
        attempt_count     INTEGER NOT NULL DEFAULT 0,
        platform_post_id  TEXT,
        platform_post_url TEXT,
        error_code        TEXT,
        error_message     TEXT,
        progress_message  TEXT,
        resolved_by       TEXT,
        resolved_at       TEXT,
        resolution_note   TEXT,
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
        input         TEXT NOT NULL DEFAULT '{}',
        idempotency_key TEXT,
        state         TEXT NOT NULL DEFAULT 'SCHEDULED'
                      CHECK (state IN ('SCHEDULED', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED')),
        result_key    TEXT,
        scheduled_at  TEXT,
        lease_owner   TEXT,
        lease_expires_at TEXT,
        fencing_token INTEGER,
        attempt_count INTEGER NOT NULL DEFAULT 0,
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
    const loginTable = database.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'login_sessions'
    `).get() as { sql: string } | undefined;
    if (loginTable?.sql && !/platform\s+IN\s*\([^)]*['"]youtube['"]/i.test(loginTable.sql)) {
      database.exec(`
        CREATE TABLE login_sessions_v10 (
          id            TEXT PRIMARY KEY,
          workspace_id  TEXT NOT NULL,
          account_id    TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
          platform      TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'x', 'linkedin', 'youtube')),
          surface       TEXT NOT NULL DEFAULT 'visible' CHECK (surface IN ('visible', 'website')),
          state         TEXT NOT NULL
                        CHECK (state IN ('STARTING', 'AWAITING_USER', 'CONNECTED', 'FAILED', 'CANCELLED', 'EXPIRED')),
          error_code    TEXT,
          error_message TEXT,
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL,
          completed_at  TEXT
        );
        INSERT INTO login_sessions_v10
          (id, workspace_id, account_id, platform, surface, state, error_code, error_message, created_at, updated_at, completed_at)
        SELECT id, workspace_id, account_id, platform, surface, state, error_code, error_message, created_at, updated_at, completed_at
        FROM login_sessions;
        DROP TABLE login_sessions;
        ALTER TABLE login_sessions_v10 RENAME TO login_sessions;
        CREATE INDEX login_sessions_account_idx
          ON login_sessions (account_id, created_at DESC);
        CREATE UNIQUE INDEX login_sessions_one_active_account_idx
          ON login_sessions (account_id)
          WHERE state IN ('STARTING', 'AWAITING_USER');
      `);
    }
    const publishingColumns = database.prepare("PRAGMA table_info(publishing_jobs)").all() as Array<{ name: string }>;
    const scrapingColumns = database.prepare("PRAGMA table_info(scraping_jobs)").all() as Array<{ name: string }>;
    if (!scrapingColumns.some(column => column.name === "input")) {
      database.exec(`ALTER TABLE scraping_jobs ADD COLUMN input TEXT NOT NULL DEFAULT '{}'`);
    }
    if (!scrapingColumns.some(column => column.name === "idempotency_key")) {
      database.exec(`ALTER TABLE scraping_jobs ADD COLUMN idempotency_key TEXT`);
    }
    if (!scrapingColumns.some(column => column.name === "scheduled_at")) {
      database.exec(`ALTER TABLE scraping_jobs ADD COLUMN scheduled_at TEXT`);
      database.exec(`UPDATE scraping_jobs SET scheduled_at = created_at WHERE scheduled_at IS NULL`);
    }
    if (!scrapingColumns.some(column => column.name === "lease_owner")) {
      database.exec(`ALTER TABLE scraping_jobs ADD COLUMN lease_owner TEXT`);
    }
    if (!scrapingColumns.some(column => column.name === "lease_expires_at")) {
      database.exec(`ALTER TABLE scraping_jobs ADD COLUMN lease_expires_at TEXT`);
    }
    if (!scrapingColumns.some(column => column.name === "fencing_token")) {
      database.exec(`ALTER TABLE scraping_jobs ADD COLUMN fencing_token INTEGER`);
    }
    if (!scrapingColumns.some(column => column.name === "attempt_count")) {
      database.exec(`ALTER TABLE scraping_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0`);
    }
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS scraping_jobs_workspace_idempotency_idx
      ON scraping_jobs (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS scraping_jobs_due_idx
      ON scraping_jobs (state, scheduled_at, created_at)
    `);
    const profileColumns = database.prepare("PRAGMA table_info(browser_profiles)").all() as Array<{ name: string }>;
    if (!profileColumns.some(column => column.name === "blob_etag")) {
      database.exec(`ALTER TABLE browser_profiles ADD COLUMN blob_etag TEXT`);
    }
    if (!profileColumns.some(column => column.name === "content_sha256")) {
      database.exec(`ALTER TABLE browser_profiles ADD COLUMN content_sha256 TEXT`);
    }
    if (!profileColumns.some(column => column.name === "encrypted_size_bytes")) {
      database.exec(`ALTER TABLE browser_profiles ADD COLUMN encrypted_size_bytes INTEGER`);
    }
    if (!profileColumns.some(column => column.name === "encryption_key_id")) {
      database.exec(`ALTER TABLE browser_profiles ADD COLUMN encryption_key_id TEXT`);
    }
    if (!profileColumns.some(column => column.name === "encryption_key_version")) {
      database.exec(`ALTER TABLE browser_profiles ADD COLUMN encryption_key_version TEXT`);
    }
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
    if (!publishingColumns.some(column => column.name === "progress_message")) {
      database.exec(`ALTER TABLE publishing_jobs ADD COLUMN progress_message TEXT`);
    }
    if (!publishingColumns.some(column => column.name === "live_authorized")) {
      database.exec(`
        ALTER TABLE publishing_jobs
        ADD COLUMN live_authorized INTEGER NOT NULL DEFAULT 0 CHECK (live_authorized IN (0, 1))
      `);
    }
    if (!publishingColumns.some(column => column.name === "platform_options")) {
      database.exec(`ALTER TABLE publishing_jobs ADD COLUMN platform_options TEXT NOT NULL DEFAULT '{}'`);
    }
    if (!publishingColumns.some(column => column.name === "resolved_by")) {
      database.exec(`ALTER TABLE publishing_jobs ADD COLUMN resolved_by TEXT`);
    }
    if (!publishingColumns.some(column => column.name === "resolved_at")) {
      database.exec(`ALTER TABLE publishing_jobs ADD COLUMN resolved_at TEXT`);
    }
    if (!publishingColumns.some(column => column.name === "resolution_note")) {
      database.exec(`ALTER TABLE publishing_jobs ADD COLUMN resolution_note TEXT`);
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
