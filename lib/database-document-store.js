import postgres from "postgres";

const globalForDatabase = globalThis;

function connectionString() {
  return (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL || "").trim();
}

export function isDatabaseDocumentStoreConfigured() {
  if (["json", "local-json"].includes((process.env.DATA_STORE || "").trim().toLowerCase())) return false;
  return Boolean(connectionString());
}

function client() {
  const url = connectionString();
  if (!url) throw new Error("DATABASE_URL or SUPABASE_DB_URL is required for database persistence.");
  if (url.includes("...") || /\[YOUR-PASSWORD\]/i.test(url) || /aws-\.\.\./.test(url)) {
    throw new Error("The configured database URL is still a placeholder.");
  }

  const sharedDatabaseUrl = (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
  const clientKey = process.env.SUPABASE_DATABASE_URL?.trim() && url !== sharedDatabaseUrl
    ? "__agenticThatDocumentSql"
    : "__tinitiateSql";
  return globalForDatabase[clientKey] || (globalForDatabase[clientKey] = postgres(url, {
    prepare: false,
    max: Number(process.env.PG_POOL_MAX || 5),
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {}
  }));
}

async function ensureTable() {
  const sql = client();
  if (!(globalForDatabase.__agenticThatDocumentStoreReady instanceof Map)) {
    globalForDatabase.__agenticThatDocumentStoreReady = new Map();
  }
  const readiness = globalForDatabase.__agenticThatDocumentStoreReady;
  if (!readiness.has(connectionString())) {
    readiness.set(connectionString(), (async () => {
      await sql`CREATE SCHEMA IF NOT EXISTS agentic_that`;
      await sql`REVOKE ALL ON SCHEMA agentic_that FROM PUBLIC`;
      await sql`
        CREATE TABLE IF NOT EXISTS agentic_that.app_document_store (
          key        TEXT PRIMARY KEY,
          value      JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })());
  }
  await readiness.get(connectionString());
  return sql;
}

// Shared server-side Supabase/Postgres connection for normalized product data.
// Companion processes never receive this connection string; they use the
// token-scoped RPC surface defined by the Supabase job-control migration.
export async function getDatabaseSql() {
  return ensureTable();
}

export async function initializeDatabaseDocument(key, initialValue) {
  const sql = await ensureTable();
  const [existing] = await sql`SELECT 1 AS present FROM agentic_that.app_document_store WHERE key = ${key}`;
  if (existing) return;
  const value = typeof initialValue === "function" ? await initialValue() : initialValue;
  await sql`
    INSERT INTO agentic_that.app_document_store (key, value)
    VALUES (${key}, ${sql.json(value)})
    ON CONFLICT (key) DO NOTHING
  `;
}

export async function readDatabaseDocument(key) {
  const sql = await ensureTable();
  const [row] = await sql`SELECT value FROM agentic_that.app_document_store WHERE key = ${key}`;
  return row?.value ?? null;
}

// The callback returns both the next document and its application-level result.
// SELECT FOR UPDATE prevents two server instances from replacing each other's changes.
export async function mutateDatabaseDocument(key, initialValue, operation) {
  const sql = await ensureTable();
  return sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO agentic_that.app_document_store (key, value)
      VALUES (${key}, ${transaction.json(initialValue)})
      ON CONFLICT (key) DO NOTHING
    `;
    const [row] = await transaction`
      SELECT value FROM agentic_that.app_document_store WHERE key = ${key} FOR UPDATE
    `;
    const { document, result } = await operation(row.value, transaction);
    await transaction`
      UPDATE agentic_that.app_document_store
      SET value = ${transaction.json(document)}, updated_at = now()
      WHERE key = ${key}
    `;
    return result;
  });
}
