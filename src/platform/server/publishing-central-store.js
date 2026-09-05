import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import nodeCron from "node-cron";
import { requireYouTubeOptions } from "../../../services/publishing/queue-runner/shared/youtube-options.js";
import {
  getDatabaseSql,
  initializeDatabaseDocument,
  mutateDatabaseDocument,
  readDatabaseDocument,
} from "../../../lib/database-document-store.js";
import {
  cancelSupabaseJob,
  createSupabasePairing,
  deleteSupabaseAccount,
  latestSupabaseCompanion,
  listSupabaseAccounts,
  listSupabaseJobs,
  revokeSupabaseCompanions,
  supabaseJobDashboard,
  supabasePublishingWorkspaceSnapshot,
  synchronizePublishingJobs,
  upsertSupabaseAccount,
} from "./supabase-job-control.js";

const DOCUMENT_KEY = "platform.publishing-central.v1";
const COMPANION_ONLINE_MS = 90_000;
const PAIRING_CHALLENGE_MS = 5 * 60_000;
const JOB_LEASE_MS = 5 * 60_000;
const MAX_JOB_ATTEMPTS = 3;
const MINIMUM_COMPANION_VERSION = process.env.MINIMUM_COMPANION_VERSION?.trim() || "2.1.8";
const PLATFORM_VALUES = new Set(["instagram", "facebook", "x", "linkedin", "youtube"]);
const CENTRAL_UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const SCHEDULE_FREQUENCIES = new Set(["daily", "weekly", "biweekly", "monthly", "yearly", "custom", "onetime"]);
const TERMINAL_JOB_STATES = new Set(["published", "failed", "uncertain", "cancelled"]);
const PLATFORM_CAPTION_LIMITS = { instagram: 2200, x: 280, linkedin: 3000, facebook: 63206, youtube: 5000 };

function companionPublishingEngine(platformName, requestedEngine = "companion") {
  return platformName === "x" || platformName === "youtube" || requestedEngine === "external_browser"
    ? "external_browser"
    : "companion";
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function hashSecret(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeEqual(left, right) {
  const leftValue = Buffer.from(String(left || ""));
  const rightValue = Buffer.from(String(right || ""));
  return leftValue.length === rightValue.length && timingSafeEqual(leftValue, rightValue);
}

function blankDocument() {
  return {
    version: 1,
    accounts: [],
    uploads: [],
    submissions: [],
    schedules: [],
    activityLogs: [],
    jobs: [],
    companions: [],
    pairingChallenges: [],
    stagedUploads: [],
  };
}

function documentValue(value) {
  const empty = blankDocument();
  if (!value || typeof value !== "object") return empty;
  for (const key of Object.keys(empty)) {
    if (key === "version") continue;
    empty[key] = Array.isArray(value[key]) ? value[key] : [];
  }
  empty.accounts = empty.accounts.map((account) => ({
    ...account,
    executionEngine: companionPublishingEngine(account.platform, account.executionEngine),
  }));
  return empty;
}

async function initialize() {
  await initializeDatabaseDocument(DOCUMENT_KEY, blankDocument());
}

function platform(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!PLATFORM_VALUES.has(normalized)) throw new Error("Choose a supported publishing platform.");
  return normalized;
}

function isOnline(companion, timestamp = Date.now()) {
  const lastSeen = Date.parse(companion?.lastSeenAt || "");
  return Boolean(companion?.status === "online" && Number.isFinite(lastSeen) && timestamp - lastSeen < COMPANION_ONLINE_MS);
}

function versionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value || "").trim());
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(value, minimum = MINIMUM_COMPANION_VERSION) {
  const current = versionParts(value);
  const required = versionParts(minimum);
  if (!current || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== required[index]) return current[index] > required[index];
  }
  return true;
}

function companionCompatibility(companion) {
  if (!companion?.version) return "unknown";
  return versionAtLeast(companion.version) ? "supported" : "outdated";
}

function companionStatus(companion) {
  if (!isOnline(companion)) return "offline";
  if (companionCompatibility(companion) === "outdated") return "outdated";
  if (companion.runtimeStatus === "error") return "error";
  if (["checking", "downloading", "downloaded", "applying"].includes(companion.updateStatus)) return "updating";
  return "online";
}

function isAvailable(companion, timestamp = Date.now()) {
  return isOnline(companion, timestamp)
    && companionCompatibility(companion) === "supported"
    && companion.runtimeStatus !== "error";
}

function latestWorkspaceCompanion(document, workspaceId) {
  return document.companions
    .filter((item) => item.workspaceId === workspaceId)
    .sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0))[0] || null;
}

function accountReadiness(account, companion) {
  if (!account.enabled) return "unavailable";
  if (!account.credentialConfigured) return "reconnect_required";
  return isAvailable(companion) ? "ready" : "waiting_for_companion";
}

function hasActiveJobLease(job, companionId, timestamp = Date.now()) {
  const expiresAt = Date.parse(job?.leaseExpiresAt || "");
  return job?.leaseOwner === companionId && Number.isFinite(expiresAt) && expiresAt > timestamp;
}

function publicCompanion(companion) {
  if (!companion) return null;
  return {
    id: companion.id,
    workspaceId: companion.workspaceId,
    label: companion.label,
    companionInstanceId: companion.companionInstanceId || "",
    status: companionStatus(companion),
    version: companion.version || null,
    minimumSupportedVersion: MINIMUM_COMPANION_VERSION,
    compatibility: companionCompatibility(companion),
    runtimeStatus: companion.runtimeStatus || "unknown",
    lastError: companion.lastError || null,
    updateStatus: companion.updateStatus || "unknown",
    platform: companion.platform || null,
    architecture: companion.architecture || null,
    secureStorage: companion.secureStorage === true,
    accountHealth: {
      loginRequired: Number(companion.loginRequiredAccounts || 0),
    },
    lastSeenAt: companion.lastSeenAt || null,
    pairedAt: companion.pairedAt,
    updatedAt: companion.updatedAt,
  };
}

function publicAccount(document, account) {
  const companion = account.companionId
    ? document.companions.find((item) => item.id === account.companionId) || latestWorkspaceCompanion(document, account.workspaceId)
    : latestWorkspaceCompanion(document, account.workspaceId);
  const readiness = accountReadiness(account, companion);
  return {
    ...account,
    credentialConfigured: Boolean(account.credentialConfigured),
    companionId: companion?.id || account.companionId || null,
    companionStatus: companionStatus(companion),
    sessionStatus: account.credentialConfigured ? "connected" : "reconnect_required",
    readiness,
    safetyStatus: readiness === "reconnect_required" ? "restricted" : account.safetyStatus || "healthy",
  };
}

function activity(document, workspaceId, entry) {
  document.activityLogs.unshift({
    id: id("activity"),
    workspaceId,
    createdAt: now(),
    ...entry,
  });
  document.activityLogs = document.activityLogs.slice(0, 500);
}

function postFormat(mimeType, fileName) {
  if (!mimeType && !fileName) return "text";
  if (String(mimeType || "").startsWith("image/")) return "image";
  if (String(mimeType || "").startsWith("video/")) return "video";
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(fileName || "") ? "image" : "video";
}

