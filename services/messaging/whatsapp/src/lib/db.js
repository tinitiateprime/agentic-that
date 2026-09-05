import postgres from "postgres";
import { encryptSecret, hasEncryptionKey } from "./crypto.js";
import { hashPassword, verifyPassword } from "./password.js";

// Single data backend: Supabase (Postgres). Every query in the app goes through
// the `sql` tagged-template client exported here (postgres.js). There is no
// portable/abstraction layer anymore — write Postgres directly.
//
//   const sql = await getSql();
//   const rows = await sql`SELECT * FROM contacts WHERE business_id = ${id}`;
//   await sql.begin(async (tx) => { await tx`INSERT ...`; });
//
// getSql() guarantees the schema migration + first-boot admin have run before
// the first query (lazily, so `next build` never touches the database).

// Supabase / Postgres connection string, from the Supabase dashboard:
//   Project Settings > Database > Connection string (URI).
// Use the pooled "Transaction" connection (port 6543) for serverless/short-lived
// processes, or the direct connection (5432) for a long-running server.
function connectionString() {
  const url = (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — paste your Supabase connection string (Project Settings → Database → Connection string)."
    );
  }
  // Guard against the example placeholder being copied verbatim (which would
  // otherwise surface as a confusing ENOTFOUND DNS error).
  if (url.includes("...") || /\[YOUR-PASSWORD\]/i.test(url) || /aws-\.\.\./.test(url)) {
    throw new Error(
      "DATABASE_URL still contains a placeholder. Use your real Supabase string from " +
        "Project Settings → Database → Connection string (URI), with the actual host " +
        "and your DB password filled in."
    );
  }
  return url;
}

// Return TIMESTAMP/TIMESTAMPTZ columns as ISO-8601 UTC strings instead of Date
// objects. This keeps rows plainly serializable across the Next.js server →
// client boundary and string-safe for the app's date formatting (which does
// e.g. created_at.replace(" ", "T")).
const timestampAsIso = {
  to: 1184,
  from: [1082, 1083, 1114, 1184], // date, timestamp, timestamptz (+ array variants)
  serialize: (v) => (v instanceof Date ? v.toISOString() : v),
  parse: (v) => {
    // Postgres text form, e.g. "2026-07-16 07:22:58.327+00" (timestamptz) or
    // "2026-07-16 07:22:58.327" (timestamp without tz).
    let s = String(v).replace(" ", "T");
    if (/[+-]\d{2}$/.test(s)) s += ":00"; // "+00" -> "+00:00"
    else if (!/([+-]\d{2}:?\d{2}|Z)$/.test(s)) s += "Z"; // no tz -> assume UTC
    const d = new Date(s);
    return isNaN(d.getTime()) ? String(v) : d.toISOString();
  },
};

// Memoize the client + readiness on globalThis so one connection process (and
// one migration run) is shared across hot reloads and route invocations.
const globalForDb = globalThis;
const WHATSAPP_SCHEMA_MIGRATION_KEY = "whatsapp-schema-v2-reactions";

// Create (once) the Supabase client. Lazy on purpose: connectionString() is
// only evaluated on the FIRST query, never at import — so `next build` (and any
// build step without DATABASE_URL in its environment) doesn't fail here. The
// URL is required at runtime, when a request actually hits the database.
function client() {
  if (!globalForDb.__tinitiateSql) {
    globalForDb.__tinitiateSql = postgres(connectionString(), {
      // Safe with Supabase's transaction pooler (pgbouncer), which can't hold
      // server-side prepared statements across pooled connections.
      prepare: false,
      max: Number(process.env.PG_POOL_MAX || (process.env.NETLIFY === "true" ? 1 : 5)),
      idle_timeout: Number(process.env.PG_IDLE_TIMEOUT_SECONDS || (process.env.NETLIFY === "true" ? 5 : 20)),
      connect_timeout: 15,
      onnotice: () => {}, // silence "column already exists, skipping" etc.
      types: { timestamp: timestampAsIso },
    });
  }
  return globalForDb.__tinitiateSql;
}

// Run schema migration + admin bootstrap exactly once, before the first query.
export function ensureReady() {
  if (process.env.NETLIFY === "true" && process.env.RUN_DATABASE_MIGRATIONS !== "true") {
    return Promise.resolve();
  }
  return (globalForDb.__tinitiateDbReady ||= (async () => {
    const sql = client();
    await ensureSchema(sql);
    await bootstrapAdmin(sql);
    await migrateLegacyEnvAccount(sql);
  })());
}

