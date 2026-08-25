import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const globalForDatabase = globalThis;
let localMutationQueue = Promise.resolve();

function connectionString() {
  return (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL || "").trim();
}

function hostedRuntime() {
  return process.env.NODE_ENV === "production"
    || process.env.NETLIFY === "true"
    || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
}

function useLocalStore() {
  return !connectionString() && !hostedRuntime();
}

function localStorePath() {
  const configured = process.env.PLATFORM_DOCUMENT_DATA_PATH?.trim();
  return path.resolve(configured || path.join(process.cwd(), "data", "platform-documents.json"));
}

async function readLocalStore() {
  try {
    const value = JSON.parse(await readFile(localStorePath(), "utf8"));
    if (!value || value.version !== 1 || !value.documents || typeof value.documents !== "object" || Array.isArray(value.documents)) {
      throw new Error("The local platform document store has an invalid structure.");
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, documents: {} };
    throw error;
  }
}

async function writeLocalStore(store) {
  const file = localStorePath();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

function queueLocalMutation(operation) {
  const result = localMutationQueue.then(operation, operation);
  localMutationQueue = result.then(() => undefined, () => undefined);
  return result;
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

export async function initializeDatabaseDocument(key, initialValue) {
  if (useLocalStore()) {
    return queueLocalMutation(async () => {
      const store = await readLocalStore();
      if (Object.prototype.hasOwnProperty.call(store.documents, key)) return;
      store.documents[key] = typeof initialValue === "function" ? await initialValue() : initialValue;
      await writeLocalStore(store);
    });
  }
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
  if (useLocalStore()) {
    await localMutationQueue;
    const store = await readLocalStore();
    return Object.prototype.hasOwnProperty.call(store.documents, key) ? store.documents[key] : null;
  }
  const sql = await ensureTable();
  const [row] = await sql`SELECT value FROM agentic_that.app_document_store WHERE key = ${key}`;
  return row?.value ?? null;
}

// The callback returns both the next document and its application-level result.
// SELECT FOR UPDATE prevents two server instances from replacing each other's changes.
export async function mutateDatabaseDocument(key, initialValue, operation) {
  if (useLocalStore()) {
    return queueLocalMutation(async () => {
      const store = await readLocalStore();
      const current = Object.prototype.hasOwnProperty.call(store.documents, key)
        ? store.documents[key]
        : initialValue;
      const { document, result } = await operation(current);
      store.documents[key] = document;
      await writeLocalStore(store);
      return result;
    });
  }
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
    const { document, result } = await operation(row.value);
    await transaction`
      UPDATE agentic_that.app_document_store
      SET value = ${transaction.json(document)}, updated_at = now()
      WHERE key = ${key}
    `;
    return result;
  });
}
