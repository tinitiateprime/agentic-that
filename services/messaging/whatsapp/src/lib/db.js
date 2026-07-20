import postgres from "postgres";
import { hashPassword, verifyPassword } from "./password.js";

// Single data backend: PostgreSQL. Every query in the app goes through the
// postgres.js tagged-template client returned by getSql().
//
//   const sql = await getSql();
//   const rows = await sql`SELECT * FROM contacts WHERE business_id = ${id}`;
//   await sql.begin(async (tx) => { await tx`INSERT ...`; });
//
// getSql() guarantees the schema migration + first-boot admin have run before
// the first query. It is lazy, so next build never touches the database.

function runtimeEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

// Use a serverless-compatible pooled PostgreSQL connection for Netlify and a
// direct connection for a long-running local server.
function connectionString() {
  const url = runtimeEnv("DATABASE_URL").trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set. Add a serverless-compatible pooled PostgreSQL connection URL.");
  }

  // Guard against the example placeholder being copied verbatim.
  if (url.includes("...") || /\[YOUR-PASSWORD\]/i.test(url) || /aws-\.\.\./.test(url)) {
    throw new Error("DATABASE_URL still contains a placeholder. Add the real database host, credentials, and database name.");
  }
  return url;
}

// Return TIMESTAMP/TIMESTAMPTZ columns as ISO-8601 UTC strings instead of Date
// objects. This keeps rows plainly serializable across the Next.js server to
// client boundary and string-safe for the app's date formatting.
const timestampAsIso = {
  to: 1184,
  from: [1082, 1083, 1114, 1184],
  serialize: (v) => (v instanceof Date ? v.toISOString() : v),
  parse: (v) => {
    let s = String(v).replace(" ", "T");
    if (/[+-]\d{2}$/.test(s)) s += ":00";
    else if (!/([+-]\d{2}:?\d{2}|Z)$/.test(s)) s += "Z";
    const d = new Date(s);
    return isNaN(d.getTime()) ? String(v) : d.toISOString();
  },
};

// Memoize the client + readiness on globalThis so one connection process and
// one migration run are shared across hot reloads and route invocations.
const globalForDb = globalThis;

function getClient() {
  return globalForDb.__tinitiateSql || (globalForDb.__tinitiateSql = postgres(connectionString(), {
    // Serverless transaction poolers cannot retain prepared statements across
    // pooled connections.
    prepare: false,
    max: Number(process.env.PG_POOL_MAX || 5),
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    types: { timestamp: timestampAsIso },
  }));
}

export function ensureReady() {
  const client = getClient();
  return (globalForDb.__tinitiateDbReady ||= migrate(client).then(() => bootstrapAdmin(client)));
}

export async function getSql() {
  await ensureReady();
  return getClient();
}

async function bootstrapAdmin(sql) {
  const email = runtimeEnv("ADMIN_EMAIL").trim();
  const password = runtimeEnv("ADMIN_PASSWORD");
  if (!email || !password) return;

  const [existing] = await sql`SELECT id, password_hash FROM users WHERE email = ${email}`;
  if (existing) {
    if (!verifyPassword(password, existing.password_hash)) {
      await sql`UPDATE users SET password_hash = ${hashPassword(password)} WHERE id = ${existing.id}`;
    }
    return;
  }

  let [biz] = await sql`SELECT id FROM businesses ORDER BY id LIMIT 1`;
  if (!biz) {
    [biz] = await sql`
      INSERT INTO businesses (name, admin_number, provider, currency)
      VALUES (${runtimeEnv("BUSINESS_NAME", "My Business")}, ${runtimeEnv("WA_FROM")},
              ${runtimeEnv("WA_PROVIDER", "mock")}, ${runtimeEnv("CURRENCY", "INR")})
      RETURNING id`;
  }

  await sql`
    INSERT INTO users (business_id, name, email, password_hash, role)
    VALUES (${biz.id}, 'Admin', ${email}, ${hashPassword(password)}, 'admin')`;
}

// Schema uses SERIAL/INTEGER (int4) ids on purpose: postgres.js returns
// int8/bigint as strings, but int4 as JS numbers. That keeps the app's id
// handling simple for URLs, equality checks, and Math.max on message ids.
// These statements are idempotent and safe to run on every cold start.
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
    `CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
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
    `CREATE TABLE IF NOT EXISTS groups (
      id          SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
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
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, created_at)`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text'`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS buttons TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS phone_number_id TEXT`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_read_message_id INTEGER NOT NULL DEFAULT 0`,
  ];

  for (const ddl of statements) await sql.unsafe(ddl);
}
