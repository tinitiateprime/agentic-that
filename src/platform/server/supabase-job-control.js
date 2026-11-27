import { createHash, randomUUID } from "node:crypto";
import { getDatabaseSql } from "../../../lib/database-document-store.js";
import { companionApiKey, companionPairingConfiguration } from "./companion-database-api.js";
import { deleteObject, getObject, objectSize, presignObjectUrl, putObject, requireObjectStorage, signMediaToken } from "./object-storage.js";

const COMPANION_ONLINE_MS = 90_000;
const PAIRING_TTL_MS = 5 * 60_000;
const ARTIFACT_BUCKET = "job-artifacts";
const ARTIFACT_URL_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SUPABASE_ARTIFACT_PART_THRESHOLD_BYTES = 5 * 1024 * 1024;
const MAX_INLINE_ARTIFACT_BYTES = 64 * 1024 * 1024;
const JOB_TYPES = new Set(["publish", "scrape.instagram", "scrape.facebook", "collect.inbox"]);
const JOB_PLATFORMS = new Set(["instagram", "facebook", "x", "linkedin", "youtube", "reddit"]);
// Every app publishes through the Companion (Reddit included, in its external browser).
const API_ENGINE_PLATFORMS = new Set();
const ACTIVE_JOB_STATES = new Set([
  "queued", "waiting_for_companion", "claimed", "running", "opening_platform",
  "uploading", "publishing", "reconnect_required", "cancel_requested",
]);
const JOB_STATUS_COLUMNS = [
  "id", "workspace_id", "job_type", "platform", "account_id", "requested_by_user_id",
  "assigned_device_id", "idempotency_key", "priority", "status", "progress", "message",
  "error", "attempt_count", "max_attempts", "lease_expires_at", "final_action_started_at",
  "not_before", "started_at", "completed_at", "created_at", "updated_at",
];

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
  if (API_ENGINE_PLATFORMS.has(platform)) return "api";
  return platform === "facebook" || platform === "x" || platform === "youtube" || platform === "reddit" || requestedEngine === "external_browser"
    ? "external_browser"
    : "companion";
}

