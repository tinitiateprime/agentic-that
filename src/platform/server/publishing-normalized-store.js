import {
  initializeDatabaseDocument,
  mutateDatabaseDocument,
  readDatabaseDocument,
  getDatabaseSql,
} from "../../../lib/database-document-store.js";

const LEGACY_KEY = "platform.publishing-central.v1";
const TABLES = Object.freeze({
  accounts: "agentic_that.publishing_accounts",
  uploads: "agentic_that.publishing_uploads",
  submissions: "agentic_that.publishing_submissions",
  schedules: "agentic_that.publishing_schedules",
  activityLogs: "agentic_that.publishing_activity_logs",
  jobs: "agentic_that.publishing_legacy_jobs",
  companions: "agentic_that.publishing_legacy_companions",
  pairingChallenges: "agentic_that.publishing_pairing_challenges",
});

let normalizedReady = false;

function emptyDocument(initialValue) {
  return typeof initialValue === "function" ? initialValue() : structuredClone(initialValue);
}

async function hasNormalizedTables(sql) {
  if (normalizedReady) return true;
  const [row] = await sql`
    SELECT to_regclass('agentic_that.publishing_accounts') IS NOT NULL AS ready`;
  normalizedReady = Boolean(row?.ready);
  return normalizedReady;
}

async function resolveWorkspace(transaction, selector = {}) {
  if (selector.workspaceId) return String(selector.workspaceId);
  if (selector.tokenHash) {
    const rows = await transaction.unsafe(
      "SELECT workspace_id FROM agentic_that.publishing_legacy_companions WHERE token_hash = $1 LIMIT 1",
      [String(selector.tokenHash)],
    );
    return rows[0]?.workspace_id || "";
  }
  if (selector.codeHash) {
    const rows = await transaction.unsafe(
      "SELECT workspace_id FROM agentic_that.publishing_pairing_challenges WHERE code_hash = $1 LIMIT 1",
      [String(selector.codeHash)],
    );
    return rows[0]?.workspace_id || "";
  }
  return "";
}

async function readRows(transaction, table, workspaceId) {
  const rows = workspaceId
    ? await transaction.unsafe(`SELECT record FROM ${table} WHERE workspace_id = $1`, [workspaceId])
    : await transaction.unsafe(`SELECT record FROM ${table}`);
  return rows.map((row) => {
    if (row.record && typeof row.record === "object") return row.record;
    if (typeof row.record !== "string") return null;
    try {
      const parsed = JSON.parse(row.record);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }).filter(Boolean);
}

async function readNormalizedDocument(transaction, initialValue, workspaceId = "") {
  const document = await emptyDocument(initialValue);
  for (const [collection, table] of Object.entries(TABLES)) {
    document[collection] = await readRows(transaction, table, workspaceId);
  }
  document.stagedUploads = [];
  return document;
}

function recordTimestamp(record, field = "updatedAt") {
  const parsed = new Date(record?.[field] || Date.now());
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

async function insertRecord(transaction, collection, record) {
  const id = String(record.id);
  const workspaceId = String(record.workspaceId);
  if (collection === "activityLogs") {
    await transaction.unsafe(
      `INSERT INTO ${TABLES[collection]}(id, workspace_id, created_at, record)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [id, workspaceId, recordTimestamp(record, "createdAt"), record],
    );
    return;
  }
  if (collection === "companions") {
    await transaction.unsafe(
      `INSERT INTO ${TABLES[collection]}(id, workspace_id, token_hash, updated_at, record)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [id, workspaceId, record.tokenHash || null, recordTimestamp(record), record],
    );
    return;
  }
  if (collection === "pairingChallenges") {
    await transaction.unsafe(
      `INSERT INTO ${TABLES[collection]}(id, workspace_id, code_hash, expires_at, record)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [id, workspaceId, String(record.codeHash || ""), recordTimestamp(record, "expiresAt"), record],
    );
    return;
  }
  await transaction.unsafe(
    `INSERT INTO ${TABLES[collection]}(id, workspace_id, updated_at, record)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [id, workspaceId, recordTimestamp(record), record],
  );
}

async function replaceNormalizedDocument(transaction, document, workspaceId = "") {
  for (const [collection, table] of Object.entries(TABLES)) {
    if (workspaceId) {
      await transaction.unsafe(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
    } else {
      await transaction.unsafe(`DELETE FROM ${table}`);
    }
    const records = Array.isArray(document[collection]) ? document[collection] : [];
    for (const record of records) {
      if (!record?.id || !record?.workspaceId) continue;
      if (workspaceId && String(record.workspaceId) !== workspaceId) continue;
      await insertRecord(transaction, collection, record);
    }
  }
}

export async function initializePublishingDocument(key, initialValue) {
  const sql = await getDatabaseSql();
  if (await hasNormalizedTables(sql)) return;
  await initializeDatabaseDocument(key || LEGACY_KEY, initialValue);
}

export async function readPublishingDocument(key, initialValue, selector = {}) {
  const sql = await getDatabaseSql();
  if (!await hasNormalizedTables(sql)) return readDatabaseDocument(key || LEGACY_KEY);
  const workspaceId = await resolveWorkspace(sql, selector);
  return readNormalizedDocument(sql, initialValue, workspaceId);
}

export async function mutatePublishingDocument(key, initialValue, operation, selector = {}) {
  const sql = await getDatabaseSql();
  if (!await hasNormalizedTables(sql)) {
    return mutateDatabaseDocument(key || LEGACY_KEY, await emptyDocument(initialValue), operation);
  }
  return sql.begin(async (transaction) => {
    const workspaceId = await resolveWorkspace(transaction, selector);
    const lockScope = workspaceId || "global";
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${`publishing:${lockScope}`}))`;
    const document = await readNormalizedDocument(transaction, initialValue, workspaceId);
    const { document: nextDocument, result } = await operation(document, transaction);
    await replaceNormalizedDocument(transaction, nextDocument, workspaceId);
    return result;
  });
}

export const publishingNormalizedStoreTestHelpers = {
  TABLES,
  recordTimestamp,
};
