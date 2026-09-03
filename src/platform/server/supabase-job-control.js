import { createHash, randomUUID } from "node:crypto";
import { getDatabaseSql } from "../../../lib/database-document-store.js";

const COMPANION_ONLINE_MS = 90_000;
const PAIRING_TTL_MS = 5 * 60_000;
const ARTIFACT_BUCKET = "job-artifacts";
const ARTIFACT_URL_TTL_SECONDS = 30 * 24 * 60 * 60;
const JOB_TYPES = new Set(["publish", "scrape.instagram", "scrape.facebook"]);
const JOB_PLATFORMS = new Set(["instagram", "facebook", "x", "linkedin", "youtube"]);
const ACTIVE_JOB_STATES = new Set([
  "queued", "waiting_for_companion", "claimed", "running", "opening_platform",
  "uploading", "publishing", "reconnect_required", "cancel_requested",
]);

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function hashToken(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function safeText(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

function publishingEngineForPlatform(platform, requestedEngine = "companion") {
  return platform === "x" || platform === "youtube" || requestedEngine === "external_browser"
    ? "external_browser"
    : "companion";
}

function camelJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.job_type,
    platform: row.platform,
    accountId: row.account_id,
    requestedByUserId: row.requested_by_user_id,
    assignedDeviceId: row.assigned_device_id,
    idempotencyKey: row.idempotency_key,
    priority: row.priority,
    state: row.status,
    status: row.status,
    payload: row.payload || {},
    progress: row.progress || {},
    message: row.message,
    error: row.error,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    leaseExpiresAt: row.lease_expires_at,
    finalActionStartedAt: row.final_action_started_at,
    notBefore: row.not_before,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function camelAccount(row, companion) {
  if (!row) return null;
  const companionStatus = companion?.status || "offline";
  const readiness = !row.enabled
    ? "unavailable"
    : !row.credential_configured
      ? "reconnect_required"
      : companionStatus === "online" ? "ready" : "waiting_for_companion";
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    companionId: row.companion_device_id,
    platform: row.platform,
    displayName: row.display_name,
    handle: row.handle,
    loginIdentifier: row.login_identifier,
    enabled: row.enabled,
    credentialConfigured: row.credential_configured,
    sessionStatus: row.session_status,
    safetyStatus: readiness === "reconnect_required" ? "restricted" : row.safety_status,
    readiness,
    companionStatus,
    executionEngine: publishingEngineForPlatform(row.platform, row.metadata?.executionEngine),
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function versionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value || "").trim());
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(value, minimum) {
  const current = versionParts(value);
  const required = versionParts(minimum);
  if (!current || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== required[index]) return current[index] > required[index];
  }
  return true;
}

function publicDevice(row, minimumVersion = "2.1.2") {
  if (!row) return null;
  const seenAt = Date.parse(row.last_seen_at || "");
  const online = !row.revoked_at && Number.isFinite(seenAt) && Date.now() - seenAt < COMPANION_ONLINE_MS;
  const compatibility = row.version ? (versionAtLeast(row.version, minimumVersion) ? "supported" : "outdated") : "unknown";
  const status = !online
    ? "offline"
    : compatibility === "outdated"
      ? "outdated"
      : ["checking", "downloading", "downloaded", "applying"].includes(row.update_status)
        ? "updating"
        : row.runtime_status === "error" ? "error" : "online";
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    label: row.label,
    companionInstanceId: row.companion_instance_id,
    status,
    version: row.version,
    minimumSupportedVersion: minimumVersion,
    compatibility,
    runtimeStatus: row.runtime_status,
    updateStatus: row.update_status,
    lastError: row.last_error,
    platform: row.platform,
    architecture: row.architecture,
    secureStorage: row.secure_storage,
    lastSeenAt: row.last_seen_at,
    pairedAt: row.paired_at,
    updatedAt: row.updated_at,
  };
}

async function minimumVersion(sql) {
  const [row] = await sql`SELECT value FROM public.job_control_settings WHERE key = 'minimum_companion_version'`;
  return row?.value || "2.1.2";
}