function cleanFileName(value) {
  const base = path.basename(String(value || "upload"));
  return `${id("media")}-${base.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

function uploadPublic(document, upload) {
  const job = document.jobs
    .filter((item) => item.uploadId === upload.id)
    .sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0))[0];
  const account = document.accounts.find((item) => item.id === upload.accountId);
  const accountState = account ? publicAccount(document, account) : null;
  const jobIsDue = !job?.notBefore || Date.parse(job.notBefore) <= Date.now();
  const scheduledWithoutJobIsDue = !job && upload.status === "queued" && upload.scheduledAt && Date.parse(upload.scheduledAt) <= Date.now();
  const statusDetail = job?.state === "waiting_for_companion" && !jobIsDue
    ? "queued"
    : (job?.state === "queued" && jobIsDue && accountState?.companionStatus !== "online") || (scheduledWithoutJobIsDue && accountState?.companionStatus !== "online")
      ? "waiting_for_companion"
      : job?.state || (upload.status === "posted" ? "published" : upload.status);
  const { artifact, ...safeUpload } = upload;
  return {
    ...safeUpload,
    artifact: artifact ? {
      fileName: artifact.fileName,
      originalName: artifact.originalName,
      mimeType: artifact.mimeType,
      byteSize: artifact.byteSize,
      sha256: artifact.sha256,
      expiresAt: artifact.expiresAt,
    } : null,
    statusDetail,
    outcome: statusDetail === "published" || upload.status === "posted"
      ? "SUCCESS"
      : statusDetail === "uncertain" || upload.publishActionState === "uncertain"
        ? "UNCERTAIN"
        : upload.status === "failed" ? "FAILED" : null,
    jobId: job?.id || null,
    jobAttemptCount: job?.attemptCount || 0,
    companionStatus: accountState?.companionStatus || "offline",
  };
}

function resumeReconnectJobs(document, account, companion, timestamp) {
  if (!account.credentialConfigured || !isAvailable(companion, timestamp)) return;
  for (const job of document.jobs) {
    if (job.workspaceId !== account.workspaceId || job.accountId !== account.id || job.state !== "reconnect_required") continue;
    const upload = document.uploads.find((item) => item.id === job.uploadId);
    job.state = job.notBefore && Date.parse(job.notBefore) > timestamp ? "waiting_for_companion" : "queued";
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
    job.message = "The social session was reconnected. Publishing will continue automatically.";
    job.updatedAt = now();
    if (upload && upload.status !== "posted") {
      upload.status = "queued";
      upload.failureReason = null;
      upload.updatedAt = job.updatedAt;
    }
  }
}

function findOwned(document, collection, workspaceId, itemId, label) {
  const item = document[collection].find((entry) => entry.id === itemId && entry.workspaceId === workspaceId);
  if (!item) throw new Error(`${label} was not found.`);
  return item;
}

function localDateAt(day, time) {
  const [hour, minute] = String(time || "").split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

function localDateFromValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
}

function endOfLocalDate(value) {
  const date = localDateFromValue(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function daysBetween(start, end) {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.floor((endDay - startDay) / 86_400_000);
}

function dateInMonth(year, month, anchorDay, time) {
  const day = Math.min(anchorDay, new Date(year, month + 1, 0).getDate());
  return localDateAt(new Date(year, month, day), time);
}

function nextScheduleOccurrence(schedule, reference = new Date()) {
  if (schedule.status !== "active") return null;
  const createdAt = new Date(schedule.createdAt || reference);
  const anchor = Number.isFinite(createdAt.getTime()) ? createdAt : reference;
  let occurrence = null;
  if (schedule.frequency === "custom") {
    if (!schedule.customCronExpression || !nodeCron.validate(schedule.customCronExpression)) return null;
    const task = nodeCron.createTask(schedule.customCronExpression, () => undefined);
    try { occurrence = task.getNextRun(); } finally { void task.destroy(); }
  } else if (schedule.frequency === "onetime") {
    const date = localDateFromValue(schedule.endDate);
    if (date) occurrence = localDateAt(date, schedule.time);
  } else if (schedule.frequency === "daily") {
    occurrence = localDateAt(reference, schedule.time);
    if (occurrence?.getTime() <= reference.getTime()) occurrence.setDate(occurrence.getDate() + 1);
  } else if (schedule.frequency === "weekly") {
    const candidate = new Date(reference);
    candidate.setDate(candidate.getDate() + (anchor.getDay() - reference.getDay() + 7) % 7);
    occurrence = localDateAt(candidate, schedule.time);
    if (occurrence?.getTime() <= reference.getTime()) occurrence.setDate(occurrence.getDate() + 7);
  } else if (schedule.frequency === "biweekly") {
    const elapsed = Math.max(0, daysBetween(anchor, reference));
    const candidate = new Date(anchor);
    candidate.setDate(candidate.getDate() + elapsed - (elapsed % 14));
    occurrence = localDateAt(candidate, schedule.time);
    if (occurrence?.getTime() <= reference.getTime()) occurrence.setDate(occurrence.getDate() + 14);
  } else if (schedule.frequency === "monthly") {
    occurrence = dateInMonth(reference.getFullYear(), reference.getMonth(), anchor.getDate(), schedule.time);
    if (occurrence?.getTime() <= reference.getTime()) occurrence = dateInMonth(reference.getFullYear(), reference.getMonth() + 1, anchor.getDate(), schedule.time);
  } else if (schedule.frequency === "yearly") {
    occurrence = dateInMonth(reference.getFullYear(), anchor.getMonth(), anchor.getDate(), schedule.time);
    if (occurrence?.getTime() <= reference.getTime()) occurrence = dateInMonth(reference.getFullYear() + 1, anchor.getMonth(), anchor.getDate(), schedule.time);
  }
  if (!occurrence || occurrence.getTime() <= reference.getTime()) return null;
  const endAt = endOfLocalDate(schedule.endDate);
  return endAt && occurrence.getTime() > endAt.getTime() ? null : occurrence;
}

function normalizedScheduleInput(input = {}, previous = {}) {
  const name = input.name === undefined ? previous.name : String(input.name || "").trim();
  const time = input.time === undefined ? previous.time : String(input.time || "").trim();
  const frequency = input.frequency === undefined ? previous.frequency : String(input.frequency || "").trim();
  const status = input.status === undefined ? (previous.status || "active") : String(input.status || "").trim();
  const endDate = input.endDate === undefined ? previous.endDate : (String(input.endDate || "").trim() || undefined);
  const customCronExpression = input.customCronExpression === undefined
    ? previous.customCronExpression
    : (String(input.customCronExpression || "").trim() || undefined);
  if (!name || name.length > 120) throw new Error("Schedule name is required and must be 120 characters or fewer.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Schedule time must use 24-hour HH:MM format.");
  if (!SCHEDULE_FREQUENCIES.has(frequency)) throw new Error("Choose a supported schedule frequency.");
  if (!["active", "inactive"].includes(status)) throw new Error("Schedule status is invalid.");
  if (endDate && !localDateFromValue(endDate)) throw new Error("Schedule end date is invalid.");
  if (frequency === "onetime" && !endDate) throw new Error("One-time schedules need a date.");
  if (frequency === "custom" && (!customCronExpression || !nodeCron.validate(customCronExpression))) {
    throw new Error("Custom schedules need a valid cron expression.");
  }
  return { name, time, frequency, status, endDate, customCronExpression: frequency === "custom" ? customCronExpression : undefined };
}

function scheduleDue(upload, document, timestamp = Date.now()) {
  if (upload.status !== "queued") return false;
  if (!upload.scheduledAt && !upload.scheduleId) return true;
  if (upload.scheduledAt) return Date.parse(upload.scheduledAt) <= timestamp;
  const schedule = document.schedules.find((item) => item.id === upload.scheduleId);
  return Boolean(schedule?.nextRunAt && Date.parse(schedule.nextRunAt) <= timestamp);
}

function queueJob(document, upload) {
  const active = document.jobs.find((job) => job.uploadId === upload.id && !TERMINAL_JOB_STATES.has(job.state));
  if (active) return active;
  const job = {
    id: id("publishjob"),
    workspaceId: upload.workspaceId,
    uploadId: upload.id,
    accountId: upload.accountId,
    platform: upload.platform,
    state: isAvailable(latestWorkspaceCompanion(document, upload.workspaceId)) ? "queued" : "waiting_for_companion",
    notBefore: upload.scheduledAt || null,
    attemptCount: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  document.jobs.push(job);
  return job;
}

function refreshDueJobs(document, workspaceId, uploadIds) {
  const allowed = uploadIds?.length ? new Set(uploadIds) : null;
  const timestamp = Date.now();
  for (const upload of document.uploads) {
    if (upload.workspaceId !== workspaceId || (allowed && !allowed.has(upload.id))) continue;
    if (!upload.scheduleId && !upload.scheduledAt && scheduleDue(upload, document, timestamp)) queueJob(document, upload);
  }
}

export function publishingUserFromPrincipal(principal) {
  const capabilities = Array.isArray(principal.capabilities) ? principal.capabilities : [];
  const centralAccessLevel = capabilities.includes("publishing.accounts.configure") || capabilities.includes("publishing.execute")
    ? "configure"
    : capabilities.some((capability) => capability.startsWith("publishing.") && capability !== "publishing.view")
      ? "operate"
      : "view";
  const role = capabilities.includes("publishing.accounts.configure") || capabilities.includes("publishing.execute")
    ? "operations_manager"
    : capabilities.includes("publishing.schedule.manage")
      ? "scheduler"
      : capabilities.includes("publishing.content.create")
        ? "post_uploader"
        : "viewer";
  return {
    id: principal.userId,
    workspaceId: principal.workspaceId,
    platformUserId: principal.userId,
    username: principal.email || principal.name || principal.userId,
    fullName: principal.name || principal.email || "Workspace member",
    email: principal.email || "",
    role,
    isActive: true,
    createdAt: principal.createdAt || now(),
    updatedAt: now(),
    centralAccessLevel,
    capabilities,
  };
}

export async function getPublishingSnapshot(workspaceId) {
  await initialize();
  return documentValue(await readDatabaseDocument(DOCUMENT_KEY));
}

async function synchronizePublishingControlPlane(workspaceId, uploadIds) {
  const document = await getPublishingSnapshot(workspaceId);
  const selectedUploads = Array.isArray(uploadIds) && uploadIds.length ? new Set(uploadIds) : null;
  const workspaceAccounts = document.accounts.filter((item) => item.workspaceId === workspaceId);
  const workspaceUploads = document.uploads.filter((item) => item.workspaceId === workspaceId);
  const workspaceJobs = document.jobs.filter((item) => item.workspaceId === workspaceId && (!selectedUploads || selectedUploads.has(item.uploadId)));
  await synchronizePublishingJobs(workspaceId, workspaceJobs, workspaceUploads, workspaceAccounts);
  return document;
}

function applyRemotePublishingJobs(document, workspaceId, remoteJobs) {
  const jobsById = new Map(remoteJobs.map((item) => [item.id, item]));
  let changed = false;
  for (const job of document.jobs) {
    if (job.workspaceId !== workspaceId) continue;
    const remote = jobsById.get(job.id);
    if (!remote) continue;
    const upload = document.uploads.find((item) => item.id === job.uploadId && item.workspaceId === workspaceId);
    const before = JSON.stringify([job, upload]);
    job.state = remote.status === "success" ? "published" : remote.status;
    job.message = remote.message;
    job.attemptCount = remote.attemptCount;
    job.leaseOwner = remote.assignedDeviceId;
    job.leaseExpiresAt = remote.leaseExpiresAt;
    job.updatedAt = remote.updatedAt;
    if (upload) {
      if (remote.status === "success") {
        upload.status = "posted";
        upload.postedAt = remote.completedAt;
        upload.failureReason = null;
      } else if (["failed", "uncertain", "reconnect_required", "cancelled"].includes(remote.status)) {
        upload.status = "failed";
        upload.failureReason = remote.message || "Companion job did not complete.";
        if (remote.status === "uncertain") upload.publishActionState = "uncertain";
      } else if (["claimed", "running", "opening_platform", "uploading", "publishing"].includes(remote.status)) {
        upload.status = "processing";
      } else {
        upload.status = "queued";
      }
      upload.updatedAt = remote.updatedAt;
    }
    if (before !== JSON.stringify([job, upload])) changed = true;
  }
  return changed;
}

async function reconcilePublishingControlPlane(workspaceId, knownRemoteJobs) {
  const remoteJobs = Array.isArray(knownRemoteJobs)
    ? knownRemoteJobs.filter((item) => item.type === "publish")
    : await listSupabaseJobs(workspaceId, { type: "publish", limit: 500 });
  const current = await getPublishingSnapshot(workspaceId);
  if (!remoteJobs.length || !applyRemotePublishingJobs(current, workspaceId, remoteJobs)) return current;
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    applyRemotePublishingJobs(document, workspaceId, remoteJobs);
    return { document, result: document };
  });
}

export async function listCentralAccounts(workspaceId, platformName) {
  const document = await getPublishingSnapshot(workspaceId);
  const requestedPlatform = platformName ? platform(platformName) : null;
  const legacy = document.accounts
    .filter((item) => item.workspaceId === workspaceId && (!requestedPlatform || item.platform === requestedPlatform))
    .map((item) => publicAccount(document, item));
  const normalized = await listSupabaseAccounts(workspaceId, requestedPlatform || undefined);
  const byId = new Map(normalized.map((item) => [item.id, item]));
  return legacy.map((item) => ({ ...item, ...(byId.get(item.id) || {}) }));
}

export async function getCentralCompanion(workspaceId) {
  return latestSupabaseCompanion(workspaceId);
}

export function minimumCompanionVersion() {
  return MINIMUM_COMPANION_VERSION;
}

export async function createCompanionPairing(principal, input = {}) {
  return createSupabasePairing(principal, input);
}

export async function redeemCompanionPairing(input = {}) {
  await initialize();
  const codeHash = hashSecret(input.pairingCode || "");
  const companionInstanceId = String(input.companionInstanceId || "").trim().slice(0, 120);
  if (!companionInstanceId) throw new Error("Companion instance identity is required.");
  const token = `${randomUUID()}${randomUUID().replace(/-/g, "")}`;
  const companion = await mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const timestamp = now();
    const challenge = document.pairingChallenges.find((item) => safeEqual(item.codeHash, codeHash));
    document.pairingChallenges = document.pairingChallenges.filter((item) => item !== challenge && Date.parse(item.expiresAt || "") > Date.now());
    if (!challenge || Date.parse(challenge.expiresAt || "") <= Date.now()) {
      throw new Error("This one-time pairing request is invalid or expired.");
    }
    if (challenge.companionInstanceId && challenge.companionInstanceId !== companionInstanceId) {
      throw new Error("This pairing request belongs to a different Companion.");
    }
    const previous = latestWorkspaceCompanion(document, challenge.workspaceId);
    const record = {
      id: previous?.id || id("companion"),
      workspaceId: challenge.workspaceId,
      label: challenge.label,
      companionInstanceId,
      tokenHash: hashSecret(token),
      status: "offline",
      version: String(input.version || "").slice(0, 40) || null,
      runtimeStatus: "starting",
      updateStatus: "unknown",
      lastError: null,
      platform: String(input.platform || "").slice(0, 40) || null,
      architecture: String(input.architecture || "").slice(0, 40) || null,
      secureStorage: input.secureStorage === true,
      lastSeenAt: null,
      pairedAt: timestamp,
      updatedAt: timestamp,
      registeredByUserId: challenge.registeredByUserId,
    };
    document.companions = document.companions.filter((item) => item.workspaceId !== challenge.workspaceId);
    document.companions.push(record);
    for (const account of document.accounts) {
      if (account.workspaceId === challenge.workspaceId) account.companionId = record.id;
    }
    activity(document, challenge.workspaceId, { type: "companion.paired", summary: `${record.label} was paired securely.` });
    return { document, result: publicCompanion(record) };
  });
  return { companion, token };
}

export async function removeCentralCompanion(principal) {
  return revokeSupabaseCompanions(principal);
}

export async function authenticateCentralCompanion(token) {
  await initialize();
  const document = documentValue(await readDatabaseDocument(DOCUMENT_KEY));
  const secretHash = hashSecret(token || "");
  const companion = document.companions.find((item) => safeEqual(item.tokenHash, secretHash));
  if (!companion) throw new Error("This Companion pairing is no longer valid.");
  return publicCompanion(companion);
}

export async function heartbeatCentralCompanion(token, input = {}) {
  await initialize();
  const secretHash = hashSecret(token || "");
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const companion = document.companions.find((item) => safeEqual(item.tokenHash, secretHash));
    if (!companion) throw new Error("This Companion pairing is no longer valid.");
    const timestamp = now();
    companion.status = "online";
    companion.lastSeenAt = timestamp;
    companion.updatedAt = timestamp;
    if (input.companionInstanceId) companion.companionInstanceId = String(input.companionInstanceId).slice(0, 120);
    if (input.version) companion.version = String(input.version).slice(0, 40);
    if (["starting", "ready", "busy", "error"].includes(input.runtimeStatus)) companion.runtimeStatus = input.runtimeStatus;
    if (["unsupported", "idle", "checking", "downloading", "downloaded", "applying", "error"].includes(input.updateStatus)) companion.updateStatus = input.updateStatus;
    companion.lastError = String(input.lastError || "").trim().slice(0, 500) || null;
    companion.platform = String(input.platform || companion.platform || "").slice(0, 40) || null;
    companion.architecture = String(input.architecture || companion.architecture || "").slice(0, 40) || null;
    companion.secureStorage = input.secureStorage === true;
    const accounts = Array.isArray(input.accounts) ? input.accounts : [];
    for (const incoming of accounts) {
      if (!incoming || incoming.workspaceId !== companion.workspaceId || !PLATFORM_VALUES.has(incoming.platform)) continue;
      let account = document.accounts.find((item) => item.id === incoming.id && item.workspaceId === companion.workspaceId);
      if (!account) {
        account = {
          id: incoming.id || id("account"), workspaceId: companion.workspaceId, platform: incoming.platform,
          displayName: incoming.displayName || incoming.handle || incoming.platform, handle: incoming.handle || "",
          loginIdentifier: incoming.loginIdentifier || "", credentialConfigured: Boolean(incoming.credentialConfigured),
          enabled: incoming.enabled !== false,
          executionEngine: companionPublishingEngine(incoming.platform, incoming.executionEngine),
          companionId: companion.id, safetyStatus: incoming.safetyStatus || "healthy", createdAt: timestamp, updatedAt: timestamp,
        };
        document.accounts.push(account);
      } else {
        account.credentialConfigured = Boolean(incoming.credentialConfigured);
        account.enabled = incoming.enabled !== false;
        account.executionEngine = companionPublishingEngine(incoming.platform, incoming.executionEngine);
        account.safetyStatus = incoming.safetyStatus || account.safetyStatus || "healthy";
        account.companionId = companion.id;
        account.updatedAt = timestamp;
      }
      resumeReconnectJobs(document, account, companion, timestamp);
    }
    companion.loginRequiredAccounts = document.accounts.filter((account) => (
      account.workspaceId === companion.workspaceId && account.enabled && !account.credentialConfigured
    )).length;
    return { document, result: publicCompanion(companion) };
  });
}

export async function createCentralAccount(principal, platformName, input = {}) {
  const selectedPlatform = platform(platformName);
  await initialize();
  const account = await mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const timestamp = now();
    const handle = String(input.handle || "").trim();
    if (!handle) throw new Error("Enter the social account handle or name.");
    if (document.accounts.some((item) => item.workspaceId === principal.workspaceId && item.platform === selectedPlatform && item.handle.toLowerCase() === handle.toLowerCase())) {
      throw new Error("This social account is already linked to the workspace.");
    }
    const companion = latestWorkspaceCompanion(document, principal.workspaceId);
    const account = {
      id: id("account"), workspaceId: principal.workspaceId, platform: selectedPlatform,
      displayName: String(input.displayName || handle).trim().slice(0, 120) || handle,
      handle, loginIdentifier: String(input.loginIdentifier || "").trim().slice(0, 160),
      credentialConfigured: false, enabled: input.enabled !== false,
      executionEngine: companionPublishingEngine(selectedPlatform, input.executionEngine), safetyStatus: "healthy",
      companionId: companion?.id || null, createdAt: timestamp, updatedAt: timestamp,
    };
    document.accounts.push(account);
    activity(document, principal.workspaceId, { type: "account.created", summary: `${account.displayName} was added for ${selectedPlatform}.` });
    return { document, result: publicAccount(document, account) };
  });
  return upsertSupabaseAccount(account);
}

export async function updateCentralAccount(principal, accountId, input = {}) {
  await initialize();
  const account = await mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const account = findOwned(document, "accounts", principal.workspaceId, accountId, "Account");
    for (const key of ["displayName", "handle", "loginIdentifier", "enabled"]) {
      if (input[key] !== undefined) account[key] = key === "enabled" ? Boolean(input[key]) : String(input[key]).trim();
    }
    const executionEngine = companionPublishingEngine(account.platform, input.executionEngine ?? account.executionEngine);
    if (executionEngine !== account.executionEngine) account.credentialConfigured = false;
    account.executionEngine = executionEngine;
    account.updatedAt = now();
    return { document, result: publicAccount(document, account) };
  });
  await upsertSupabaseAccount(account);
  await synchronizePublishingControlPlane(principal.workspaceId);
  return account;
}

export async function deleteCentralAccount(principal, accountId) {
  await initialize();
  const result = await mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    findOwned(document, "accounts", principal.workspaceId, accountId, "Account");
    if (document.uploads.some((item) => item.workspaceId === principal.workspaceId && item.accountId === accountId && !["posted", "failed"].includes(item.status))) {
      throw new Error("This account has active publishing work and cannot be removed yet.");
    }
    document.accounts = document.accounts.filter((item) => item.id !== accountId);
    return { document, result: { ok: true } };
  });
  await deleteSupabaseAccount(principal.workspaceId, accountId);
  return result;
}

export async function listCentralUploads(workspaceId) {
  const document = await reconcilePublishingControlPlane(workspaceId);
  return document.uploads.filter((item) => item.workspaceId === workspaceId).map((item) => uploadPublic(document, item));
}

function createUploadInDocument(document, principal, input = {}) {
  const account = findOwned(document, "accounts", principal.workspaceId, input.accountId, "Account");
  if (!account.enabled) throw new Error("This publishing account is disabled.");
  const caption = String(input.caption || "").trim();
  const format = input.postFormat || postFormat(input.mimeType, input.originalName);
  if (!caption) throw new Error("Post text or description is required.");
  if (caption.length > PLATFORM_CAPTION_LIMITS[account.platform]) throw new Error(`This ${account.platform} post is longer than the platform limit.`);
  if (format === "text" && account.platform === "instagram") throw new Error("Instagram needs an image or video post.");
  if (format === "video" && account.platform === "youtube" && !String(input.title || "").trim()) throw new Error("YouTube video posts need a title.");
  if (format !== "text" && !input.rightsConfirmed) throw new Error("Confirm that you have rights to publish this media.");
  if (input.scheduleId && !document.schedules.some((item) => item.id === Number(input.scheduleId) && item.workspaceId === principal.workspaceId && item.status === "active")) {
    throw new Error("The selected schedule is unavailable.");
  }
  const scheduledTimestamp = input.scheduledAt ? Date.parse(input.scheduledAt) : null;
  if (scheduledTimestamp !== null && (!Number.isFinite(scheduledTimestamp) || scheduledTimestamp <= Date.now())) throw new Error("Scheduled publishing time must be in the future.");
  const scheduledAt = scheduledTimestamp === null ? null : new Date(scheduledTimestamp).toISOString();
  if (scheduledAt && input.scheduleId) throw new Error("Choose an exact time or a schedule template, not both.");
  const sourceSubmissionId = String(input.sourceSubmissionId || "").trim() || null;
  if (sourceSubmissionId) {
    const existing = document.uploads.find((item) => item.workspaceId === principal.workspaceId
      && item.accountId === account.id && item.sourceSubmissionId === sourceSubmissionId);
    if (existing) return uploadPublic(document, existing);
  }
  if (document.uploads.some((item) => item.workspaceId === principal.workspaceId && item.accountId === account.id && item.status === "queued"
    && item.caption === caption && item.originalName === (input.originalName || "Text post") && item.size === Number(input.size || 0)
    && (item.scheduledAt || null) === scheduledAt && Number(item.scheduleId || 0) === Number(input.scheduleId || 0))) {
    throw new Error("This exact post is already queued for the same account and time.");
  }
  const timestamp = now();
  const upload = {
    id: id("upload"), workspaceId: principal.workspaceId, platform: account.platform, accountId: account.id,
    postFormat: format, originalName: input.originalName || "Text post",
    fileName: input.fileName || "", mimeType: input.mimeType || "text/plain", extension: input.extension || "",
    size: Number(input.size || 0), url: input.url || "", artifact: input.artifact || null, title: String(input.title || "").trim(),
    platformOptions: requireYouTubeOptions(account.platform, format, input.platformOptions),
    caption, status: "queued", publishActionState: "not_started",
    uploadedAt: timestamp, updatedAt: timestamp, scheduledAt, scheduleId: input.scheduleId ? Number(input.scheduleId) : null,
    createdByUserId: principal.userId, createdByName: principal.name || principal.email || principal.userId,
    sourceSubmissionId, automation: { safetyDeferredUntil: null },
  };
  document.uploads.push(upload);
  if (!upload.scheduleId) queueJob(document, upload);
  activity(document, principal.workspaceId, { type: "post.queued", summary: `A ${account.platform} post was queued.`, uploadId: upload.id });
  return uploadPublic(document, upload);
}

export async function createCentralUploads(principal, inputs = []) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error("Choose at least one workspace account.");
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value, transaction) => {
    const document = documentValue(value);
    const result = inputs.map((input) => createUploadInDocument(document, principal, input));
    const uploadIds = new Set(result.map((upload) => upload.id));
    const workspaceAccounts = document.accounts.filter((item) => item.workspaceId === principal.workspaceId);
    const workspaceUploads = document.uploads.filter((item) => item.workspaceId === principal.workspaceId && uploadIds.has(item.id));
    const workspaceJobs = document.jobs.filter((item) => item.workspaceId === principal.workspaceId && uploadIds.has(item.uploadId));
    await synchronizePublishingJobs(
      principal.workspaceId,
      workspaceJobs,
      workspaceUploads,
      workspaceAccounts,
      transaction,
    );
    return { document, result };
  });
}

export async function createCentralUpload(principal, input = {}) {
  const [upload] = await createCentralUploads(principal, [input]);
  return upload;
}

export async function updateCentralUpload(principal, uploadId, input = {}) {
  await initialize();
  const upload = await mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const upload = findOwned(document, "uploads", principal.workspaceId, uploadId, "Post");
    for (const key of ["title", "caption", "platformOptions", "scheduledAt", "scheduleId", "accountId"]) {
      if (input[key] !== undefined) upload[key] = input[key] || null;
    }
    if (input.accountId) {
      const account = findOwned(document, "accounts", principal.workspaceId, input.accountId, "Account");
      upload.platform = account.platform;
    }
    const account = findOwned(document, "accounts", principal.workspaceId, upload.accountId, "Account");
    if (!account.enabled) throw new Error("This publishing account is disabled.");
    if (!String(upload.caption || "").trim()) throw new Error("Post text or description is required.");
    if (String(upload.caption).trim().length > PLATFORM_CAPTION_LIMITS[account.platform]) throw new Error(`This ${account.platform} post is longer than the platform limit.`);
    if (upload.postFormat === "text" && account.platform === "instagram") throw new Error("Instagram needs an image or video post.");
    if (upload.postFormat === "video" && account.platform === "youtube" && !String(upload.title || "").trim()) throw new Error("YouTube video posts need a title.");
    upload.platformOptions = requireYouTubeOptions(account.platform, upload.postFormat, upload.platformOptions);
    if (upload.scheduledAt) {
      const timestamp = Date.parse(upload.scheduledAt);
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error("Scheduled publishing time must be in the future.");
      upload.scheduledAt = new Date(timestamp).toISOString();
    }
    if (upload.scheduledAt && upload.scheduleId) throw new Error("Choose an exact time or a schedule template, not both.");
    if (upload.scheduleId) {
      upload.scheduleId = Number(upload.scheduleId);
      if (!document.schedules.some((item) => item.id === upload.scheduleId && item.workspaceId === principal.workspaceId && item.status === "active")) {
        throw new Error("The selected schedule is unavailable.");
      }
    }
    upload.updatedAt = now();
    const queuedJob = document.jobs.find((job) => job.uploadId === upload.id && ["queued", "waiting_for_companion"].includes(job.state));
    if (queuedJob) {
      queuedJob.notBefore = upload.scheduledAt || null;
      queuedJob.state = isAvailable(latestWorkspaceCompanion(document, principal.workspaceId)) ? "queued" : "waiting_for_companion";
      queuedJob.updatedAt = upload.updatedAt;
    } else if (!upload.scheduleId) {
      queueJob(document, upload);
    }
    return { document, result: uploadPublic(document, upload) };
  });
  await synchronizePublishingControlPlane(principal.workspaceId, [upload.id]);
  return upload;
}

export async function updateCentralUploadStatus(principal, uploadId, status, failureReason) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const upload = findOwned(document, "uploads", principal.workspaceId, uploadId, "Post");
    upload.status = status;
    upload.failureReason = failureReason || null;
    upload.updatedAt = now();
    if (status === "posted") upload.postedAt = upload.updatedAt;
    return { document, result: uploadPublic(document, upload) };
  });
}

export async function deleteCentralUpload(principal, uploadId) {
  await initialize();
  const result = await mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    findOwned(document, "uploads", principal.workspaceId, uploadId, "Post");
    const removedJobIds = document.jobs.filter((item) => item.uploadId === uploadId).map((item) => item.id);
    document.uploads = document.uploads.filter((item) => item.id !== uploadId);
    document.jobs = document.jobs.filter((item) => item.uploadId !== uploadId);
    return { document, result: { ok: true, removedJobIds } };
  });
  await Promise.all(result.removedJobIds.map((jobId) => cancelSupabaseJob(principal.workspaceId, jobId)));
  return { ok: true };
}

export async function createCentralStagedUpload(principal, input = {}) {
  const originalName = String(input.originalName || "").trim();
  const mimeType = String(input.mimeType || "").trim();
  const size = Number(input.size || 0);
  if (!originalName || !Number.isFinite(size) || size < 1) throw new Error("Choose a valid media file.");
  if (size > MAX_MEDIA_UPLOAD_BYTES) throw new Error("Media files must be 2 GB or smaller.");
  const sql = await getDatabaseSql();
  const stageId = id("stage");
  const fileName = cleanFileName(originalName);
  await sql`DELETE FROM agentic_that.publishing_staged_uploads WHERE updated_at < now() - interval '24 hours'`;
  await sql`
    INSERT INTO agentic_that.publishing_staged_uploads
      (id, workspace_id, created_by_user_id, original_name, mime_type, byte_size, upload_offset,
       chunk_size, upload_strategy, file_name, artifact_parts)
    VALUES
      (${stageId}, ${principal.workspaceId}, ${principal.userId}, ${originalName}, ${mimeType}, ${size}, 0,
       ${CENTRAL_UPLOAD_CHUNK_BYTES}, 'signed_parts', ${fileName}, ${sql.json([])})
  `;
  return { id: stageId, offset: 0, chunkSize: CENTRAL_UPLOAD_CHUNK_BYTES, uploadStrategy: "signed_parts", fileName };
}

function stagedUploadFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    originalName: row.original_name,
    mimeType: row.mime_type || "",
    size: Number(row.byte_size),
    offset: Number(row.upload_offset),
    chunkSize: Number(row.chunk_size),
    uploadStrategy: row.upload_strategy,
    fileName: row.file_name,
    artifactParts: Array.isArray(row.artifact_parts) ? row.artifact_parts : [],
    artifactManifest: row.artifact_manifest && typeof row.artifact_manifest === "object" ? row.artifact_manifest : null,
    finalizedAt: row.finalized_at instanceof Date ? row.finalized_at.toISOString() : row.finalized_at ? String(row.finalized_at) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    createdByUserId: row.created_by_user_id,
  };
}

async function lockedStagedUpload(transaction, workspaceId, stagedUploadId) {
  const [row] = await transaction`
    SELECT * FROM agentic_that.publishing_staged_uploads
    WHERE id = ${stagedUploadId} AND workspace_id = ${workspaceId}
    FOR UPDATE
  `;
  const stage = stagedUploadFromRow(row);
  if (!stage) throw new Error("Upload session was not found.");
  return stage;
}

export async function getCentralStagedUpload(workspaceId, stagedUploadId) {
  const sql = await getDatabaseSql();
  const [row] = await sql`
    SELECT * FROM agentic_that.publishing_staged_uploads
    WHERE id = ${stagedUploadId} AND workspace_id = ${workspaceId}
  `;
  const stage = stagedUploadFromRow(row);
  if (!stage) throw new Error("Upload session was not found.");
  return stage;
}

export async function finalizeCentralStagedUpload(principal, stagedUploadId, artifactManifest) {
  const sql = await getDatabaseSql();
  return sql.begin(async (transaction) => {
    const stage = await lockedStagedUpload(transaction, principal.workspaceId, stagedUploadId);
    if (stage.offset !== stage.size) throw new Error("The media upload has not finished yet.");
    if (!stage.artifactManifest) {
      if (!artifactManifest || typeof artifactManifest !== "object") throw new Error("The finalized private media is invalid.");
      await transaction`
        UPDATE agentic_that.publishing_staged_uploads
        SET artifact_manifest = ${transaction.json(artifactManifest)}, finalized_at = now(), updated_at = now()
        WHERE id = ${stage.id}
      `;
      stage.artifactManifest = artifactManifest;
      stage.finalizedAt = now();
    }
    return stage;
  });
}

export async function advanceCentralStagedUpload(principal, stagedUploadId, nextOffset, artifactPart = null) {
  const sql = await getDatabaseSql();
  return sql.begin(async (transaction) => {
    const stage = await lockedStagedUpload(transaction, principal.workspaceId, stagedUploadId);
    if (!Number.isInteger(nextOffset) || nextOffset < stage.offset || nextOffset > stage.size) throw new Error("The media upload offset is invalid.");
    if (artifactPart) {
      if (artifactPart.offset !== stage.offset || artifactPart.byteSize !== nextOffset - stage.offset || artifactPart.index !== Math.floor(stage.offset / stage.chunkSize)) {
        throw new Error("The private media upload part does not match this upload session.");
      }
      stage.artifactParts = (Array.isArray(stage.artifactParts) ? stage.artifactParts : []).filter((part) => part.index !== artifactPart.index);
      stage.artifactParts.push(artifactPart);
    }
    stage.offset = nextOffset;
    stage.updatedAt = now();
    await transaction`
      UPDATE agentic_that.publishing_staged_uploads
      SET upload_offset = ${stage.offset}, artifact_parts = ${transaction.json(stage.artifactParts)}, updated_at = now()
      WHERE id = ${stage.id}
    `;
    return { id: stage.id, offset: stage.offset, chunkSize: stage.chunkSize };
  });
}

function advanceStagedUploadPartsInDocument(document, workspaceId, stagedUploadId, artifactParts) {
  if (!Array.isArray(artifactParts) || artifactParts.length < 1 || artifactParts.length > 8) {
    throw new Error("The completed private media batch is invalid.");
  }
  const stage = findOwned(document, "stagedUploads", workspaceId, stagedUploadId, "Upload session");
  const ordered = [...artifactParts].sort((left, right) => left.offset - right.offset);
  let nextOffset = stage.offset;
  for (const part of ordered) {
    if (!Number.isInteger(part.offset) || !Number.isInteger(part.byteSize) || part.byteSize < 1
      || part.offset !== nextOffset || part.index !== Math.floor(part.offset / stage.chunkSize)
      || nextOffset + part.byteSize > stage.size) {
      throw new Error("The private media upload batch does not match this upload session.");
    }
    nextOffset += part.byteSize;
  }
  const completedIndexes = new Set(ordered.map((part) => part.index));
  stage.artifactParts = (Array.isArray(stage.artifactParts) ? stage.artifactParts : [])
    .filter((part) => !completedIndexes.has(part.index))
    .concat(ordered)
    .sort((left, right) => left.index - right.index);
  stage.offset = nextOffset;
  stage.updatedAt = now();
  return { id: stage.id, offset: stage.offset, chunkSize: stage.chunkSize };
}

export async function advanceCentralStagedUploadParts(principal, stagedUploadId, artifactParts) {
  const sql = await getDatabaseSql();
  return sql.begin(async (transaction) => {
    const stage = await lockedStagedUpload(transaction, principal.workspaceId, stagedUploadId);
    const document = { stagedUploads: [stage] };
    const result = advanceStagedUploadPartsInDocument(document, principal.workspaceId, stagedUploadId, artifactParts);
    await transaction`
      UPDATE agentic_that.publishing_staged_uploads
      SET upload_offset = ${stage.offset}, artifact_parts = ${transaction.json(stage.artifactParts)}, updated_at = now()
      WHERE id = ${stage.id}
    `;
    return result;
  });
}

export async function consumeCentralStagedUpload(principal, stagedUploadId) {
  const sql = await getDatabaseSql();
  return sql.begin(async (transaction) => {
    const stage = await lockedStagedUpload(transaction, principal.workspaceId, stagedUploadId);
    if (stage.offset !== stage.size) throw new Error("The media upload has not finished yet.");
    await transaction`DELETE FROM agentic_that.publishing_staged_uploads WHERE id = ${stage.id}`;
    return stage;
  });
}

export async function deleteCentralStagedUpload(principal, stagedUploadId) {
  const sql = await getDatabaseSql();
  return sql.begin(async (transaction) => {
    const stage = await lockedStagedUpload(transaction, principal.workspaceId, stagedUploadId);
    await transaction`DELETE FROM agentic_that.publishing_staged_uploads WHERE id = ${stage.id}`;
    return { ok: true };
  });
}

export async function listCentralSchedules(workspaceId) {
  const document = await getPublishingSnapshot(workspaceId);
  return document.schedules.filter((item) => item.workspaceId === workspaceId);
}

export async function createCentralSchedule(principal, input = {}) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const sequence = document.schedules.reduce((highest, item) => Math.max(highest, Number(item.id) || 0), 0) + 1;
    const timestamp = now();
    const fields = normalizedScheduleInput(input, { name: "", time: "", frequency: "", status: "active" });
    const schedule = { id: sequence, workspaceId: principal.workspaceId, ...fields, lastRunAt: undefined, nextRunAt: null, createdAt: timestamp, updatedAt: timestamp };
    schedule.nextRunAt = nextScheduleOccurrence(schedule)?.toISOString() || null;
    if (schedule.status === "active" && !schedule.nextRunAt) throw new Error("This schedule has no future occurrence.");
    document.schedules.push(schedule);
    return { document, result: schedule };
  });
}

export async function updateCentralSchedule(principal, scheduleId, input = {}) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const schedule = document.schedules.find((item) => Number(item.id) === Number(scheduleId) && item.workspaceId === principal.workspaceId);
    if (!schedule) throw new Error("Schedule was not found.");
    Object.assign(schedule, normalizedScheduleInput(input, schedule));
    schedule.nextRunAt = schedule.status === "active" ? nextScheduleOccurrence(schedule)?.toISOString() || null : null;
    if (schedule.status === "active" && !schedule.nextRunAt) throw new Error("This schedule has no future occurrence.");
    schedule.updatedAt = now();
    return { document, result: schedule };
  });
}

export async function deleteCentralSchedule(principal, scheduleId) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const found = document.schedules.some((item) => Number(item.id) === Number(scheduleId) && item.workspaceId === principal.workspaceId);
    if (!found) throw new Error("Schedule was not found.");
    document.schedules = document.schedules.filter((item) => !(Number(item.id) === Number(scheduleId) && item.workspaceId === principal.workspaceId));
    return { document, result: { ok: true } };
  });
}

function normalizeCentralSubmission(submission) {
  const description = String(
    submission.description ??
    submission.caption ??
    ""
  ).trim();

  return {
    ...submission,

    description,
    caption: description,

    selectedAccountIds: Array.isArray(submission.selectedAccountIds)
      ? submission.selectedAccountIds
      : [],

    destinationUploadIds: Array.isArray(submission.destinationUploadIds)
      ? submission.destinationUploadIds
      : [],

    rightsConfirmed:
      submission.postFormat === "text"
        ? true
        : submission.rightsConfirmed !== false,
  };
}

export async function listCentralSubmissions(workspaceId) {
  const document = await getPublishingSnapshot(workspaceId);

  return document.submissions
    .filter((item) => item.workspaceId === workspaceId)
    .map(normalizeCentralSubmission);
}

export async function createCentralSubmission(principal, input = {}) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const timestamp = now();
    const selectedAccountIds = Array.isArray(input.selectedAccountIds) ? input.selectedAccountIds : [];
    if (!selectedAccountIds.length) throw new Error("Choose at least one workspace account.");
    if (new Set(selectedAccountIds).size !== selectedAccountIds.length) throw new Error("Each publishing account can be selected only once.");
    const format = input.postFormat || postFormat(input.mimeType, input.originalName);
    const description = String(
  input.description ??
  input.caption ??
  ""
).trim();
    if (!description) throw new Error("Post text or description is required.");
    if (format !== "text" && !input.rightsConfirmed) throw new Error("Confirm that you have rights to publish this media.");
    for (const accountId of selectedAccountIds) {
      const account = findOwned(document, "accounts", principal.workspaceId, accountId, "Account");
      if (!account.enabled) throw new Error(`${account.displayName} is disabled and cannot receive new posts.`);
      if (description.length > PLATFORM_CAPTION_LIMITS[account.platform]) throw new Error(`This post is longer than the ${account.platform} limit.`);
      if (format === "text" && account.platform === "instagram") throw new Error("Instagram needs an image or video post.");
      if (format === "video" && account.platform === "youtube" && !String(input.title || "").trim()) throw new Error("YouTube video posts need a title.");
      requireYouTubeOptions(account.platform, format, input.platformOptions);
    }
    const submission = {
      id: id("submission"), workspaceId: principal.workspaceId, postFormat: format,
      originalName: input.originalName || "Text post", fileName: input.fileName || "", mimeType: input.mimeType || "text/plain",
      extension: input.extension || "", size: Number(input.size || 0), url: input.url || "", title: String(input.title || "").trim(),
      description, selectedAccountIds, status: "awaiting_schedule", createdAt: timestamp,
      platformOptions: input.platformOptions,
      updatedAt: timestamp, createdByUserId: principal.userId, createdByName: principal.name || principal.email || principal.userId,
    };
    document.submissions.push(submission);
    return { document, result: submission };
  });
}

export async function scheduleCentralSubmission(principal, submissionId, destinations = []) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const submission = findOwned(document, "submissions", principal.workspaceId, submissionId, "Submission");
    if (submission.status !== "awaiting_schedule") throw new Error("This submission has already been scheduled.");
    if (!Array.isArray(destinations) || !destinations.length) throw new Error("Choose a schedule for every selected account.");
    const requestedIds = destinations.map((destination) => destination.accountId);
    if (new Set(requestedIds).size !== requestedIds.length || requestedIds.length !== submission.selectedAccountIds.length
      || requestedIds.some((accountId) => !submission.selectedAccountIds.includes(accountId))) {
      throw new Error("The scheduler can set timing only for the accounts selected by the content uploader.");
    }
    const timestamp = now();
    const uploads = [];
    for (const destination of destinations) {
      const account = findOwned(document, "accounts", principal.workspaceId, destination.accountId, "Account");
      const scheduledTimestamp = destination.scheduledAt ? Date.parse(destination.scheduledAt) : null;
      if (scheduledTimestamp !== null && (!Number.isFinite(scheduledTimestamp) || scheduledTimestamp <= Date.now())) throw new Error("Scheduled publishing time must be in the future.");
      const scheduledAt = scheduledTimestamp === null ? null : new Date(scheduledTimestamp).toISOString();
      if (scheduledAt && destination.scheduleId) throw new Error("Choose an exact time or a schedule template, not both.");
      const scheduleId = destination.scheduleId ? Number(destination.scheduleId) : null;
      if (!scheduledAt && !scheduleId) throw new Error("Every selected account needs a publish time.");
      if (scheduleId && !document.schedules.some((item) => item.id === scheduleId && item.workspaceId === principal.workspaceId && item.status === "active")) {
        throw new Error("The selected schedule is unavailable.");
      }
      const upload = {
        id: id("upload"), workspaceId: principal.workspaceId, platform: account.platform, accountId: account.id,
        postFormat: submission.postFormat, originalName: submission.originalName, fileName: submission.fileName,
        mimeType: submission.mimeType, extension: submission.extension, size: submission.size, url: submission.url,
        title: submission.title, caption: destination.description ?? submission.description, status: "queued", publishActionState: "not_started",
        platformOptions: requireYouTubeOptions(account.platform, submission.postFormat, submission.platformOptions),
        uploadedAt: timestamp, updatedAt: timestamp, scheduledAt, scheduleId,
        sourceSubmissionId: submission.id, createdByUserId: submission.createdByUserId, createdByName: submission.createdByName,
      };
      document.uploads.push(upload);
      if (!upload.scheduleId) queueJob(document, upload);
      uploads.push(uploadPublic(document, upload));
    }
    submission.status = "scheduled";
    submission.updatedAt = timestamp;
    return { document, result: { submission, uploads } };
  });
}

export async function queueCentralUploads(principal, uploadIds) {
  await initialize();
  await reconcilePublishingControlPlane(principal.workspaceId);
  const ids = Array.isArray(uploadIds) ? uploadIds : undefined;
  const jobs = await mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    if (ids?.length) ids.forEach((item) => findOwned(document, "uploads", principal.workspaceId, item, "Post"));
    refreshDueJobs(document, principal.workspaceId, ids);
    return { document, result: document.jobs.filter((item) => item.workspaceId === principal.workspaceId && !TERMINAL_JOB_STATES.has(item.state)).map((item) => ({ ...item })) };
  });
  await synchronizePublishingControlPlane(principal.workspaceId, ids);
  return jobs;
}

function selectClaimableCentralJobs(document, workspaceId, timestamp, limit) {
  const maximum = Math.max(1, Math.min(Number(limit) || 1, 5));
  const selected = [];
  const candidates = document.jobs
    .filter((job) => job.workspaceId === workspaceId && ["queued", "waiting_for_companion"].includes(job.state))
    .filter((job) => {
      const upload = document.uploads.find((item) => item.id === job.uploadId);
      return Boolean(upload && !upload.scheduledAt && !upload.scheduleId);
    })
    .filter((job) => (!job.notBefore || Date.parse(job.notBefore) <= timestamp) && (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= timestamp))
    .filter((job) => job.attemptCount < MAX_JOB_ATTEMPTS);

  for (const job of candidates) {
    const upload = document.uploads.find((item) => item.id === job.uploadId);
    const account = document.accounts.find((item) => item.id === job.accountId);
    if (!upload || !account || !account.enabled) continue;
    if (!account.credentialConfigured) {
      job.state = "waiting_for_companion";
      job.updatedAt = now();
      continue;
    }
    selected.push({ job, upload, account });
    if (selected.length >= maximum) break;
  }
  return selected;
}

function recoverExpiredCentralJobLeases(document, workspaceId, timestamp) {
  for (const staleJob of document.jobs) {
    if (staleJob.workspaceId !== workspaceId || !staleJob.leaseExpiresAt || Date.parse(staleJob.leaseExpiresAt) > timestamp) continue;
    if (!["opening_platform", "uploading", "publishing"].includes(staleJob.state)) continue;
    const staleUpload = document.uploads.find((item) => item.id === staleJob.uploadId);
    staleJob.leaseOwner = null;
    staleJob.leaseExpiresAt = null;
    staleJob.updatedAt = now();
    if (staleJob.state === "publishing") {
      // A browser may have submitted a post just before it disconnected.
      // Never replay that uncertain final action automatically.
      staleJob.state = "uncertain";
      staleJob.message = "Publishing result is uncertain after the Companion disconnected. Review the platform before retrying.";
      if (staleUpload) {
        staleUpload.status = "failed";
        staleUpload.publishActionState = "uncertain";
        staleUpload.failureReason = staleJob.message;
        staleUpload.updatedAt = staleJob.updatedAt;
      }
    } else {
      staleJob.state = "queued";
      if (staleUpload) {
        staleUpload.status = "queued";
        staleUpload.updatedAt = staleJob.updatedAt;
      }
    }
  }
}

export async function claimCentralJobs(token, limit = 1) {
  await initialize();
  const secretHash = hashSecret(token || "");
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const companion = document.companions.find((item) => safeEqual(item.tokenHash, secretHash));
    if (!companion) throw new Error("This Companion pairing is no longer valid.");
    const timestamp = Date.now();
    companion.status = "online";
    companion.lastSeenAt = new Date(timestamp).toISOString();
    companion.updatedAt = companion.lastSeenAt;
    if (!versionAtLeast(companion.version)) {
      throw new Error(`Update Companion to ${MINIMUM_COMPANION_VERSION} or later to continue.`);
    }
    refreshDueJobs(document, companion.workspaceId);
    recoverExpiredCentralJobLeases(document, companion.workspaceId, timestamp);
    const jobs = selectClaimableCentralJobs(document, companion.workspaceId, timestamp, limit);
    const result = [];
    for (const { job, upload, account } of jobs) {
      job.state = "opening_platform";
      job.leaseOwner = companion.id;
      job.leaseExpiresAt = new Date(timestamp + JOB_LEASE_MS).toISOString();
      job.attemptCount += 1;
      job.updatedAt = now();
      upload.status = "processing";
      upload.updatedAt = job.updatedAt;
      result.push({ ...job, upload: uploadPublic(document, upload), account: publicAccount(document, account) });
    }
    return { document, result };
  });
}

function centralJobUpdateIsAllowed(job, companionId, state, timestamp = Date.now()) {
  // A verified local retry can finish after the central job exhausted its
  // attempts. Allow only that failed -> published reconciliation; every other
  // update still requires the active lease that prevents duplicate posting.
  if (["failed", "uncertain"].includes(job.state) && state === "published") return true;
  if (TERMINAL_JOB_STATES.has(job.state)) return false;
  return hasActiveJobLease(job, companionId, timestamp);
}

export async function updateCentralJob(token, jobId, input = {}) {
  await initialize();
  const secretHash = hashSecret(token || "");
  const states = new Set(["waiting_for_companion", "opening_platform", "uploading", "publishing", "published", "failed", "uncertain", "reconnect_required"]);
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const companion = document.companions.find((item) => safeEqual(item.tokenHash, secretHash));
    if (!companion) throw new Error("This Companion pairing is no longer valid.");
    const job = findOwned(document, "jobs", companion.workspaceId, jobId, "Publishing job");
    const state = states.has(input.state) ? input.state : "failed";
    if (!centralJobUpdateIsAllowed(job, companion.id, state)) {
      if (TERMINAL_JOB_STATES.has(job.state)) throw new Error("This publishing job is already complete.");
      throw new Error("This Companion no longer holds the publishing job lease.");
    }
    const upload = findOwned(document, "uploads", companion.workspaceId, job.uploadId, "Post");
    const account = findOwned(document, "accounts", companion.workspaceId, job.accountId, "Account");
    const timestamp = now();
    companion.status = "online";
    companion.lastSeenAt = timestamp;
    companion.updatedAt = timestamp;
    job.updatedAt = timestamp;
    job.leaseExpiresAt = new Date(Date.now() + JOB_LEASE_MS).toISOString();
    job.message = String(input.message || "").slice(0, 500) || null;
    if (state === "published") {
      job.state = state; job.leaseExpiresAt = null; upload.status = "posted"; upload.postedAt = timestamp; upload.failureReason = null;
      activity(document, companion.workspaceId, { type: "post.published", summary: `A ${account.platform} post was published.`, uploadId: upload.id });
    } else if (state === "reconnect_required") {
      account.credentialConfigured = false; account.updatedAt = timestamp;
      job.state = state; job.leaseExpiresAt = null; upload.status = "failed"; upload.failureReason = job.message || "Social media login needs reconnecting.";
    } else if (state === "uncertain") {
      job.state = state; job.leaseOwner = null; job.leaseExpiresAt = null;
      upload.status = "failed"; upload.publishActionState = "uncertain";
      upload.failureReason = job.message || "Publishing may have completed. Verify the platform before retrying.";
      activity(document, companion.workspaceId, { type: "post.uncertain", summary: upload.failureReason, uploadId: upload.id });
    } else if (state === "failed") {
      const retry = input.retry !== false && job.attemptCount < MAX_JOB_ATTEMPTS;
      job.state = retry ? "queued" : "failed";
      job.leaseOwner = null; job.leaseExpiresAt = null;
      upload.status = retry ? "queued" : "failed";
      upload.failureReason = job.message || "Publishing failed.";
      if (!retry) activity(document, companion.workspaceId, { type: "post.failed", summary: upload.failureReason, uploadId: upload.id });
    } else {
      job.state = state; upload.status = "processing";
    }
    upload.updatedAt = timestamp;
    return { document, result: { ...job, upload: uploadPublic(document, upload) } };
  });
}

export async function publishingDashboard(workspaceId) {
  const document = await reconcilePublishingControlPlane(workspaceId);
  const uploads = document.uploads.filter((item) => item.workspaceId === workspaceId);
  const control = await supabaseJobDashboard(workspaceId);
  const jobs = control.jobs.filter((item) => item.type === "publish").map((item) => {
    const safeJob = { ...item };
    delete safeJob.payload;
    return { ...safeJob, state: item.status === "success" ? "published" : item.status };
  });
  return {
    totals: {
      accounts: document.accounts.filter((item) => item.workspaceId === workspaceId).length,
      queued: uploads.filter((item) => item.status === "queued").length,
      processing: uploads.filter((item) => item.status === "processing").length,
      posted: uploads.filter((item) => item.status === "posted").length,
      failed: uploads.filter((item) => item.status === "failed").length,
    },
    companion: control.companion,
    jobs,
    recentActivity: document.activityLogs.filter((item) => item.workspaceId === workspaceId).slice(0, 30),
  };
}

export async function publishingWorkspaceSnapshot(workspaceId) {
  const control = await supabasePublishingWorkspaceSnapshot(workspaceId);
  const normalizedAccounts = control.accounts;
  const document = await reconcilePublishingControlPlane(workspaceId, control.jobs);
  const normalizedById = new Map(normalizedAccounts.map((item) => [item.id, item]));
  const accounts = document.accounts
    .filter((item) => item.workspaceId === workspaceId)
    .map((item) => {
      const account = publicAccount(document, item);
      return { ...account, ...(normalizedById.get(account.id) || {}) };
    });
  const uploads = document.uploads
    .filter((item) => item.workspaceId === workspaceId)
    .map((item) => uploadPublic(document, item));
  const jobs = control.jobs
    .filter((item) => item.type === "publish")
    .map((item) => {
      const safeJob = { ...item };
      delete safeJob.payload;
      return { ...safeJob, state: item.status === "success" ? "published" : item.status };
    });
  return {
    accounts,
    uploads,
    submissions: document.submissions
      .filter((item) => item.workspaceId === workspaceId)
      .map(normalizeCentralSubmission),
    schedules: [],
    activityLogs: document.activityLogs
      .filter((item) => item.workspaceId === workspaceId)
      .slice(0, 100)
      .map((item) => ({
        ...item,
        action: item.action || item.type || "publishing.activity",
        entityType: item.entityType || "upload",
        entityId: item.entityId || item.uploadId || null,
      })),
    companion: control.companion,
    jobs,
  };
}

export function centralMediaFileName(originalName) {
  return cleanFileName(originalName);
}

// Kept deliberately small so recovery behaviour can be regression-tested
// without connecting a test run to a production document store.
export const centralPublishingTestHelpers = {
  accountReadiness,
  advanceStagedUploadPartsInDocument,
  applyRemotePublishingJobs,
  centralJobUpdateIsAllowed,
  companionCompatibility,
  companionPublishingEngine,
  companionStatus,
  createUploadInDocument,
  hasActiveJobLease,
  recoverExpiredCentralJobLeases,
  resumeReconnectJobs,
  selectClaimableCentralJobs,
  versionAtLeast,
};
