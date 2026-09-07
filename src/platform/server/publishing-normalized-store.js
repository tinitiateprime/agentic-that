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

async function readNormalizedDocument(transaction, initialValue, workspaceId = "") {
  const document = await emptyDocument(initialValue);
  const workspaceFilter = workspaceId ? " WHERE workspace_id = $1" : "";
  const query = Object.entries(TABLES)
    .map(([collection, table]) => `SELECT '${collection}' AS collection, record FROM ${table}${workspaceFilter}`)
    .join(" UNION ALL ");
  const rows = await transaction.unsafe(query, workspaceId ? [workspaceId] : []);
  for (const collection of Object.keys(TABLES)) document[collection] = [];
  for (const row of rows) {
    if (!Object.hasOwn(TABLES, row.collection)) continue;
    let record = row.record;
    if (typeof record === "string") {
      try {
        record = JSON.parse(record);
      } catch {
        record = null;
      }
    }
    if (record && typeof record === "object") document[row.collection].push(record);
  }
  document.stagedUploads = [];
  return document;
}

function recordTimestamp(record, field = "updatedAt") {
  const parsed = new Date(record?.[field] || Date.now());
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

async function replaceNormalizedDocument(transaction, document, workspaceId = "") {
  const payload = {};
  for (const collection of Object.keys(TABLES)) {
    const timestampField = collection === "activityLogs"
      ? "createdAt"
      : collection === "pairingChallenges" ? "expiresAt" : "updatedAt";
    payload[collection] = (Array.isArray(document[collection]) ? document[collection] : [])
      .filter((record) => record?.id && record?.workspaceId && (!workspaceId || String(record.workspaceId) === workspaceId))
      .map((record) => ({
        ...record,
        id: String(record.id),
        workspaceId: String(record.workspaceId),
        [timestampField]: recordTimestamp(record, timestampField),
      }));
  }

  // Persist the complete workspace in one database round trip. The previous
  // row-by-row replacement amplified normal network latency into 30-second
  // Netlify timeouts once a workspace had publishing history.
  await transaction.unsafe(`
    WITH
    account_records AS (
      SELECT value AS record FROM jsonb_array_elements(coalesce($1::jsonb->'accounts', '[]'::jsonb))
    ),
    upload_records AS (
      SELECT value AS record FROM jsonb_array_elements(coalesce($1::jsonb->'uploads', '[]'::jsonb))
    ),
    submission_records AS (
      SELECT value AS record FROM jsonb_array_elements(coalesce($1::jsonb->'submissions', '[]'::jsonb))
    ),
    schedule_records AS (
      SELECT value AS record FROM jsonb_array_elements(coalesce($1::jsonb->'schedules', '[]'::jsonb))
    ),
    activity_records AS (
      SELECT value AS record FROM jsonb_array_elements(coalesce($1::jsonb->'activityLogs', '[]'::jsonb))
    ),
    job_records AS (
      SELECT value AS record FROM jsonb_array_elements(coalesce($1::jsonb->'jobs', '[]'::jsonb))
    ),
    companion_records AS (
      SELECT value AS record FROM jsonb_array_elements(coalesce($1::jsonb->'companions', '[]'::jsonb))
    ),
    pairing_records AS (
      SELECT value AS record FROM jsonb_array_elements(coalesce($1::jsonb->'pairingChallenges', '[]'::jsonb))
    ),
    upsert_accounts AS (
      INSERT INTO agentic_that.publishing_accounts(id, workspace_id, updated_at, record)
      SELECT record->>'id', record->>'workspaceId', (record->>'updatedAt')::timestamptz, record FROM account_records
      ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, updated_at = excluded.updated_at, record = excluded.record
      RETURNING id
    ),
    delete_accounts AS (
      DELETE FROM agentic_that.publishing_accounts stored
       WHERE ($2 = '' OR stored.workspace_id = $2)
         AND NOT EXISTS (SELECT 1 FROM account_records incoming WHERE incoming.record->>'id' = stored.id AND incoming.record->>'workspaceId' = stored.workspace_id)
      RETURNING id
    ),
    upsert_uploads AS (
      INSERT INTO agentic_that.publishing_uploads(id, workspace_id, updated_at, record)
      SELECT record->>'id', record->>'workspaceId', (record->>'updatedAt')::timestamptz, record FROM upload_records
      ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, updated_at = excluded.updated_at, record = excluded.record
      RETURNING id
    ),
    delete_uploads AS (
      DELETE FROM agentic_that.publishing_uploads stored
       WHERE ($2 = '' OR stored.workspace_id = $2)
         AND NOT EXISTS (SELECT 1 FROM upload_records incoming WHERE incoming.record->>'id' = stored.id AND incoming.record->>'workspaceId' = stored.workspace_id)
      RETURNING id
    ),
    upsert_submissions AS (
      INSERT INTO agentic_that.publishing_submissions(id, workspace_id, updated_at, record)
      SELECT record->>'id', record->>'workspaceId', (record->>'updatedAt')::timestamptz, record FROM submission_records
      ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, updated_at = excluded.updated_at, record = excluded.record
      RETURNING id
    ),
    delete_submissions AS (
      DELETE FROM agentic_that.publishing_submissions stored
       WHERE ($2 = '' OR stored.workspace_id = $2)
         AND NOT EXISTS (SELECT 1 FROM submission_records incoming WHERE incoming.record->>'id' = stored.id AND incoming.record->>'workspaceId' = stored.workspace_id)
      RETURNING id
    ),
    upsert_schedules AS (
      INSERT INTO agentic_that.publishing_schedules(id, workspace_id, updated_at, record)
      SELECT record->>'id', record->>'workspaceId', (record->>'updatedAt')::timestamptz, record FROM schedule_records
      ON CONFLICT (workspace_id, id) DO UPDATE SET updated_at = excluded.updated_at, record = excluded.record
      RETURNING id
    ),
    delete_schedules AS (
      DELETE FROM agentic_that.publishing_schedules stored
       WHERE ($2 = '' OR stored.workspace_id = $2)
         AND NOT EXISTS (SELECT 1 FROM schedule_records incoming WHERE incoming.record->>'id' = stored.id AND incoming.record->>'workspaceId' = stored.workspace_id)
      RETURNING id
    ),
    upsert_activity AS (
      INSERT INTO agentic_that.publishing_activity_logs(id, workspace_id, created_at, record)
      SELECT record->>'id', record->>'workspaceId', (record->>'createdAt')::timestamptz, record FROM activity_records
      ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, created_at = excluded.created_at, record = excluded.record
      RETURNING id
    ),
    delete_activity AS (
      DELETE FROM agentic_that.publishing_activity_logs stored
       WHERE ($2 = '' OR stored.workspace_id = $2)
         AND NOT EXISTS (SELECT 1 FROM activity_records incoming WHERE incoming.record->>'id' = stored.id AND incoming.record->>'workspaceId' = stored.workspace_id)
      RETURNING id
    ),
    upsert_jobs AS (
      INSERT INTO agentic_that.publishing_legacy_jobs(id, workspace_id, updated_at, record)
      SELECT record->>'id', record->>'workspaceId', (record->>'updatedAt')::timestamptz, record FROM job_records
      ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, updated_at = excluded.updated_at, record = excluded.record
      RETURNING id
    ),
    delete_jobs AS (
      DELETE FROM agentic_that.publishing_legacy_jobs stored
       WHERE ($2 = '' OR stored.workspace_id = $2)
         AND NOT EXISTS (SELECT 1 FROM job_records incoming WHERE incoming.record->>'id' = stored.id AND incoming.record->>'workspaceId' = stored.workspace_id)
      RETURNING id
    ),
    upsert_companions AS (
      INSERT INTO agentic_that.publishing_legacy_companions(id, workspace_id, token_hash, updated_at, record)
      SELECT record->>'id', record->>'workspaceId', nullif(record->>'tokenHash', ''), (record->>'updatedAt')::timestamptz, record FROM companion_records
      ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, token_hash = excluded.token_hash, updated_at = excluded.updated_at, record = excluded.record
      RETURNING id
    ),
    delete_companions AS (
      DELETE FROM agentic_that.publishing_legacy_companions stored
       WHERE ($2 = '' OR stored.workspace_id = $2)
         AND NOT EXISTS (SELECT 1 FROM companion_records incoming WHERE incoming.record->>'id' = stored.id AND incoming.record->>'workspaceId' = stored.workspace_id)
      RETURNING id
    ),
    upsert_pairings AS (
      INSERT INTO agentic_that.publishing_pairing_challenges(id, workspace_id, code_hash, expires_at, record)
      SELECT record->>'id', record->>'workspaceId', record->>'codeHash', (record->>'expiresAt')::timestamptz, record FROM pairing_records
      ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, code_hash = excluded.code_hash, expires_at = excluded.expires_at, record = excluded.record
      RETURNING id
    ),
    delete_pairings AS (
      DELETE FROM agentic_that.publishing_pairing_challenges stored
       WHERE ($2 = '' OR stored.workspace_id = $2)
         AND NOT EXISTS (SELECT 1 FROM pairing_records incoming WHERE incoming.record->>'id' = stored.id AND incoming.record->>'workspaceId' = stored.workspace_id)
      RETURNING id
    )
    SELECT
      (SELECT count(*) FROM upsert_accounts) + (SELECT count(*) FROM delete_accounts)
      + (SELECT count(*) FROM upsert_uploads) + (SELECT count(*) FROM delete_uploads)
      + (SELECT count(*) FROM upsert_submissions) + (SELECT count(*) FROM delete_submissions)
      + (SELECT count(*) FROM upsert_schedules) + (SELECT count(*) FROM delete_schedules)
      + (SELECT count(*) FROM upsert_activity) + (SELECT count(*) FROM delete_activity)
      + (SELECT count(*) FROM upsert_jobs) + (SELECT count(*) FROM delete_jobs)
      + (SELECT count(*) FROM upsert_companions) + (SELECT count(*) FROM delete_companions)
      + (SELECT count(*) FROM upsert_pairings) + (SELECT count(*) FROM delete_pairings) AS affected
  `, [payload, workspaceId]);
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
  readNormalizedDocument,
  replaceNormalizedDocument,
};