export function supabasePublicConfiguration() {
  const url = safeText(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, 500).replace(/\/$/, "");
  const apiKey = safeText(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      || process.env.SUPABASE_PUBLISHABLE_KEY
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || process.env.SUPABASE_ANON_KEY,
    5000,
  );
  if (!url || !apiKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required for Companion pairing.");
  }
  const parsed = new URL(url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    throw new Error("The Supabase API URL must use HTTPS.");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("The Supabase API URL is invalid.");
  }
  return { supabaseUrl: parsed.origin, supabaseApiKey: apiKey };
}

function supabaseServiceConfiguration() {
  const publicConfiguration = supabasePublicConfiguration();
  const serviceKey = safeText(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, 10000);
  if (!serviceKey) throw new Error("SUPABASE_SECRET_KEY is required for private publishing media.");
  return { ...publicConfiguration, serviceKey };
}

function supabaseApiHeaders(apiKey) {
  const headers = { apikey: apiKey };
  if (!apiKey.startsWith("sb_")) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

function storageObjectPath(workspaceId, fileName) {
  const workspace = encodeURIComponent(safeText(workspaceId, 180));
  const file = encodeURIComponent(safeText(fileName, 240));
  if (!workspace || !file) throw new Error("The private media storage path is invalid.");
  return `${workspace}/${file}`;
}

let artifactBucketReady = null;

async function ensureArtifactBucket(configuration) {
  if (artifactBucketReady) return artifactBucketReady;
  artifactBucketReady = (async () => {
    const response = await fetch(`${configuration.supabaseUrl}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        ...supabaseApiHeaders(configuration.serviceKey),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: ARTIFACT_BUCKET,
        name: ARTIFACT_BUCKET,
        public: false,
        file_size_limit: 524288000,
        allowed_mime_types: ["image/*", "video/*"],
      }),
    });
    if (!response.ok && response.status !== 409) {
      const payload = await response.text().catch(() => "");
      throw new Error(payload || `Could not initialize private media storage (${response.status}).`);
    }
  })().catch((error) => {
    artifactBucketReady = null;
    throw error;
  });
  return artifactBucketReady;
}

async function signedArtifactUrl(configuration, objectPath) {
  const response = await fetch(`${configuration.supabaseUrl}/storage/v1/object/sign/${ARTIFACT_BUCKET}/${objectPath}`, {
    method: "POST",
    headers: {
      ...supabaseApiHeaders(configuration.serviceKey),
      "content-type": "application/json",
    },
    body: JSON.stringify({ expiresIn: ARTIFACT_URL_TTL_SECONDS }),
  });
  const payload = await response.json().catch(() => ({}));
  const signedPath = payload.signedURL || payload.signedUrl;
  if (!response.ok || !signedPath) throw new Error(payload.message || "Could not authorize private media download.");
  return absoluteSignedArtifactUrl(configuration.supabaseUrl, signedPath);
}

function absoluteSignedArtifactUrl(supabaseUrl, signedPath) {
  if (/^https:\/\//i.test(signedPath)) return signedPath;
  const normalizedPath = signedPath.startsWith("/storage/v1/")
    ? signedPath
    : `/storage/v1${signedPath.startsWith("/") ? signedPath : `/${signedPath}`}`;
  return new URL(normalizedPath, supabaseUrl).toString();
}

export async function storeSupabaseJobArtifact(bytes, { workspaceId, fileName, originalName, mimeType }) {
  const configuration = supabaseServiceConfiguration();
  await ensureArtifactBucket(configuration);
  const objectPath = storageObjectPath(workspaceId, fileName);
  const response = await fetch(`${configuration.supabaseUrl}/storage/v1/object/${ARTIFACT_BUCKET}/${objectPath}`, {
    method: "POST",
    headers: {
      ...supabaseApiHeaders(configuration.serviceKey),
      "content-type": mimeType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(payload || `Private media upload failed (${response.status}).`);
  }
  return {
    bucket: ARTIFACT_BUCKET,
    path: decodeURIComponent(objectPath),
    fileName,
    originalName,
    mimeType: mimeType || "application/octet-stream",
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    downloadUrl: await signedArtifactUrl(configuration, objectPath),
    expiresAt: new Date(Date.now() + ARTIFACT_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

export async function createSupabasePairing(principal, input = {}) {
  const sql = await getDatabaseSql();
  const pairingCode = `${randomUUID()}${randomUUID().replaceAll("-", "")}`;
  const challengeId = id("pairing");
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  const label = safeText(input.label || "Workspace Companion", 80) || "Workspace Companion";
  const instanceId = safeText(input.companionInstanceId, 120) || null;
  await sql.begin(async (tx) => {
    await tx`DELETE FROM public.companion_pairing_challenges WHERE expires_at <= now() OR workspace_id = ${principal.workspaceId}`;
    await tx`
      INSERT INTO public.companion_pairing_challenges
        (id, workspace_id, code_hash, label, companion_instance_id, registered_by_user_id, expires_at)
      VALUES
        (${challengeId}, ${principal.workspaceId}, ${hashToken(pairingCode)}, ${label}, ${instanceId}, ${principal.userId}, ${expiresAt})`;
  });
  return { pairingCode, expiresAt, ...supabasePublicConfiguration() };
}

export async function latestSupabaseCompanion(workspaceId) {
  const sql = await getDatabaseSql();
  const [row, required] = await Promise.all([
    sql`SELECT * FROM public.companion_devices WHERE workspace_id = ${workspaceId} AND revoked_at IS NULL ORDER BY updated_at DESC LIMIT 1`.then((rows) => rows[0]),
    minimumVersion(sql),
  ]);
  if (!row) return null;
  const companion = publicDevice(row, required);
  const [health] = await sql`
    SELECT count(*) FILTER (WHERE enabled AND NOT credential_configured)::integer AS login_required
      FROM public.social_accounts WHERE workspace_id = ${workspaceId}`;
  return { ...companion, accountHealth: { loginRequired: health?.login_required || 0 } };
}

export async function revokeSupabaseCompanions(principal) {
  const sql = await getDatabaseSql();
  const rows = await sql`
    UPDATE public.companion_devices
       SET revoked_at = now(), status = 'offline', updated_at = now()
     WHERE workspace_id = ${principal.workspaceId} AND revoked_at IS NULL
     RETURNING id`;
  await sql`DELETE FROM public.companion_pairing_challenges WHERE workspace_id = ${principal.workspaceId}`;
  return { ok: true, removed: rows.length > 0 };
}

export async function listSupabaseAccounts(workspaceId, platform) {
  const sql = await getDatabaseSql();
  const companion = await latestSupabaseCompanion(workspaceId);
  const rows = platform
    ? await sql`SELECT * FROM public.social_accounts WHERE workspace_id = ${workspaceId} AND platform = ${platform} ORDER BY created_at`
    : await sql`SELECT * FROM public.social_accounts WHERE workspace_id = ${workspaceId} ORDER BY created_at`;
  return rows.map((row) => camelAccount(row, companion));
}

export async function upsertSupabaseAccount(account) {
  const sql = await getDatabaseSql();
  const companion = await latestSupabaseCompanion(account.workspaceId);
  const [row] = await sql`
    INSERT INTO public.social_accounts(
      id, workspace_id, companion_device_id, platform, display_name, handle,
      login_identifier, enabled, credential_configured, session_status, safety_status, metadata,
      created_at, updated_at
    ) VALUES (
      ${account.id}, ${account.workspaceId}, ${companion?.id || null}, ${account.platform},
      ${account.displayName}, ${account.handle || ""}, ${account.loginIdentifier || ""},
      ${account.enabled !== false}, ${Boolean(account.credentialConfigured)},
      ${account.credentialConfigured ? "connected" : "reconnect_required"}, ${account.safetyStatus || "healthy"},
      ${sql.json({ executionEngine: publishingEngineForPlatform(account.platform, account.executionEngine) })}, ${account.createdAt || new Date().toISOString()}, now()
    ) ON CONFLICT (id) DO UPDATE SET
      companion_device_id = coalesce(EXCLUDED.companion_device_id, public.social_accounts.companion_device_id),
      display_name = EXCLUDED.display_name, handle = EXCLUDED.handle,
      login_identifier = EXCLUDED.login_identifier, enabled = EXCLUDED.enabled,
      credential_configured = CASE
        WHEN public.social_accounts.metadata->>'executionEngine' IS DISTINCT FROM EXCLUDED.metadata->>'executionEngine' THEN false
        ELSE public.social_accounts.credential_configured
      END,
      session_status = CASE
        WHEN public.social_accounts.metadata->>'executionEngine' IS DISTINCT FROM EXCLUDED.metadata->>'executionEngine' THEN 'reconnect_required'
        ELSE public.social_accounts.session_status
      END,
      safety_status = EXCLUDED.safety_status,
      metadata = coalesce(public.social_accounts.metadata, '{}'::jsonb) || EXCLUDED.metadata,
      updated_at = now()
    WHERE public.social_accounts.workspace_id = EXCLUDED.workspace_id
    RETURNING *`;
  return camelAccount(row, companion);
}

export async function deleteSupabaseAccount(workspaceId, accountId) {
  const sql = await getDatabaseSql();
  await sql`DELETE FROM public.social_accounts WHERE workspace_id = ${workspaceId} AND id = ${accountId}`;
}

export async function createSupabaseJob({
  id: requestedId,
  workspaceId,
  userId,
  type,
  platform = null,
  accountId = null,
  idempotencyKey,
  payload = {},
  priority = 100,
  maxAttempts = 3,
  notBefore = null,
}) {
  if (!JOB_TYPES.has(type)) throw new Error("The Companion job type is invalid.");
  if (platform && !JOB_PLATFORMS.has(platform)) throw new Error("The Companion job platform is invalid.");
  const sql = await getDatabaseSql();
  const jobId = requestedId || id(type === "publish" ? "publishjob" : "scrapejob");
  const key = safeText(idempotencyKey || jobId, 240);
  return sql.begin(async (tx) => {
    let [row] = await tx`
      INSERT INTO public.jobs(
        id, workspace_id, job_type, platform, account_id, requested_by_user_id,
        idempotency_key, priority, payload, max_attempts, not_before
      ) VALUES (
        ${jobId}, ${workspaceId}, ${type}, ${platform}, ${accountId}, ${userId || null},
        ${key}, ${Math.max(1, Math.min(Number(priority) || 100, 1000))}, ${tx.json(payload)},
        ${Math.max(1, Math.min(Number(maxAttempts) || 3, 10))}, ${notBefore || new Date().toISOString()}
      ) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
      RETURNING *`;
    const inserted = Boolean(row);
    if (!row) {
      [row] = await tx`
        UPDATE public.jobs SET
          payload = CASE WHEN status IN ('queued', 'waiting_for_companion', 'reconnect_required') THEN ${tx.json(payload)} ELSE payload END,
          updated_at = CASE WHEN status IN ('queued', 'waiting_for_companion', 'reconnect_required') THEN now() ELSE updated_at END
        WHERE workspace_id = ${workspaceId} AND idempotency_key = ${key}
        RETURNING *`;
    }
    if (inserted) {
      await tx`
        INSERT INTO public.job_events(job_id, workspace_id, event_type, status, message)
        VALUES (${row.id}, ${workspaceId}, 'job.queued', ${row.status}, 'Queued for the workspace Companion.')`;
    }
    const artifact = payload?.upload?.artifact;
    if (artifact?.bucket && artifact?.path && artifact?.fileName) {
      await tx`
        INSERT INTO public.job_artifacts(
          id, job_id, workspace_id, storage_bucket, storage_path, file_name, mime_type, byte_size, sha256
        ) VALUES (
          ${`artifact_${row.id}`}, ${row.id}, ${workspaceId}, ${artifact.bucket}, ${artifact.path},
          ${artifact.fileName}, ${artifact.mimeType || null}, ${Number(artifact.byteSize) || null}, ${artifact.sha256 || null}
        ) ON CONFLICT (job_id, storage_bucket, storage_path) DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type,
          byte_size = EXCLUDED.byte_size, sha256 = EXCLUDED.sha256`;
    }
    return camelJob(row);
  });
}

export async function synchronizePublishingJobs(workspaceId, jobs, uploads, accounts) {
  const uploadsById = new Map(uploads.map((item) => [item.id, item]));
  const accountsById = new Map(accounts.map((item) => [item.id, item]));
  const synchronized = [];
  for (const source of jobs) {
    const upload = uploadsById.get(source.uploadId);
    const account = accountsById.get(source.accountId);
    if (!upload || !account || !ACTIVE_JOB_STATES.has(source.state)) continue;
    await upsertSupabaseAccount(account);
    synchronized.push(await createSupabaseJob({
      id: source.id,
      workspaceId,
      userId: upload.createdByUserId,
      type: "publish",
      platform: account.platform,
      accountId: account.id,
      idempotencyKey: `publish:${source.id}`,
      payload: { upload, account },
      priority: 200,
      maxAttempts: 3,
      notBefore: source.notBefore || null,
    }));
  }
  return synchronized;
}

export async function listSupabaseJobs(workspaceId, options = {}) {
  const sql = await getDatabaseSql();
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 500));
  let rows;
  if (options.type) {
    rows = await sql`SELECT * FROM public.jobs WHERE workspace_id = ${workspaceId} AND job_type = ${options.type} ORDER BY created_at DESC LIMIT ${limit}`;
  } else {
    rows = await sql`SELECT * FROM public.jobs WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT ${limit}`;
  }
  return rows.map(camelJob);
}

export async function getSupabaseJob(workspaceId, jobId) {
  const sql = await getDatabaseSql();
  const [row] = await sql`SELECT * FROM public.jobs WHERE workspace_id = ${workspaceId} AND id = ${jobId}`;
  if (!row) return null;
  const [result] = await sql`SELECT outcome, result, error, created_at, updated_at FROM public.job_results WHERE workspace_id = ${workspaceId} AND job_id = ${jobId}`;
  return { ...camelJob(row), result: result || null };
}

export async function cancelSupabaseJob(workspaceId, jobId) {
  const sql = await getDatabaseSql();
  const row = await sql.begin(async (tx) => {
    const [existing] = await tx`SELECT * FROM public.jobs WHERE workspace_id = ${workspaceId} AND id = ${jobId} FOR UPDATE`;
    if (!existing) return null;
    if (["success", "failed", "uncertain", "cancelled"].includes(existing.status)) return existing;
    const next = existing.assigned_device_id ? "cancel_requested" : "cancelled";
    const [updated] = await tx`
      UPDATE public.jobs SET status = ${next}, message = ${next === "cancel_requested" ? "Cancellation requested." : "Cancelled."},
        completed_at = CASE WHEN ${next} = 'cancelled' THEN now() ELSE completed_at END, updated_at = now()
      WHERE id = ${jobId} AND workspace_id = ${workspaceId} RETURNING *`;
    await tx`
      INSERT INTO public.job_events(job_id, workspace_id, event_type, status, message)
      VALUES (${jobId}, ${workspaceId}, 'job.cancel', ${updated.status}, ${updated.message})`;
    if (next === "cancelled") {
      await tx`
        INSERT INTO public.job_results(job_id, workspace_id, outcome, result)
        VALUES (${jobId}, ${workspaceId}, 'CANCELLED', ${tx.json({})})
        ON CONFLICT (job_id) DO UPDATE SET outcome = EXCLUDED.outcome, result = EXCLUDED.result, error = null, updated_at = now()`;
    }
    return updated;
  });
  if (!row) return null;
  return camelJob(row);
}

export async function supabaseJobDashboard(workspaceId) {
  const [companion, jobs] = await Promise.all([
    latestSupabaseCompanion(workspaceId),
    listSupabaseJobs(workspaceId, { limit: 200 }),
  ]);
  return { companion, jobs };
}

export const supabaseJobControlTestHelpers = {
  absoluteSignedArtifactUrl,
  camelAccount,
  camelJob,
  publicDevice,
  publishingEngineForPlatform,
  supabaseApiHeaders,
  versionAtLeast,
};