function normalizedLinkedInManagedPages(metadata) {
  const pages = Array.isArray(metadata?.linkedinManagedPages) ? metadata.linkedinManagedPages : [];
  const normalized = [];
  const seen = new Set();
  for (const candidate of pages.slice(0, 100)) {
    const id = safeText(candidate?.id, 180);
    const name = safeText(candidate?.name, 200);
    if (!id || !name || seen.has(id) || !/^[A-Za-z0-9._~-]+$/.test(id)) continue;
    seen.add(id);
    const encodedId = encodeURIComponent(id);
    normalized.push({
      id,
      name,
      pageUrl: `https://www.linkedin.com/company/${encodedId}/admin/`,
      pagePostsUrl: `https://www.linkedin.com/company/${encodedId}/admin/page-posts/published/`,
    });
  }
  return normalized;
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
  const executionEngine = publishingEngineForPlatform(row.platform, row.metadata?.executionEngine);
  const readiness = !row.enabled
    ? "unavailable"
    : !row.credential_configured
      ? "reconnect_required"
      : executionEngine === "api" || companionStatus === "online" ? "ready" : "waiting_for_companion";
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
    executionEngine,
    apiUsername: executionEngine === "api" ? row.metadata?.apiUsername || undefined : undefined,
    linkedinManagedPages: row.platform === "linkedin"
      ? normalizedLinkedInManagedPages(row.metadata)
      : undefined,
    linkedinManagedPagesUpdatedAt: row.platform === "linkedin"
      ? row.metadata?.linkedinManagedPagesUpdatedAt || undefined
      : undefined,
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

function publicDevice(row, minimumVersion = "2.1.8") {
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
  return row?.value || "2.1.8";
}

/** What a Companion is given when it pairs: where to call (the website) and the identifier it sends. */
function companionConnectionConfiguration() {
  const apiKey = companionApiKey();
  if (!apiKey) throw new Error("COMPANION_RPC_API_KEY is required for Companion pairing.");
  return companionPairingConfiguration({ supabaseUrl: websiteOrigin(), supabaseApiKey: apiKey });
}

// ---- Private media: Hetzner Object Storage (see object-storage.js) -------------------------

function mediaStorage() {
  return requireObjectStorage();
}

function websiteOrigin() {
  const value = safeText(process.env.PLATFORM_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL, 500);
  if (!value) throw new Error("PLATFORM_PUBLIC_URL is required for private media links.");
  return new URL(value).origin;
}

/** "workspace_1/photo.jpg": the object's key in the bucket. */
function storageObjectPath(workspaceId, fileName) {
  const workspace = safeText(workspaceId, 180);
  const file = safeText(fileName, 240);
  if (!workspace || !file || /[\\/\u0000-\u001f]/.test(workspace) || /[\\/\u0000-\u001f]/.test(file) || [workspace, file].some((part) => part === "." || part === "..")) {
    throw new Error("The private media storage path is invalid.");
  }
  return `${workspace}/${file}`;
}

function artifactPartObjectPath(workspaceId, fileName, index) {
  if (!Number.isInteger(index) || index < 0 || index > 9999) throw new Error("The private media part number is invalid.");
  return `${storageObjectPath(workspaceId, fileName)}.parts/${String(index).padStart(4, "0")}`;
}

function validStoredPath(value) {
  const path = String(value || "");
  return Boolean(path) && !path.startsWith("/") && !path.split("/").some((part) => !part || part === "." || part === "..");
}

/**
 * An AgenticThat link the Companion downloads from: the website checks its
 * token and redirects to a short-lived signed link on the bucket. It stays
 * valid for 30 days, so posts scheduled weeks ahead still find their media.
 */
export function privateMediaDownloadUrl(key, ttlSeconds = ARTIFACT_URL_TTL_SECONDS) {
  if (!validStoredPath(key)) throw new Error("The private media storage path is invalid.");
  const token = signMediaToken(mediaStorage(), key, Date.now() + ttlSeconds * 1000);
  const encoded = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${websiteOrigin()}/storage/v1/object/sign/${ARTIFACT_BUCKET}/${encoded}?token=${encodeURIComponent(token)}`;
}

function validateArtifactPartInput({ index, offset, byteSize }) {
  if (!Number.isInteger(index) || index < 0 || index > 9999) throw new Error("The private media part number is invalid.");
  if (!Number.isInteger(offset) || offset < 0) throw new Error("The private media part offset is invalid.");
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > SUPABASE_ARTIFACT_PART_THRESHOLD_BYTES) {
    throw new Error("The private media part size is invalid.");
  }
}

export async function authorizeSupabaseJobArtifactPartUpload({ workspaceId, fileName, mimeType, index, offset, byteSize }) {
  validateArtifactPartInput({ index, offset, byteSize });
  const key = artifactPartObjectPath(workspaceId, fileName, index);
  return {
    // The browser sends this part straight to the bucket with a one-hour signed link.
    signedUrl: presignObjectUrl(mediaStorage(), "PUT", key, { expiresIn: 3600 }),
    index,
    offset,
    byteSize,
    path: key,
    mimeType: mimeType || "application/octet-stream",
  };
}

export async function authorizeSupabaseJobArtifactPartUploads(inputs) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 8) {
    throw new Error("The private media upload batch is invalid.");
  }
  return Promise.all(inputs.map((input) => authorizeSupabaseJobArtifactPartUpload(input)));
}

export async function verifySupabaseJobArtifactPartUpload({ workspaceId, fileName, index, offset, byteSize }) {
  validateArtifactPartInput({ index, offset, byteSize });
  const key = artifactPartObjectPath(workspaceId, fileName, index);
  const storedSize = await objectSize(mediaStorage(), key);
  if (storedSize === null) throw new Error("The private media part hasn't arrived yet. Try again.");
  if (storedSize !== byteSize) throw new Error("The uploaded private media part has the wrong size.");
  return { index, offset, path: key, byteSize };
}

export async function verifySupabaseJobArtifactPartUploads(inputs) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 8) {
    throw new Error("The completed private media batch is invalid.");
  }
  return Promise.all(inputs.map((input) => verifySupabaseJobArtifactPartUpload(input)));
}

export async function deleteSupabaseStagedArtifactParts({ workspaceId, fileName, partCount }) {
  const count = Number(partCount);
  if (!Number.isInteger(count) || count < 0 || count > 1000) throw new Error("The private media part count is invalid.");
  await deleteSupabaseJobArtifactParts(Array.from({ length: count }, (_, index) => ({ path: artifactPartObjectPath(workspaceId, fileName, index) })));
}

export async function storeSupabaseJobArtifactPart(bytes, { workspaceId, fileName, mimeType, index, offset }) {
  if (!bytes?.length || bytes.length > SUPABASE_ARTIFACT_PART_THRESHOLD_BYTES) throw new Error("The private media part size is invalid.");
  const key = artifactPartObjectPath(workspaceId, fileName, index);
  await putObject(mediaStorage(), key, bytes, mimeType);
  return {
    index,
    offset,
    path: key,
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function finalizeSupabaseJobArtifact({ workspaceId, fileName, originalName, mimeType, byteSize, parts }) {
  const ordered = Array.isArray(parts) ? [...parts].sort((left, right) => left.index - right.index) : [];
  if (!ordered.length || ordered.length > 1000) throw new Error("The private media upload is incomplete.");
  let expectedOffset = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const part = ordered[index];
    if (part.index !== index || part.offset !== expectedOffset || !validStoredPath(part.path) || !Number.isInteger(part.byteSize) || part.byteSize < 1) {
      throw new Error("The private media upload parts are invalid.");
    }
    expectedOffset += part.byteSize;
  }
  if (expectedOffset !== byteSize) throw new Error("The private media upload size is invalid.");
  return {
    bucket: ARTIFACT_BUCKET,
    storage: "hetzner",
    path: `${storageObjectPath(workspaceId, fileName)}.parts`,
    fileName,
    originalName,
    mimeType: mimeType || "application/octet-stream",
    byteSize,
    parts: ordered.map((part) => ({ ...part, downloadUrl: privateMediaDownloadUrl(part.path) })),
    expiresAt: new Date(Date.now() + ARTIFACT_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

export async function deleteSupabaseJobArtifactParts(parts) {
  const paths = (Array.isArray(parts) ? parts : []).map((part) => part?.path).filter(validStoredPath);
  if (!paths.length) return;
  const configuration = mediaStorage();
  for (let index = 0; index < paths.length; index += 8) {
    await Promise.all(paths.slice(index, index + 8).map((key) => deleteObject(configuration, key)));
  }
}

export async function storeSupabaseJobArtifact(bytes, { workspaceId, fileName, originalName, mimeType }) {
  const key = storageObjectPath(workspaceId, fileName);
  await putObject(mediaStorage(), key, bytes, mimeType);
  return {
    bucket: ARTIFACT_BUCKET,
    storage: "hetzner",
    path: key,
    fileName,
    originalName,
    mimeType: mimeType || "application/octet-stream",
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    downloadUrl: privateMediaDownloadUrl(key),
    expiresAt: new Date(Date.now() + ARTIFACT_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

function artifactPaths(artifact) {
  if (!artifact || artifact.bucket !== ARTIFACT_BUCKET) throw new Error("The private publishing artifact is invalid.");
  const paths = Array.isArray(artifact.parts) && artifact.parts.length
    ? [...artifact.parts].sort((left, right) => Number(left.index) - Number(right.index)).map((part) => part?.path)
    : [artifact.path];
  if (!paths.length || paths.some((value) => !validStoredPath(value))) throw new Error("The private publishing artifact path is invalid.");
  return paths;
}

export async function readSupabaseJobArtifactBytes(artifact, requestedMaximumBytes = SUPABASE_ARTIFACT_PART_THRESHOLD_BYTES) {
  const paths = artifactPaths(artifact);
  const maximumBytes = Math.max(1, Math.min(Number(requestedMaximumBytes) || SUPABASE_ARTIFACT_PART_THRESHOLD_BYTES, MAX_INLINE_ARTIFACT_BYTES));
  const declaredSize = Number(artifact.byteSize || 0);
  if (!Number.isInteger(declaredSize) || declaredSize < 1 || declaredSize > maximumBytes) {
    throw new Error("This publishing media is too large for an in-browser preview.");
  }
  const configuration = mediaStorage();
  const chunks = await Promise.all(paths.map((key) => getObject(configuration, key)));
  const receivedSize = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (receivedSize > maximumBytes) throw new Error("This publishing media is too large for an in-browser preview.");
  if (receivedSize !== declaredSize) throw new Error("The private publishing media is incomplete.");
  return Buffer.concat(chunks, receivedSize);
}

/** @param {{ start: number, end: number } | null} [range] */
export async function readSupabasePublishingMediaObject(workspaceId, fileName, range = null) {
  if (range && (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start)) throw new Error("Invalid publishing media range.");
  const bytes = await getObject(mediaStorage(), storageObjectPath(workspaceId, fileName), range);
  if (range && bytes.length !== range.end - range.start + 1) throw new Error("The publishing media range is incomplete.");
  return bytes;
}

export async function deleteSupabasePublishingMediaObject(workspaceId, fileName) {
  await deleteSupabaseJobArtifactParts([{ path: storageObjectPath(workspaceId, fileName) }]);
}

// Streams a stored artifact part by part, so media of any size can be handed
// to another service without holding the whole file in memory.
export async function openSupabaseJobArtifactStream(artifact) {
  const paths = artifactPaths(artifact);
  const byteSize = Number(artifact.byteSize || 0);
  if (!Number.isInteger(byteSize) || byteSize < 1) throw new Error("The private publishing artifact size is invalid.");
  const configuration = mediaStorage();
  let index = 0;
  let sent = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (index >= paths.length) {
        if (sent !== byteSize) controller.error(new Error("The private publishing media is incomplete."));
        else controller.close();
        return;
      }
      try {
        const chunk = new Uint8Array(await getObject(configuration, paths[index]));
        index += 1;
        sent += chunk.length;
        controller.enqueue(chunk);
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return { stream, byteSize };
}

export async function readSupabaseJobArtifactRange(artifact, start, end, requestedMaximumBytes = SUPABASE_ARTIFACT_PART_THRESHOLD_BYTES) {
  artifactPaths(artifact);
  const declaredSize = Number(artifact.byteSize || 0);
  const maximumBytes = Math.max(1, Math.min(Number(requestedMaximumBytes) || SUPABASE_ARTIFACT_PART_THRESHOLD_BYTES, SUPABASE_ARTIFACT_PART_THRESHOLD_BYTES));
  if (!Number.isInteger(declaredSize) || declaredSize < 1 || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end < start || end >= declaredSize || end - start + 1 > maximumBytes) {
    throw new Error("The private publishing media range is invalid.");
  }
  const parts = Array.isArray(artifact.parts) && artifact.parts.length
    ? [...artifact.parts].sort((left, right) => Number(left.index) - Number(right.index))
    : [{ index: 0, offset: 0, byteSize: declaredSize, path: artifact.path }];
  if (parts.some((part) => !validStoredPath(part?.path) || !Number.isInteger(Number(part.offset)) || !Number.isInteger(Number(part.byteSize)) || Number(part.byteSize) < 1)) {
    throw new Error("The private publishing artifact path is invalid.");
  }
  const selected = parts.filter((part) => Number(part.offset) <= end && Number(part.offset) + Number(part.byteSize) - 1 >= start);
  if (!selected.length) throw new Error("The private publishing media range is unavailable.");
  const configuration = mediaStorage();
  const chunks = [];
  for (const part of selected) {
    const partOffset = Number(part.offset);
    const partSize = Number(part.byteSize);
    const localStart = Math.max(0, start - partOffset);
    const localEnd = Math.min(partSize - 1, end - partOffset);
    const chunk = await getObject(configuration, part.path, { start: localStart, end: localEnd });
    if (chunk.length !== localEnd - localStart + 1) throw new Error("The private publishing media range is incomplete.");
    chunks.push(chunk);
  }
  const expectedSize = end - start + 1;
  const receivedSize = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (receivedSize !== expectedSize) throw new Error("The private publishing media range is incomplete.");
  return Buffer.concat(chunks, expectedSize);
}

export async function createSupabasePairing(principal, input = {}) {
  const configuration = companionConnectionConfiguration();
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
  return { pairingCode, expiresAt, ...configuration };
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
  const [companion, rows] = await Promise.all([
    latestSupabaseCompanion(workspaceId),
    platform
      ? sql`SELECT * FROM public.social_accounts WHERE workspace_id = ${workspaceId} AND platform = ${platform} ORDER BY created_at`
      : sql`SELECT * FROM public.social_accounts WHERE workspace_id = ${workspaceId} ORDER BY created_at`,
  ]);
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
      ${sql.json({
        executionEngine: publishingEngineForPlatform(account.platform, account.executionEngine),
        ...(account.platform === "linkedin" ? {
          linkedinManagedPages: account.linkedinManagedPages || [],
          linkedinManagedPagesUpdatedAt: account.linkedinManagedPagesUpdatedAt || null,
        } : {}),
      })}, ${account.createdAt || new Date().toISOString()}, now()
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

// Written directly rather than through upsertSupabaseAccount, whose engine-change
// rule deliberately clears credentials that only a Companion login can restore.
export async function setSupabaseAccountApiConnection(account) {
  const sql = await getDatabaseSql();
  const connected = Boolean(account.credentialConfigured);
  await upsertSupabaseAccount(account);
  const [row] = await sql`
    UPDATE public.social_accounts SET
      handle = ${account.handle || ""},
      credential_configured = ${connected},
      session_status = ${connected ? "connected" : "reconnect_required"},
      metadata = (coalesce(metadata, '{}'::jsonb) - 'apiUsername') || ${sql.json({
        executionEngine: account.executionEngine,
        ...(connected && account.apiUsername ? { apiUsername: account.apiUsername } : {}),
      })},
      updated_at = now()
    WHERE workspace_id = ${account.workspaceId} AND id = ${account.id}
    RETURNING *`;
  if (connected) {
    await sql`
      UPDATE public.jobs SET status = 'queued', message = 'Reddit is connected. Publishing will continue automatically.', updated_at = now()
       WHERE workspace_id = ${account.workspaceId} AND account_id = ${account.id}
         AND job_type = 'publish' AND status IN ('waiting_for_companion', 'reconnect_required')`;
  }
  return camelAccount(row, await latestSupabaseCompanion(account.workspaceId));
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

function publishingSynchronizationPlan(workspaceId, jobs, uploads, accounts) {
  const uploadsById = new Map(uploads.map((item) => [item.id, item]));
  const accountsById = new Map(accounts.map((item) => [item.id, item]));
  const work = jobs.flatMap((source) => {
    const upload = uploadsById.get(source.uploadId);
    const account = accountsById.get(source.accountId);
    if (!upload || !account || !ACTIVE_JOB_STATES.has(source.state)) return [];
    return [{ source, upload, account }];
  });
  return {
    accounts: [...new Map(work.map(({ account }) => [account.id, account])).values()],
    jobs: work.map(({ source, upload, account }) => ({
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
      notBefore: source.notBefore || new Date().toISOString(),
    })),
  };
}

async function synchronizePublishingJobsWithSql(sql, plan) {
  if (!plan.jobs.length) return [];
  const accountRows = plan.accounts.map((account) => ({
    id: account.id,
    workspace_id: account.workspaceId,
    platform: account.platform,
    display_name: account.displayName,
    handle: account.handle || "",
    login_identifier: account.loginIdentifier || "",
    enabled: account.enabled !== false,
    credential_configured: Boolean(account.credentialConfigured),
    session_status: account.credentialConfigured ? "connected" : "reconnect_required",
    safety_status: account.safetyStatus || "healthy",
    metadata: {
      executionEngine: publishingEngineForPlatform(account.platform, account.executionEngine),
      ...(account.platform === "linkedin" ? {
        linkedinManagedPages: account.linkedinManagedPages || [],
        linkedinManagedPagesUpdatedAt: account.linkedinManagedPagesUpdatedAt || null,
      } : {}),
    },
    created_at: account.createdAt || new Date().toISOString(),
  }));
  await sql`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset(${sql.json(accountRows)}::jsonb) AS item(
        id text, workspace_id text, platform text, display_name text, handle text,
        login_identifier text, enabled boolean, credential_configured boolean,
        session_status text, safety_status text, metadata jsonb, created_at timestamptz
      )
    ), companion AS (
      SELECT id FROM public.companion_devices
       WHERE workspace_id = ${plan.jobs[0].workspaceId} AND revoked_at IS NULL
       ORDER BY updated_at DESC LIMIT 1
    )
    INSERT INTO public.social_accounts(
      id, workspace_id, companion_device_id, platform, display_name, handle,
      login_identifier, enabled, credential_configured, session_status, safety_status,
      metadata, created_at, updated_at
    )
    SELECT incoming.id, incoming.workspace_id, companion.id, incoming.platform,
      incoming.display_name, incoming.handle, incoming.login_identifier, incoming.enabled,
      incoming.credential_configured, incoming.session_status, incoming.safety_status,
      incoming.metadata, incoming.created_at, now()
    FROM incoming LEFT JOIN companion ON true
    ON CONFLICT (id) DO UPDATE SET
      companion_device_id = coalesce(EXCLUDED.companion_device_id, public.social_accounts.companion_device_id),
      display_name = EXCLUDED.display_name,
      handle = EXCLUDED.handle,
      login_identifier = EXCLUDED.login_identifier,
      enabled = EXCLUDED.enabled,
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
  `;

  const jobRows = plan.jobs.map((job) => ({
    id: job.id,
    workspace_id: job.workspaceId,
    job_type: job.type,
    platform: job.platform,
    account_id: job.accountId,
    requested_by_user_id: job.userId || null,
    idempotency_key: safeText(job.idempotencyKey || job.id, 240),
    priority: Math.max(1, Math.min(Number(job.priority) || 100, 1000)),
    payload: job.payload || {},
    max_attempts: Math.max(1, Math.min(Number(job.maxAttempts) || 3, 10)),
    not_before: job.notBefore || new Date().toISOString(),
  }));
  const rows = await sql`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset(${sql.json(jobRows)}::jsonb) AS item(
        id text, workspace_id text, job_type text, platform text, account_id text,
        requested_by_user_id text, idempotency_key text, priority integer,
        payload jsonb, max_attempts integer, not_before timestamptz
      )
    ), inserted AS (
      INSERT INTO public.jobs(
        id, workspace_id, job_type, platform, account_id, requested_by_user_id,
        idempotency_key, priority, payload, max_attempts, not_before
      )
      SELECT id, workspace_id, job_type, platform, account_id, requested_by_user_id,
        idempotency_key, priority, payload, max_attempts, not_before
      FROM incoming
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
      RETURNING *
    ), refreshed AS (
      UPDATE public.jobs AS stored SET
        payload = CASE
          WHEN stored.status IN ('queued', 'waiting_for_companion', 'reconnect_required') THEN incoming.payload
          ELSE stored.payload
        END,
        updated_at = CASE
          WHEN stored.status IN ('queued', 'waiting_for_companion', 'reconnect_required') THEN now()
          ELSE stored.updated_at
        END
      FROM incoming
      WHERE stored.workspace_id = incoming.workspace_id
        AND stored.idempotency_key = incoming.idempotency_key
        AND NOT EXISTS (SELECT 1 FROM inserted WHERE inserted.id = stored.id)
      RETURNING stored.*
    ), events AS (
      INSERT INTO public.job_events(job_id, workspace_id, event_type, status, message)
      SELECT id, workspace_id, 'job.queued', status, 'Queued for the workspace Companion.'
      FROM inserted
      RETURNING id
    ), combined AS (
      SELECT * FROM inserted
      UNION ALL
      SELECT * FROM refreshed
    )
    SELECT combined.*, (SELECT count(*)::integer FROM events) AS queued_event_count
    FROM combined
  `;

  const jobsByKey = new Map(rows.map((row) => [row.idempotency_key, row]));
  const artifactRows = plan.jobs.flatMap((job) => {
    const artifact = job.payload?.upload?.artifact;
    const stored = jobsByKey.get(safeText(job.idempotencyKey || job.id, 240));
    if (!stored || !artifact?.bucket || !artifact?.path || !artifact?.fileName) return [];
    return [{
      id: `artifact_${stored.id}`,
      job_id: stored.id,
      workspace_id: job.workspaceId,
      storage_bucket: artifact.bucket,
      storage_path: artifact.path,
      file_name: artifact.fileName,
      mime_type: artifact.mimeType || null,
      byte_size: Number(artifact.byteSize) || null,
      sha256: artifact.sha256 || null,
    }];
  });
  if (artifactRows.length) {
    await sql`
      WITH incoming AS (
        SELECT * FROM jsonb_to_recordset(${sql.json(artifactRows)}::jsonb) AS item(
          id text, job_id text, workspace_id text, storage_bucket text, storage_path text,
          file_name text, mime_type text, byte_size bigint, sha256 text
        )
      )
      INSERT INTO public.job_artifacts(
        id, job_id, workspace_id, storage_bucket, storage_path, file_name, mime_type, byte_size, sha256
      )
      SELECT id, job_id, workspace_id, storage_bucket, storage_path, file_name, mime_type, byte_size, sha256
      FROM incoming
      ON CONFLICT (job_id, storage_bucket, storage_path) DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        file_name = EXCLUDED.file_name,
        mime_type = EXCLUDED.mime_type,
        byte_size = EXCLUDED.byte_size,
        sha256 = EXCLUDED.sha256
    `;
  }
  return rows.map(camelJob);
}

export async function synchronizePublishingJobs(workspaceId, jobs, uploads, accounts, transaction = null) {
  const plan = publishingSynchronizationPlan(workspaceId, jobs, uploads, accounts);
  if (!plan.jobs.length) return [];
  if (transaction) return synchronizePublishingJobsWithSql(transaction, plan);
  const sql = await getDatabaseSql();
  return sql.begin((tx) => synchronizePublishingJobsWithSql(tx, plan));
}

export async function listSupabaseJobs(workspaceId, options = {}) {
  const sql = await getDatabaseSql();
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 500));
  let rows;
  if (options.includePayload === false) {
    rows = options.type
      ? await sql`SELECT ${sql(JOB_STATUS_COLUMNS)} FROM public.jobs WHERE workspace_id = ${workspaceId} AND job_type = ${options.type} ORDER BY created_at DESC LIMIT ${limit}`
      : await sql`SELECT ${sql(JOB_STATUS_COLUMNS)} FROM public.jobs WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT ${limit}`;
  } else if (options.type) {
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
  const { companion, jobs } = await supabasePublishingWorkspaceSnapshot(workspaceId);
  return { companion, jobs };
}

export async function listSupabasePublishingJobsForAdmin(requestedLimit = 1000) {
  const sql = await getDatabaseSql();
  const [availability] = await sql`SELECT to_regclass('public.jobs') IS NOT NULL AS ready`;
  if (!availability?.ready) return [];
  const limit = Math.max(1, Math.min(Number(requestedLimit) || 1000, 5000));
  const rows = await sql`
    SELECT * FROM public.jobs
     WHERE job_type = 'publish'
     ORDER BY updated_at DESC
     LIMIT ${limit}`;
  return rows.map(camelJob);
}

export async function supabasePublishingWorkspaceSnapshot(workspaceId) {
  const sql = await getDatabaseSql();
  const [row] = await sql`
    SELECT
      coalesce((SELECT value FROM public.job_control_settings WHERE key = 'minimum_companion_version'), '2.1.29') AS minimum_version,
      (SELECT to_jsonb(device_row) FROM (
        SELECT * FROM public.companion_devices
         WHERE workspace_id = ${workspaceId} AND revoked_at IS NULL
         ORDER BY updated_at DESC LIMIT 1
      ) device_row) AS companion,
      (SELECT count(*) FILTER (WHERE enabled AND NOT credential_configured)::integer
         FROM public.social_accounts WHERE workspace_id = ${workspaceId}) AS login_required,
      coalesce((SELECT jsonb_agg(to_jsonb(account_row)) FROM (
        SELECT * FROM public.social_accounts
         WHERE workspace_id = ${workspaceId} ORDER BY created_at
      ) account_row), '[]'::jsonb) AS accounts,
      coalesce((SELECT jsonb_agg(to_jsonb(job_row)) FROM (
        SELECT ${sql(JOB_STATUS_COLUMNS)} FROM public.jobs
         WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT 500
      ) job_row), '[]'::jsonb) AS jobs
  `;
  const companionValue = publicDevice(row?.companion, row?.minimum_version || "2.1.29");
  const companion = companionValue
    ? { ...companionValue, accountHealth: { loginRequired: Number(row?.login_required) || 0 } }
    : null;
  return {
    companion,
    accounts: (Array.isArray(row?.accounts) ? row.accounts : []).map((account) => camelAccount(account, companion)),
    jobs: (Array.isArray(row?.jobs) ? row.jobs : []).map(camelJob),
  };
}

export const supabaseJobControlTestHelpers = {  artifactPartObjectPath,
  camelAccount,
  camelJob,
  publicDevice,
  publishingEngineForPlatform,
  publishingSynchronizationPlan,  validateArtifactPartInput,
  versionAtLeast,
};
