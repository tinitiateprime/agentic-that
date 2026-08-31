BEGIN;

CREATE TABLE IF NOT EXISTS automation_schema_migrations (
  key        text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL,
  platform     text NOT NULL CHECK (platform IN ('instagram', 'facebook', 'x', 'linkedin', 'youtube')),
  display_name text NOT NULL,
  status       text NOT NULL DEFAULT 'PENDING_LOGIN'
               CHECK (status IN ('PENDING_LOGIN', 'CONNECTED', 'LOGIN_REQUIRED', 'PAUSED', 'DISABLED')),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS social_accounts_workspace_idx
  ON social_accounts (workspace_id, platform);

CREATE TABLE IF NOT EXISTS browser_profiles (
  account_id             text PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,
  workspace_id           text NOT NULL,
  storage_key            text NOT NULL UNIQUE,
  version                bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  blob_etag              text,
  content_sha256         text,
  encrypted_size_bytes   bigint,
  encryption_key_id      text,
  encryption_key_version text,
  encryption_state       text NOT NULL DEFAULT 'ENCRYPTED'
                         CHECK (encryption_state IN ('LOCAL_DEVELOPMENT_ONLY', 'ENCRYPTED')),
  last_saved_at          timestamptz,
  created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at             timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS login_sessions (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL,
  account_id    text NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('instagram', 'facebook', 'x', 'linkedin', 'youtube')),
  surface       text NOT NULL DEFAULT 'visible' CHECK (surface IN ('visible', 'website')),
  state         text NOT NULL
                CHECK (state IN ('STARTING', 'AWAITING_USER', 'CONNECTED', 'FAILED', 'CANCELLED', 'EXPIRED')),
  error_code    text,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS login_sessions_account_idx
  ON login_sessions (account_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS login_sessions_one_active_account_idx
  ON login_sessions (account_id)
  WHERE state IN ('STARTING', 'AWAITING_USER');

CREATE TABLE IF NOT EXISTS publishing_jobs (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL,
  account_id        text NOT NULL REFERENCES social_accounts(id),
  execution_mode    text NOT NULL DEFAULT 'LIVE' CHECK (execution_mode IN ('DRY_RUN', 'LIVE')),
  validation_stage  text NOT NULL DEFAULT 'LOCAL' CHECK (validation_stage IN ('LOCAL', 'INSTAGRAM_PREVIEW')),
  live_authorized   boolean NOT NULL DEFAULT false,
  state             text NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (state IN ('SCHEDULED', 'PUBLISHING', 'VERIFYING', 'PUBLISHED', 'FAILED', 'LOGIN_REQUIRED', 'UNCERTAIN', 'CANCELLED')),
  scheduled_at      timestamptz NOT NULL,
  original_timezone text NOT NULL DEFAULT 'UTC',
  caption           text NOT NULL DEFAULT '',
  media             jsonb NOT NULL DEFAULT '[]'::jsonb,
  platform_options  jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key   text NOT NULL,
  lease_owner       text,
  lease_expires_at  timestamptz,
  fencing_token     bigint,
  attempt_count     integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  platform_post_id  text,
  platform_post_url text,
  error_code        text,
  error_message     text,
  progress_message  text,
  resolved_by       text,
  resolved_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS publishing_jobs_due_idx
  ON publishing_jobs (execution_mode, validation_stage, scheduled_at, created_at)
  WHERE state = 'SCHEDULED';
CREATE INDEX IF NOT EXISTS publishing_jobs_workspace_idx
  ON publishing_jobs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publishing_jobs_account_idx
  ON publishing_jobs (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publishing_jobs_expired_lease_idx
  ON publishing_jobs (lease_expires_at)
  WHERE state IN ('PUBLISHING', 'VERIFYING');

CREATE TABLE IF NOT EXISTS account_execution_locks (
  account_id       text PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,
  lease_owner      text,
  lease_expires_at timestamptz NOT NULL DEFAULT '-infinity'::timestamptz,
  fencing_token    bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  updated_at       timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS publishing_attempts (
  id            text PRIMARY KEY,
  job_id        text NOT NULL REFERENCES publishing_jobs(id) ON DELETE CASCADE,
  account_id    text NOT NULL REFERENCES social_accounts(id),
  worker_id     text NOT NULL,
  fencing_token bigint NOT NULL,
  state         text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at  timestamptz,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (job_id, fencing_token)
);

CREATE INDEX IF NOT EXISTS publishing_attempts_job_idx
  ON publishing_attempts (job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS scraping_jobs (
  id               text PRIMARY KEY,
  workspace_id     text NOT NULL,
  platform         text NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  public_url       text NOT NULL,
  input            jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key  text NOT NULL,
  state            text NOT NULL DEFAULT 'SCHEDULED'
                   CHECK (state IN ('SCHEDULED', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED')),
  result_key       text,
  scheduled_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner      text,
  lease_expires_at timestamptz,
  fencing_token    bigint,
  attempt_count    integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_code       text,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at     timestamptz,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS scraping_jobs_due_idx
  ON scraping_jobs (scheduled_at, created_at) WHERE state = 'SCHEDULED';
CREATE INDEX IF NOT EXISTS scraping_jobs_workspace_idx
  ON scraping_jobs (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_events (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL,
  job_id       text NOT NULL,
  job_type     text NOT NULL CHECK (job_type IN ('publishing', 'scraping')),
  event_type   text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS job_events_job_idx
  ON job_events (job_id, created_at);

ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE browser_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_execution_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agenticthat_automation') THEN
    CREATE ROLE agenticthat_automation NOLOGIN;
  END IF;
END
$role$;

GRANT USAGE ON SCHEMA public TO agenticthat_automation;
REVOKE ALL ON TABLE automation_schema_migrations FROM PUBLIC;
GRANT SELECT ON TABLE automation_schema_migrations TO agenticthat_automation;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  social_accounts, browser_profiles, login_sessions, publishing_jobs,
  account_execution_locks, publishing_attempts, scraping_jobs, job_events
  TO agenticthat_automation;

DROP POLICY IF EXISTS automation_social_accounts ON social_accounts;
DROP POLICY IF EXISTS automation_browser_profiles ON browser_profiles;
DROP POLICY IF EXISTS automation_login_sessions ON login_sessions;
DROP POLICY IF EXISTS automation_publishing_jobs ON publishing_jobs;
DROP POLICY IF EXISTS automation_account_locks ON account_execution_locks;
DROP POLICY IF EXISTS automation_publishing_attempts ON publishing_attempts;
DROP POLICY IF EXISTS automation_scraping_jobs ON scraping_jobs;
DROP POLICY IF EXISTS automation_job_events ON job_events;
CREATE POLICY automation_social_accounts ON social_accounts FOR ALL TO agenticthat_automation USING (true) WITH CHECK (true);
CREATE POLICY automation_browser_profiles ON browser_profiles FOR ALL TO agenticthat_automation USING (true) WITH CHECK (true);
CREATE POLICY automation_login_sessions ON login_sessions FOR ALL TO agenticthat_automation USING (true) WITH CHECK (true);
CREATE POLICY automation_publishing_jobs ON publishing_jobs FOR ALL TO agenticthat_automation USING (true) WITH CHECK (true);
CREATE POLICY automation_account_locks ON account_execution_locks FOR ALL TO agenticthat_automation USING (true) WITH CHECK (true);
CREATE POLICY automation_publishing_attempts ON publishing_attempts FOR ALL TO agenticthat_automation USING (true) WITH CHECK (true);
CREATE POLICY automation_scraping_jobs ON scraping_jobs FOR ALL TO agenticthat_automation USING (true) WITH CHECK (true);
CREATE POLICY automation_job_events ON job_events FOR ALL TO agenticthat_automation USING (true) WITH CHECK (true);

DO $security$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE social_accounts, browser_profiles, login_sessions,
      publishing_jobs, account_execution_locks, publishing_attempts,
      scraping_jobs, job_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE social_accounts, browser_profiles, login_sessions,
      publishing_jobs, account_execution_locks, publishing_attempts,
      scraping_jobs, job_events FROM authenticated;
  END IF;
END
$security$;

INSERT INTO automation_schema_migrations (key)
VALUES ('production-pilot-postgres-v1')
ON CONFLICT (key) DO NOTHING;

COMMIT;