async function ensureSchema(sql) {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${WHATSAPP_SCHEMA_MIGRATION_KEY}))`;
    const [registry] = await tx`
      SELECT to_regclass('public.app_schema_migrations') AS relation`;
    if (registry?.relation) {
      const [applied] = await tx`
        SELECT key FROM app_schema_migrations
         WHERE key = ${WHATSAPP_SCHEMA_MIGRATION_KEY}
         LIMIT 1`;
      if (applied) return;
    }

    await migrate(tx);
    await tx`
      CREATE TABLE IF NOT EXISTS app_schema_migrations (
        key        TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await tx`
      INSERT INTO app_schema_migrations (key)
      VALUES (${WHATSAPP_SCHEMA_MIGRATION_KEY})
      ON CONFLICT (key) DO NOTHING`;
  });
}

// Deployment migrations intentionally run only DDL. Account bootstrapping and
// environment credential imports belong to normal application startup and
// must not be an incidental side effect of a build command.
export async function migrateWhatsAppSchema() {
  const sql = client();
  await ensureSchema(sql);
  return sql;
}

// Acquire the Supabase client, guaranteeing migrations have run. Use this in
// every data-access function.
export async function getSql() {
  await ensureReady();
  return client();
}

async function bootstrapAdmin(sql) {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || !password) return;

  const [existing] = await sql`
    SELECT id, business_id, password_hash FROM users WHERE LOWER(email) = ${email}`;
  if (existing) {
    if (!verifyPassword(password, existing.password_hash)) {
      await sql`UPDATE users SET password_hash = ${hashPassword(password)} WHERE id = ${existing.id}`;
    }
    if (legacyEnvReady()) {
      await sql`
        UPDATE businesses SET onboarded_at = COALESCE(onboarded_at, now())
         WHERE id = ${existing.business_id}`;
    }
    return;
  }

  const [biz] = await sql`
    INSERT INTO businesses (name, admin_number, provider, currency, onboarded_at)
    VALUES (${process.env.BUSINESS_NAME || "My Business"}, ${process.env.WA_FROM || ""},
            ${process.env.WA_PROVIDER || "mock"}, ${process.env.CURRENCY || "INR"},
            ${legacyEnvReady() ? new Date() : null})
    RETURNING id`;
  await sql`
    INSERT INTO users (business_id, name, email, password_hash, role)
    VALUES (${biz.id}, 'Admin', ${email}, ${hashPassword(password)}, 'admin')`;
}

function legacyEnvReady() {
  const provider = (process.env.WA_PROVIDER || "mock").trim().toLowerCase();
  if (provider === "mock") return true;
  if (provider === "meta") {
    return Boolean(
      (process.env.META_ACCESS_TOKEN || "").trim() &&
      (process.env.META_WABA_ID || "").trim() &&
      (process.env.META_PHONE_NUMBER_ID || "").trim()
    );
  }
  if (provider === "wati") {
    return Boolean(
      (process.env.WATI_API_URL || "").trim() &&
      (process.env.WATI_ACCESS_TOKEN || "").trim()
    );
  }
  if (provider === "baileys") {
    return Boolean((process.env.BAILEYS_SERVICE_URL || "").trim());
  }
  return false;
}

