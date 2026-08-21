import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import nodeCron from "node-cron";
import {
  initializeDatabaseDocument,
  mutateDatabaseDocument,
  readDatabaseDocument,
} from "../../../lib/database-document-store.js";

const DOCUMENT_KEY = "platform.publishing-central.v1";
const COMPANION_ONLINE_MS = 90_000;
const JOB_LEASE_MS = 5 * 60_000;
const MAX_JOB_ATTEMPTS = 3;
const PLATFORM_VALUES = new Set(["instagram", "facebook", "x", "linkedin", "youtube"]);
const SCHEDULE_FREQUENCIES = new Set(["daily", "weekly", "biweekly", "monthly", "yearly", "custom", "onetime"]);
const TERMINAL_JOB_STATES = new Set(["published", "failed", "cancelled"]);
const PLATFORM_CAPTION_LIMITS = { instagram: 2200, x: 280, linkedin: 3000, facebook: 63206, youtube: 5000 };

function companionPublishingEngine() {
  return "companion";
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
    executionEngine: companionPublishingEngine(),
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

function latestWorkspaceCompanion(document, workspaceId) {
  return document.companions
    .filter((item) => item.workspaceId === workspaceId)
    .sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0))[0] || null;
}

function accountReadiness(account, companion) {
  if (!account.enabled) return "unavailable";
  if (!account.credentialConfigured) return "reconnect_required";
  return isOnline(companion) ? "ready" : "waiting_for_companion";
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
    status: isOnline(companion) ? "online" : "offline",
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
    companionStatus: isOnline(companion) ? "online" : "offline",
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
  return {
    ...upload,
    statusDetail,
    jobId: job?.id || null,
    jobAttemptCount: job?.attemptCount || 0,
    companionStatus: accountState?.companionStatus || "offline",
  };
}

function resumeReconnectJobs(document, account, companion, timestamp) {
  if (!account.credentialConfigured || !isOnline(companion, timestamp)) return;
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
    state: isOnline(latestWorkspaceCompanion(document, upload.workspaceId)) ? "queued" : "waiting_for_companion",
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
  for (const schedule of document.schedules) {
    if (schedule.workspaceId !== workspaceId || schedule.status !== "active") continue;
    const dueAt = Date.parse(schedule.nextRunAt || "");
    if (!Number.isFinite(dueAt) || dueAt > timestamp) continue;
    for (const upload of document.uploads) {
      if (upload.workspaceId === workspaceId && upload.scheduleId === schedule.id && upload.status === "queued" && (!allowed || allowed.has(upload.id))) {
        queueJob(document, upload);
      }
    }
    schedule.lastRunAt = new Date(dueAt).toISOString();
    schedule.nextRunAt = nextScheduleOccurrence(schedule, new Date(timestamp + 1_000))?.toISOString() || null;
    if (!schedule.nextRunAt) schedule.status = "inactive";
    schedule.updatedAt = now();
  }
  for (const upload of document.uploads) {
    if (upload.workspaceId !== workspaceId || (allowed && !allowed.has(upload.id))) continue;
    if (!upload.scheduleId && scheduleDue(upload, document, timestamp)) queueJob(document, upload);
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

export async function listCentralAccounts(workspaceId, platformName) {
  const document = await getPublishingSnapshot(workspaceId);
  const requestedPlatform = platformName ? platform(platformName) : null;
  return document.accounts
    .filter((item) => item.workspaceId === workspaceId && (!requestedPlatform || item.platform === requestedPlatform))
    .map((item) => publicAccount(document, item));
}

export async function getCentralCompanion(workspaceId) {
  const document = await getPublishingSnapshot(workspaceId);
  return publicCompanion(latestWorkspaceCompanion(document, workspaceId));
}

export async function createCompanionPairing(principal, input = {}) {
  await initialize();
  const token = `${randomUUID()}${randomUUID().replace(/-/g, "")}`;
  const label = String(input.label || "Workspace Companion").trim().slice(0, 80) || "Workspace Companion";
  const result = await mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const timestamp = now();
    const previous = latestWorkspaceCompanion(document, principal.workspaceId);
    const companion = {
      id: previous?.id || id("companion"),
      workspaceId: principal.workspaceId,
      label,
      companionInstanceId: String(input.companionInstanceId || previous?.companionInstanceId || "").slice(0, 120),
      tokenHash: hashSecret(token),
      status: "offline",
      lastSeenAt: previous?.lastSeenAt || null,
      pairedAt: previous?.pairedAt || timestamp,
      updatedAt: timestamp,
      registeredByUserId: principal.userId,
    };
    document.companions = document.companions.filter((item) => item.workspaceId !== principal.workspaceId);
    document.companions.push(companion);
    for (const account of document.accounts) {
      if (account.workspaceId === principal.workspaceId) account.companionId = companion.id;
    }
    activity(document, principal.workspaceId, { type: "companion.paired", summary: `${label} was paired.` });
    return { document, result: publicCompanion(companion) };
  });
  return { companion: result, token };
}

