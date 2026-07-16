import postgres from "postgres";
import { hashPassword, verifyPassword } from "../../password.js";

// Supabase / Postgres connection string. Get it from the Supabase dashboard:
//   Project Settings > Database > Connection string (URI).
// Use the pooled "Transaction" connection (port 6543) for serverless/short-lived
// processes, or the direct connection (5432) for a long-running server.
function connectionString() {
  const url = (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
  if (!url) {
    throw new Error(
      "Postgres selected (DB_CONNECTOR=postgres) but DATABASE_URL is not set — paste your Supabase connection string."
    );
  }
  // Guard against the example placeholder being copied verbatim (which would
  // otherwise surface as a confusing ENOTFOUND DNS error).
  if (url.includes("...") || /\[YOUR-PASSWORD\]/i.test(url) || /aws-\.\.\./.test(url)) {
    throw new Error(
      "DATABASE_URL still contains a placeholder. Use your real Supabase string from " +
        "Project Settings → Database → Connection string (URI), with the actual host " +
        "(e.g. aws-0-<region>.pooler.supabase.com) and your DB password filled in."
    );
  }
  return url;
}

// App SQL is written with '?' placeholders (portable with the SQLite connector);
// Postgres wants $1,$2,… — rewrite positionally. No '?' appears inside our SQL
// string literals, so a straight count-replace is safe.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${(i += 1)}`);
}

// postgres.js returns TIMESTAMP/TIMESTAMPTZ columns as Date objects, whereas
// the SQLite connector returns timestamp strings. Keep the shared connector
// interface consistent and ensure rows can cross Next.js server boundaries.
function normalizeRow(row) {
  if (!row) return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])
  );
}

export function createPostgresConnector() {
  const sql = postgres(connectionString(), {
    // Safe with Supabase's transaction pooler (pgbouncer) which can't hold
    // server-side prepared statements across pooled connections.
    prepare: false,
    max: Number(process.env.PG_POOL_MAX || 5),
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {}, // silence "column already exists, skipping" etc.
  });

  // Run schema migration + admin bootstrap exactly once, before the first query.
  let ready;
  const ensureReady = () => (ready ||= migrate(sql).then(() => bootstrapAdmin(sql)));

  const exec = async (handle, text, params) => handle.unsafe(toPg(text), params || []);

  function makeApi(handle) {
    return {
      prepare(text) {
        return {
          async get(...params) {
            const rows = await exec(handle, text, params);
            return normalizeRow(rows[0]);
          },
          async all(...params) {
            const rows = await exec(handle, text, params);
            return rows.map(normalizeRow);
          },
          async run(...params) {
            const rows = await exec(handle, text, params);
            return { changes: rows.count ?? rows.length ?? 0 };
          },
        };
      },
    };
  }

  const base = makeApi(sql);

  function prepare(text) {
    // Wrap each call so migrations are guaranteed to have run first.
    const stmt = base.prepare(text);
    return {
      async get(...p) {
        await ensureReady();
        return stmt.get(...p);
      },
      async all(...p) {
        await ensureReady();
        return stmt.all(...p);
      },
      async run(...p) {
        await ensureReady();
        return stmt.run(...p);
      },
    };
  }

  async function tx(fn) {
    await ensureReady();
    return sql.begin(async (t) => fn(makeApi(t)));
  }

  return { kind: "postgres", prepare, tx, raw: sql };
}

function runtimeEnv(parts, fallback = "") {
  return process.env[parts.join("_")] || fallback;
}

async function bootstrapAdmin(sql) {
  const email = runtimeEnv(["ADMIN", "EMAIL"]).trim();
  const password = runtimeEnv(["ADMIN", "PASSWORD"]);
  if (!email || !password) return;
  const [existing] = await sql`SELECT id, password_hash FROM users WHERE email = ${email}`;
  if (existing) {
    if (!verifyPassword(password, existing.password_hash)) {
      await sql`UPDATE users SET password_hash = ${hashPassword(password)} WHERE id = ${existing.id}`;
    }
    return;
  }

  let [business] = await sql`SELECT id FROM businesses ORDER BY id LIMIT 1`;
  if (!business) {
    [business] = await sql`
      INSERT INTO businesses (name, admin_number, provider, currency)
      VALUES (${runtimeEnv(["BUSINESS", "NAME"], "AgenticThat")}, ${runtimeEnv(["WA", "FROM"])},
              ${runtimeEnv(["WA", "PROVIDER"], "mock")}, ${runtimeEnv(["CURRENCY"], "INR")})
      RETURNING id`;
  }
  await sql`
    INSERT INTO users (business_id, name, email, password_hash, role)
    VALUES (${business.id}, 'Admin', ${email}, ${hashPassword(password)}, 'admin')`;
}

// Postgres schema — mirror of the SQLite tables. Uses SERIAL/INTEGER (int4)
// ids on purpose: postgres.js returns int8/bigint as strings (precision-safe)
// but int4 as JS numbers, matching SQLite's INTEGER so the app's id handling
// (URLs, equality, Math.max on message ids) works identically. Idempotent.
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
    // Idempotent add-columns for pre-existing databases.
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text'`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS buttons TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS phone_number_id TEXT`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_read_message_id INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const ddl of statements) await sql.unsafe(ddl);
}