// Upgrade the original environment-configured Meta workspace into the new
// tenant tables. This keeps its webhook routable after other tenants connect,
// while new workspaces never inherit the deployment owner's Meta token.
async function migrateLegacyEnvAccount(sql) {
  if (!hasEncryptionKey()) return;
  if ((process.env.WA_PROVIDER || "mock").trim().toLowerCase() !== "meta") return;

  const wabaId = (process.env.META_WABA_ID || "").trim();
  const accessToken = (process.env.META_ACCESS_TOKEN || "").trim();
  if (!wabaId || !accessToken) return;

  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  let business;
  if (adminEmail) {
    [business] = await sql`
      SELECT b.id FROM businesses b
      JOIN users u ON u.business_id = b.id
      WHERE LOWER(u.email) = ${adminEmail}
      ORDER BY b.id LIMIT 1`;
  }
  if (!business) {
    [business] = await sql`SELECT id FROM businesses ORDER BY id LIMIT 1`;
  }
  if (!business) return;

  const [account] = await sql`
    INSERT INTO whatsapp_accounts
      (business_id, provider, waba_id, access_token, app_id, app_secret,
       api_version, webhook_verify_token, onboarding_source, status)
    VALUES
      (${business.id}, 'meta', ${wabaId}, ${encryptSecret(accessToken)},
       ${(process.env.META_APP_ID || "").trim() || null},
       ${encryptSecret((process.env.META_APP_SECRET || "").trim() || null)},
       ${process.env.META_API_VERSION || "v21.0"},
       ${encryptSecret((process.env.META_WEBHOOK_VERIFY_TOKEN || "").trim() || null)},
       'env-import', 'active')
    ON CONFLICT (waba_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      app_id = COALESCE(EXCLUDED.app_id, whatsapp_accounts.app_id),
      app_secret = COALESCE(EXCLUDED.app_secret, whatsapp_accounts.app_secret),
      api_version = EXCLUDED.api_version,
      webhook_verify_token = COALESCE(
        EXCLUDED.webhook_verify_token,
        whatsapp_accounts.webhook_verify_token
      ),
      onboarding_source = 'env-import',
      status = 'active',
      updated_at = now()
    -- A WABA is globally unique. Refresh only the deployment owner's existing
    -- row; never let environment credentials take an account from another
    -- tenant. Besides keeping env changes current, this re-encrypts legacy
    -- credentials after an encryption-key rotation instead of crashing every
    -- authenticated page while trying to decrypt stale ciphertext.
    WHERE whatsapp_accounts.business_id = EXCLUDED.business_id
    RETURNING id`;

  const [storedAccount] = account
    ? [account]
    : await sql`
        SELECT id FROM whatsapp_accounts
         WHERE business_id = ${business.id} AND waba_id = ${wabaId}
         LIMIT 1`;

  const phoneNumberId = (process.env.META_PHONE_NUMBER_ID || "").trim();
  if (storedAccount && phoneNumberId) {
    await sql`
      INSERT INTO whatsapp_numbers
        (whatsapp_account_id, phone_number_id, display_number, is_default, status)
      VALUES
        (${storedAccount.id}, ${phoneNumberId}, ${(process.env.WA_FROM || "").trim() || null}, true, 'CONNECTED')
      ON CONFLICT (phone_number_id) DO UPDATE SET
        whatsapp_account_id = EXCLUDED.whatsapp_account_id,
        display_number = COALESCE(EXCLUDED.display_number, whatsapp_numbers.display_number),
        is_default = true,
        updated_at = now()
      WHERE whatsapp_numbers.whatsapp_account_id = EXCLUDED.whatsapp_account_id`;
  }

  if (storedAccount) {
    await sql`
      UPDATE businesses
         SET provider = 'meta', active_wa_provider = 'meta', onboarded_at = COALESCE(onboarded_at, now())
       WHERE id = ${business.id}`;
  }
}