export async function removeCentralCompanion(principal) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const before = document.companions.length;
    document.companions = document.companions.filter((item) => item.workspaceId !== principal.workspaceId);
    for (const account of document.accounts) {
      if (account.workspaceId === principal.workspaceId) account.companionId = null;
    }
    return { document, result: { ok: true, removed: before !== document.companions.length } };
  });
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
    const accounts = Array.isArray(input.accounts) ? input.accounts : [];
    for (const incoming of accounts) {
      if (!incoming || incoming.workspaceId !== companion.workspaceId || !PLATFORM_VALUES.has(incoming.platform)) continue;
      let account = document.accounts.find((item) => item.id === incoming.id && item.workspaceId === companion.workspaceId);
      if (!account) {
        account = {
          id: incoming.id || id("account"), workspaceId: companion.workspaceId, platform: incoming.platform,
          displayName: incoming.displayName || incoming.handle || incoming.platform, handle: incoming.handle || "",
          loginIdentifier: incoming.loginIdentifier || "", credentialConfigured: Boolean(incoming.credentialConfigured),
          enabled: incoming.enabled !== false, executionEngine: companionPublishingEngine(),
          companionId: companion.id, safetyStatus: incoming.safetyStatus || "healthy", createdAt: timestamp, updatedAt: timestamp,
        };
        document.accounts.push(account);
      } else {
        account.credentialConfigured = Boolean(incoming.credentialConfigured);
        account.enabled = incoming.enabled !== false;
        account.executionEngine = companionPublishingEngine();
        account.safetyStatus = incoming.safetyStatus || account.safetyStatus || "healthy";
        account.companionId = companion.id;
        account.updatedAt = timestamp;
      }
      resumeReconnectJobs(document, account, companion, timestamp);
    }
    return { document, result: publicCompanion(companion) };
  });
}

export async function createCentralAccount(principal, platformName, input = {}) {
  const selectedPlatform = platform(platformName);
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
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
      executionEngine: companionPublishingEngine(), safetyStatus: "healthy",
      companionId: companion?.id || null, createdAt: timestamp, updatedAt: timestamp,
    };
    document.accounts.push(account);
    activity(document, principal.workspaceId, { type: "account.created", summary: `${account.displayName} was added for ${selectedPlatform}.` });
    return { document, result: publicAccount(document, account) };
  });
}

export async function updateCentralAccount(principal, accountId, input = {}) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const account = findOwned(document, "accounts", principal.workspaceId, accountId, "Account");
    for (const key of ["displayName", "handle", "loginIdentifier", "enabled"]) {
      if (input[key] !== undefined) account[key] = key === "enabled" ? Boolean(input[key]) : String(input[key]).trim();
    }
    account.executionEngine = companionPublishingEngine();
    account.updatedAt = now();
    return { document, result: publicAccount(document, account) };
  });
}

export async function deleteCentralAccount(principal, accountId) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    findOwned(document, "accounts", principal.workspaceId, accountId, "Account");
    if (document.uploads.some((item) => item.workspaceId === principal.workspaceId && item.accountId === accountId && !["posted", "failed"].includes(item.status))) {
      throw new Error("This account has active publishing work and cannot be removed yet.");
    }
    document.accounts = document.accounts.filter((item) => item.id !== accountId);
    return { document, result: { ok: true } };
  });
}

export async function listCentralUploads(workspaceId) {
  const document = await getPublishingSnapshot(workspaceId);
  return document.uploads.filter((item) => item.workspaceId === workspaceId).map((item) => uploadPublic(document, item));
}

export async function createCentralUpload(principal, input = {}) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
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
      size: Number(input.size || 0), url: input.url || "", title: String(input.title || "").trim(),
      caption, status: "queued", publishActionState: "not_started",
      uploadedAt: timestamp, updatedAt: timestamp, scheduledAt, scheduleId: input.scheduleId ? Number(input.scheduleId) : null,
      createdByUserId: principal.userId, createdByName: principal.name || principal.email || principal.userId,
      sourceSubmissionId: input.sourceSubmissionId || null, automation: { safetyDeferredUntil: null },
    };
    document.uploads.push(upload);
    if (!upload.scheduleId) queueJob(document, upload);
    activity(document, principal.workspaceId, { type: "post.queued", summary: `A ${account.platform} post was queued.`, uploadId: upload.id });
    return { document, result: uploadPublic(document, upload) };
  });
}

export async function updateCentralUpload(principal, uploadId, input = {}) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const upload = findOwned(document, "uploads", principal.workspaceId, uploadId, "Post");
    for (const key of ["title", "caption", "scheduledAt", "scheduleId", "accountId"]) {
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
      queuedJob.state = isOnline(latestWorkspaceCompanion(document, principal.workspaceId)) ? "queued" : "waiting_for_companion";
      queuedJob.updatedAt = upload.updatedAt;
    } else if (!upload.scheduleId) {
      queueJob(document, upload);
    }
    return { document, result: uploadPublic(document, upload) };
  });
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
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    findOwned(document, "uploads", principal.workspaceId, uploadId, "Post");
    document.uploads = document.uploads.filter((item) => item.id !== uploadId);
    document.jobs = document.jobs.filter((item) => item.uploadId !== uploadId);
    return { document, result: { ok: true } };
  });
}

export async function createCentralStagedUpload(principal, input = {}) {
  const originalName = String(input.originalName || "").trim();
  const mimeType = String(input.mimeType || "").trim();
  const size = Number(input.size || 0);
  if (!originalName || !Number.isFinite(size) || size < 1) throw new Error("Choose a valid media file.");
  if (size > 500 * 1024 * 1024) throw new Error("Media files must be 500 MB or smaller.");
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const stage = {
      id: id("stage"), workspaceId: principal.workspaceId, originalName, mimeType,
      size, offset: 0, chunkSize: 2 * 1024 * 1024, fileName: cleanFileName(originalName),
      createdAt: now(), updatedAt: now(), createdByUserId: principal.userId,
    };
    document.stagedUploads.push(stage);
    document.stagedUploads = document.stagedUploads.filter((item) => Date.now() - Date.parse(item.updatedAt || 0) < 24 * 60 * 60 * 1000);
    return { document, result: { id: stage.id, offset: 0, chunkSize: stage.chunkSize, fileName: stage.fileName } };
  });
}

export async function getCentralStagedUpload(workspaceId, stagedUploadId) {
  const document = await getPublishingSnapshot(workspaceId);
  return findOwned(document, "stagedUploads", workspaceId, stagedUploadId, "Upload session");
}

export async function advanceCentralStagedUpload(principal, stagedUploadId, nextOffset) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const stage = findOwned(document, "stagedUploads", principal.workspaceId, stagedUploadId, "Upload session");
    if (!Number.isInteger(nextOffset) || nextOffset < stage.offset || nextOffset > stage.size) throw new Error("The media upload offset is invalid.");
    stage.offset = nextOffset;
    stage.updatedAt = now();
    return { document, result: { id: stage.id, offset: stage.offset, chunkSize: stage.chunkSize } };
  });
}

export async function consumeCentralStagedUpload(principal, stagedUploadId) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const stage = findOwned(document, "stagedUploads", principal.workspaceId, stagedUploadId, "Upload session");
    if (stage.offset !== stage.size) throw new Error("The media upload has not finished yet.");
    document.stagedUploads = document.stagedUploads.filter((item) => item.id !== stage.id);
    return { document, result: stage };
  });
}