// Schema — uses SERIAL/INTEGER (int4) ids on purpose: postgres.js returns
// int8/bigint as strings (precision-safe) but int4 as JS numbers, so the app's
// id handling (URLs, equality, Math.max on message ids) works on plain numbers.
// Idempotent — safe to run on every cold start.
async function migrate(sql) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS businesses (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      admin_number  TEXT,
      provider      TEXT NOT NULL DEFAULT 'mock',
      currency      TEXT NOT NULL DEFAULT 'INR',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS platform_workspace_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_platform_workspace_id
       ON businesses(platform_workspace_id) WHERE platform_workspace_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // Stable bridge to the AgenticThat account. Legacy users are claimed only
    // after both the central and legacy sessions prove the mapping; email is
    // never used as ownership proof.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_user_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_platform_user_id
       ON users(platform_user_id) WHERE platform_user_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // One onboarded WhatsApp Business Account per tenant. waba_id is UNIQUE
    // because it's the webhook routing key: Meta puts the WABA id in
    // entry[].id, which is how we tell whose event just arrived.
    // Secrets are encrypted at rest (lib/crypto.js) — never plaintext.
    `CREATE TABLE IF NOT EXISTS whatsapp_accounts (
      id                   SERIAL PRIMARY KEY,
      business_id          INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      provider             TEXT NOT NULL DEFAULT 'meta',
      waba_id              TEXT NOT NULL UNIQUE,
      access_token         TEXT,
      token_expires_at     TIMESTAMPTZ,
      app_id               TEXT,
      app_secret           TEXT,
      api_version          TEXT NOT NULL DEFAULT 'v21.0',
      webhook_verify_token TEXT,
      app_subscribed       BOOLEAN NOT NULL DEFAULT false,
      onboarding_source    TEXT NOT NULL DEFAULT 'manual',
      status               TEXT NOT NULL DEFAULT 'pending',
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_wa_accounts_business ON whatsapp_accounts(business_id)`,
    // Base URL of a Baileys connection service (see ../baileys-wa-app) for
    // accounts with provider='baileys'. Unused by other providers.
    `ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS service_url TEXT`,
    // Which of a business's whatsapp_accounts rows is live. Null keeps today's
    // behavior (the first row by id) — see getAccountForBusiness() in
    // lib/tenant.js. Lets a business hold both a Meta and a Baileys account
    // and switch between them instead of one overwriting the other.
    `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS active_wa_provider TEXT`,
    // Sender numbers under a WABA. phone_number_id is UNIQUE so inbound events
    // and per-message "via <number>" tags resolve unambiguously.
    `CREATE TABLE IF NOT EXISTS whatsapp_numbers (
      id                  SERIAL PRIMARY KEY,
      whatsapp_account_id INTEGER NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
      phone_number_id     TEXT NOT NULL UNIQUE,
      display_number      TEXT,
      verified_name       TEXT,
      is_default          BOOLEAN NOT NULL DEFAULT false,
      quality_rating      TEXT,
      calling_status      TEXT,
      status              TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_wa_numbers_account ON whatsapp_numbers(whatsapp_account_id)`,
    `CREATE TABLE IF NOT EXISTS contacts (
      id               SERIAL PRIMARY KEY,
      business_id      INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      phone            TEXT NOT NULL,
      tags             TEXT,
      notes            TEXT,
      opted_in         INTEGER NOT NULL DEFAULT 1,
      last_activity_at TIMESTAMPTZ,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(business_id, phone)
    )`,
    // is_temp marks a throwaway group built from a live list (e.g. "everyone
    // with unread replies"). Temp groups are hidden from the main Groups list
    // and deleted once expires_at passes — see purgeExpiredTempGroups().
    `CREATE TABLE IF NOT EXISTS groups (
      id          SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      is_temp     BOOLEAN NOT NULL DEFAULT false,
      expires_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS group_members (
      group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, contact_id)
    )`,
    `CREATE TABLE IF NOT EXISTS templates (
      id          SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'marketing',
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id            SERIAL PRIMARY KEY,
      business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      contact_id    INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      direction     TEXT NOT NULL,
      body          TEXT NOT NULL,
      template_name TEXT,
      status        TEXT NOT NULL DEFAULT 'queued',
      provider_id   TEXT,
      kind          TEXT NOT NULL DEFAULT 'text',
      buttons       TEXT,
      reply_to_id   INTEGER,
      phone_number_id TEXT,
      reaction      TEXT,
      reaction_at   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // WhatsApp Business Calling API call log. One row per call, keyed by Meta's
    // call id (wacid) so repeated webhook events (call_created → connect →
    // terminate) update the same row rather than inserting duplicates.
    `CREATE TABLE IF NOT EXISTS calls (
      id              SERIAL PRIMARY KEY,
      business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      call_id         TEXT UNIQUE,
      direction       TEXT NOT NULL DEFAULT 'in',
      status          TEXT NOT NULL DEFAULT 'ringing',
      event           TEXT,
      meta_status     TEXT,
      phone_number_id TEXT,
      start_time      TIMESTAMPTZ,
      end_time        TIMESTAMPTZ,
      duration        INTEGER NOT NULL DEFAULT 0,
      acknowledged_at TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_calls_contact ON calls(contact_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_calls_business_status ON calls(business_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, created_at)`,
    // Idempotent add-columns for pre-existing databases.
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text'`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS buttons TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS phone_number_id TEXT`,
    // Which provider actually carried this message (meta/baileys/wati/mock).
    // Lets replies to a contact auto-route through whichever channel they
    // last messaged on, same idea as phone_number_id but across providers —
    // see lastInboundProvider() in lib/data.js.
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider TEXT`,
    // Reactions update an existing message instead of creating a new row.
    // reaction_at is the cursor used by open conversations to receive those
    // in-place changes without reloading the full history.
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reaction TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reaction_at TIMESTAMPTZ`,
    `CREATE INDEX IF NOT EXISTS idx_messages_reaction ON messages(business_id, reaction_at)`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_read_message_id INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_temp BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `CREATE INDEX IF NOT EXISTS idx_groups_temp ON groups(business_id, is_temp)`,
    // Automated welcome message: the first time a brand-new contact messages
    // one of the business's numbers, greet them with an APPROVED WhatsApp
    // template (an inbound message opens the 24h window, but a template is
    // what Meta expects for a business-authored greeting and is what survives
    // if the window has already lapsed). Configured in Settings > Welcome
    // message; welcome_template_params is a JSON array of values for the
    // template's placeholders, each supporting the same {{name}}/{{business}}
    // tokens as the CRM's canned templates. welcome_template_body is a cached
    // copy of Meta's approved body text, used only to render the chat preview.
    `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS welcome_enabled BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS welcome_template_name TEXT`,
    `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS welcome_template_language TEXT`,
    `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS welcome_template_params TEXT`,
    `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS welcome_template_body TEXT`,
    // Set the moment a welcome is claimed for a contact (see maybeSendWelcome
    // in lib/wa/messaging.js) so retried webhooks and concurrent deliveries
    // can never greet the same person twice.
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS welcome_sent_at TIMESTAMPTZ`,
    // Self-serve onboarding: null until the workspace finishes setup, which is
    // what the /onboarding guard checks. Existing installs are backfilled below
    // so they aren't bounced into the wizard.
    `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ`,
    `UPDATE businesses SET onboarded_at = now()
      WHERE onboarded_at IS NULL
        AND EXISTS (SELECT 1 FROM whatsapp_accounts a WHERE a.business_id = businesses.id)`,
  ];
  for (const ddl of statements) await sql.unsafe(ddl);
}