export async function deleteCentralStagedUpload(principal, stagedUploadId) {
  await initialize();
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    findOwned(document, "stagedUploads", principal.workspaceId, stagedUploadId, "Upload session");
    document.stagedUploads = document.stagedUploads.filter((item) => item.id !== stagedUploadId);
    return { document, result: { ok: true } };
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
    }
    const submission = {
      id: id("submission"), workspaceId: principal.workspaceId, postFormat: format,
      originalName: input.originalName || "Text post", fileName: input.fileName || "", mimeType: input.mimeType || "text/plain",
      extension: input.extension || "", size: Number(input.size || 0), url: input.url || "", title: String(input.title || "").trim(),
      description, selectedAccountIds, status: "awaiting_schedule", createdAt: timestamp,
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
  return mutateDatabaseDocument(DOCUMENT_KEY, blankDocument(), async (value) => {
    const document = documentValue(value);
    const ids = Array.isArray(uploadIds) ? uploadIds : undefined;
    if (ids?.length) ids.forEach((item) => findOwned(document, "uploads", principal.workspaceId, item, "Post"));
    refreshDueJobs(document, principal.workspaceId, ids);
    return { document, result: document.jobs.filter((item) => item.workspaceId === principal.workspaceId && !TERMINAL_JOB_STATES.has(item.state)).map((item) => ({ ...item })) };
  });
}

function selectClaimableCentralJobs(document, workspaceId, timestamp, limit) {
  const maximum = Math.max(1, Math.min(Number(limit) || 1, 5));
  const selected = [];
  const candidates = document.jobs
    .filter((job) => job.workspaceId === workspaceId && ["queued", "waiting_for_companion"].includes(job.state))
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
    refreshDueJobs(document, companion.workspaceId);
    for (const staleJob of document.jobs) {
      if (staleJob.workspaceId !== companion.workspaceId || !staleJob.leaseExpiresAt || Date.parse(staleJob.leaseExpiresAt) > timestamp) continue;
      if (!["opening_platform", "uploading", "publishing"].includes(staleJob.state)) continue;
      const staleUpload = document.uploads.find((item) => item.id === staleJob.uploadId);
      staleJob.leaseOwner = null;
      staleJob.leaseExpiresAt = null;
      staleJob.updatedAt = now();
      if (staleJob.state === "publishing") {
        // A browser may have submitted a post just before it disconnected.
        // Never replay that uncertain final action automatically.
        staleJob.state = "failed";
        staleJob.message = "Publishing result is uncertain after the Companion disconnected. Review the platform before retrying.";
        if (staleUpload) {
          staleUpload.status = "failed";
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
  if (job.state === "failed" && state === "published") return true;
  if (TERMINAL_JOB_STATES.has(job.state)) return false;
  return hasActiveJobLease(job, companionId, timestamp);
}

export async function updateCentralJob(token, jobId, input = {}) {
  await initialize();
  const secretHash = hashSecret(token || "");
  const states = new Set(["waiting_for_companion", "opening_platform", "uploading", "publishing", "published", "failed", "reconnect_required"]);
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
  const document = await getPublishingSnapshot(workspaceId);
  const uploads = document.uploads.filter((item) => item.workspaceId === workspaceId);
  const jobs = document.jobs.filter((item) => item.workspaceId === workspaceId);
  return {
    totals: {
      accounts: document.accounts.filter((item) => item.workspaceId === workspaceId).length,
      queued: uploads.filter((item) => item.status === "queued").length,
      processing: uploads.filter((item) => item.status === "processing").length,
      posted: uploads.filter((item) => item.status === "posted").length,
      failed: uploads.filter((item) => item.status === "failed").length,
    },
    companion: publicCompanion(latestWorkspaceCompanion(document, workspaceId)),
    jobs: jobs.map((item) => ({ ...item })),
    recentActivity: document.activityLogs.filter((item) => item.workspaceId === workspaceId).slice(0, 30),
  };
}

export function centralMediaFileName(originalName) {
  return cleanFileName(originalName);
}

// Kept deliberately small so recovery behaviour can be regression-tested
// without connecting a test run to a production document store.
export const centralPublishingTestHelpers = {
  accountReadiness,
  centralJobUpdateIsAllowed,
  companionPublishingEngine,
  hasActiveJobLease,
  resumeReconnectJobs,
  selectClaimableCentralJobs,
};
