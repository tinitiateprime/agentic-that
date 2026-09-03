import "./env.js";
import cors from "cors";
import express from "express";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { ZodError, z } from "zod";
import { verifyPublishingWorkspaceIdentity } from "../../../../lib/publishing-workspace-auth.js";
import { verifyServiceAccessToken } from "../../../../lib/service-access-token.js";
import { RollingTrialUsageLimiter } from "../../../../lib/trial-usage-limit.ts";
import {
  cancelAllInstagramCompanionJobs,
  cancelInstagramCompanionJob,
  createInstagramCompanionJob,
  getInstagramCompanionJob,
  instagramCompanionActivityState,
  instagramCompanionQueueHealth,
  subscribeInstagramCompanionActivity,
} from "../../../scraping/instagram/src/companion-jobs.js";
import {
  cancelAllFacebookCompanionJobs,
  cancelFacebookCompanionJob,
  createFacebookCompanionJob,
  facebookCompanionActivityState,
  facebookCompanionQueueHealth,
  getFacebookCompanionJob,
  subscribeFacebookCompanionActivity,
} from "../../../scraping/facebook/src/companion-jobs.js";
import {
  companionResourceSchedulerState,
  setCompanionPublishingBusyProvider,
} from "../../../scraping/companion-resource-scheduler.js";
import {
  createUserProfileSchema,
  loginInputSchema,
  platformLabels,
  platformPostRules,
  platforms,
  platformSchema,
  postFormatSchema,
  scheduleIdSchema,
  updateUploadDetailsSchema,
  updateUploadStatusSchema,
  updateUserProfileSchema,
  upsertPlatformAccountSchema,
  upsertPublishingScheduleSchema,
  unifiedPostDestinationsSchema,
  type Platform,
  type PlatformAccount,
  type PostFormat,
  type PublishingSchedule,
  type PlatformUpload,
  type UserProfile,
  type UserRole
} from "../shared/schema.js";
import {
  automationInput,
  claimContentSubmission,
  createPlatformAccount,
  createContentSubmission,
  createPublishingSchedule,
  createUpload,
  createUserProfile,
  deactivateUserProfile,
  dashboardSummary,
  deferUploadForSafety,
  deletePlatformAccount,
  deletePublishingSchedule,
  deleteUpload,
  completeContentSubmission,
  getContentSubmission,
  getPlatformAccount,
  getUserProfile,
  listPlatformAccounts,
  listContentSubmissions,
  listPublishingSchedules,
  listSocialMediaSchedules,
  listActivityLogs,
  listUploads,
  listUserProfiles,
  loginPlatformWorkspaceManager,
  localStorageHealth,
  logActivity,
  loginUser,
  platformWorkspaceManagerStatus,
  recoverInterruptedPublishingWork,
  releaseContentSubmissionClaim,
  nextPublishingScheduleOccurrence,
  setupPlatformWorkspaceManager,
  upsertCentralWorkspaceActor,
  updatePublishingSchedule,
  updatePlatformAccount,
  updateUploadDetails,
  updateUploadStatus,
  updateUserProfile,
  upsertSyncedPlatformAccount,
  upsertSyncedUpload,
} from "./local-storage.js";
import {
  cancelAutomation,
  isAutomationRunning,
  publishingBrowserRuntimeHealth,
  reconcileSavedAccountSessions,
  removeSavedAccountProfile,
  runAutomation,
  startManualAccountSession,
} from "./services/publisher.js";
import { publishingDesktopHost } from "./services/desktop-host.js";
import { deletePublishingMedia, readPublishingMedia, storePublishingMedia } from "./media-storage.js";
import { publishingCompanionId } from "./companion-identity.js";
import { assessScheduledPublishingSafety } from "./services/safety-governor.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import {
  assertContentPreflight,
  ContentPreflightError,
  evaluateContentPreflight,
} from "./services/content-preflight.js";
import { publishingUploadDirectory } from "./runtime-paths.js";

export {
  arrangeExternalBrowserWindows,
  focusExternalBrowserWindow,
  stopAllExternalBrowserWindows,
} from "./engines/external-browser/index.js";
export {
  cancelAllInstagramCompanionJobs,
  instagramCompanionActivityState,
  subscribeInstagramCompanionActivity,
};
export { cancelAllFacebookCompanionJobs, facebookCompanionActivityState, subscribeFacebookCompanionActivity };

export const publishingApp = express();
const app = publishingApp;
const port = Number(process.env.PUBLISH_QUEUE_SERVICE_PORT ?? process.env.PORT ?? 8792);
const host = process.env.PUBLISH_QUEUE_SERVICE_HOST?.trim() || "127.0.0.1";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDesktopAssets = path.join(path.dirname(fileURLToPath(import.meta.url)), "desktop");
const uploadDir = publishingUploadDirectory();
const stagedUploadDir = path.join(uploadDir, ".staged");
const allowedUploadExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);
const allowedUploadMimePrefixes = ["image/", "video/"];
const imageUploadExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const videoUploadExtensions = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);
const maxUploadFileSize = Number(process.env.UPLOAD_MAX_FILE_BYTES ?? 500 * 1024 * 1024);
const centralPairingFile = path.join(uploadDir, ".workspace-companion", "pairing.json");
const centralPollIntervalMs = Math.max(5_000, Number(process.env.AGENTICTHAT_COMPANION_POLL_MS ?? 12_000));
const configuredWebOrigins = new Set(
  (process.env.PUBLISH_QUEUE_WEB_ORIGIN ?? process.env.WEB_ORIGIN ?? "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean),
);

setCompanionPublishingBusyProvider(() => isAutomationRunning());

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(stagedUploadDir, { recursive: true });

type CentralCompanionPairing = {
  supabaseUrl: string;
  supabaseApiKey: string;
  supabaseAnonKey?: string;
  pairingToken: string;
  companionId: string;
  workspaceId: string;
  savedAt: string;
};

type CentralConnectionState = {
  status: "unpaired" | "connecting" | "online" | "offline" | "updating" | "outdated" | "error";
  lastHeartbeatAt: string | null;
  lastError: string | null;
  companion: Record<string, unknown> | null;
};

type CentralPublishingJob = {
  id: string;
  type: "publish";
  payload: {
    upload: PlatformUpload & { artifact?: CentralJobArtifact | null };
    account: PlatformAccount;
  };
};

type CentralJobArtifact = {
  bucket: string;
  path: string;
  fileName: string;
  mimeType?: string;
  byteSize?: number;
  sha256?: string;
  downloadUrl: string;
  expiresAt?: string;
};

type CentralCompanionJob = CentralPublishingJob | {
  id: string;
  type: "scrape.instagram" | "scrape.facebook";
  payload: Record<string, unknown>;
};

let centralPollingTimer: NodeJS.Timeout | null = null;
let centralPollInFlight = false;
let centralConnectionState: CentralConnectionState = {
  status: "unpaired",
  lastHeartbeatAt: null,
  lastError: null,
  companion: null,
};

function supabaseApiOrigin(value: unknown) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("The Supabase API URL must use HTTPS.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The Supabase API URL is invalid.");
  }
  return url.origin;
}

function pairingEncryptionKey() {
  const secret = process.env.PUBLISH_QUEUE_SESSION_ENCRYPTION_KEY?.trim();
  return secret ? createHash("sha256").update(secret).digest() : null;
}

async function durableWrite(filePath: string, contents: string) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.promises.open(temporary, "w", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.promises.rename(temporary, filePath);
  } catch (error) {
    await fs.promises.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function protectCentralPairing(value: CentralCompanionPairing) {
  const key = pairingEncryptionKey();
  if (!key) throw new Error("Secure operating-system storage is unavailable. Companion pairing was not saved.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 2,
    protected: true,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

function unprotectCentralPairing(value: Record<string, unknown>) {
  const key = pairingEncryptionKey();
  if (!key) throw new Error("Secure operating-system storage is unavailable.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(String(value.iv || ""), "base64"));
  decipher.setAuthTag(Buffer.from(String(value.tag || ""), "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(String(value.ciphertext || ""), "base64")),
    decipher.final(),
  ]).toString("utf8")) as CentralCompanionPairing;
}

function validCentralPairing(value: Partial<CentralCompanionPairing> | null): value is CentralCompanionPairing {
  return Boolean(value?.supabaseUrl && value?.supabaseApiKey && value?.pairingToken && value?.workspaceId && value?.companionId);
}

async function readCentralPairing(): Promise<CentralCompanionPairing | null> {
  try {
    const stored = JSON.parse(await fs.promises.readFile(centralPairingFile, "utf8")) as Record<string, unknown>;
    const decoded = stored?.protected === true
      ? unprotectCentralPairing(stored)
      : stored as CentralCompanionPairing;
    const value = {
      ...decoded,
      supabaseApiKey: decoded.supabaseApiKey || decoded.supabaseAnonKey || "",
      supabaseAnonKey: undefined,
    };
    if (!validCentralPairing(value)) return null;
    if (stored?.protected !== true && pairingEncryptionKey()) await writeCentralPairing(value);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn("Could not read the encrypted workspace pairing:", error instanceof Error ? error.message : error);
    }
    return null;
  }
}

async function writeCentralPairing(value: CentralCompanionPairing) {
  await durableWrite(centralPairingFile, protectCentralPairing(value));
}

function supabaseApiHeaders(apiKey: string) {
  const headers: Record<string, string> = { apikey: apiKey };
  if (!apiKey.startsWith("sb_")) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

async function supabaseRpc<T>(pairing: Pick<CentralCompanionPairing, "supabaseUrl" | "supabaseApiKey">, name: string, input: Record<string, unknown>) {
  const response = await fetch(`${pairing.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: {
      ...supabaseApiHeaders(pairing.supabaseApiKey),
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string; details?: string };
    throw new Error(payload.message || payload.details || `Supabase job control returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

async function heartbeatCentralPairing(pairing: CentralCompanionPairing) {
  const accounts = await listPlatformAccounts(undefined, pairing.workspaceId);
  const companion = await supabaseRpc<Record<string, unknown>>(pairing, "companion_heartbeat", {
    p_token: pairing.pairingToken,
    p_instance_id: publishingCompanionId(),
    p_version: process.env.AGENTICTHAT_COMPANION_VERSION?.trim() || null,
    p_runtime_status: isAutomationRunning() ? "busy" : "ready",
    p_update_status: process.env.AGENTICTHAT_COMPANION_UPDATE_STATUS?.trim() || "idle",
    p_last_error: process.env.AGENTICTHAT_COMPANION_RUNTIME_ERROR?.trim() || null,
    p_platform: process.platform,
    p_architecture: process.arch,
    p_secure_storage: Boolean(pairingEncryptionKey()),
    p_accounts: accounts,
  });
  const reportedStatus = String(companion?.status || "online");
  const status: CentralConnectionState["status"] = ["online", "offline", "updating", "outdated", "error"].includes(reportedStatus)
    ? reportedStatus as CentralConnectionState["status"]
    : "online";
  centralConnectionState = {
    status,
    lastHeartbeatAt: new Date().toISOString(),
    lastError: null,
    companion: companion || null,
  };
}

async function downloadCentralPublishingMedia(pairing: CentralCompanionPairing, fileName: string, artifact?: CentralJobArtifact | null) {
  const safeName = path.basename(String(fileName || ""));
  if (!safeName || safeName !== fileName) throw new Error("The publishing media filename is invalid.");
  const localPath = path.join(uploadDir, safeName);
  try {
    await fs.promises.access(localPath);
    return localPath;
  } catch {
    // Download only after the local copy is confirmed absent.
  }
  if (!artifact?.downloadUrl || artifact.fileName !== safeName) {
    throw new Error("This publishing job has no authorized private media download.");
  }
  const downloadUrl = new URL(artifact.downloadUrl);
  if (downloadUrl.protocol !== "https:" || downloadUrl.origin !== pairing.supabaseUrl) {
    throw new Error("The private media download URL is invalid.");
  }
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`Private media download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("The publishing media file is empty.");
  if (artifact.sha256 && createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
    throw new Error("The publishing media integrity check failed.");
  }
  const temporary = `${localPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  await fs.promises.writeFile(temporary, bytes, { mode: 0o600 });
  await fs.promises.rename(temporary, localPath);
  return localPath;
}

async function updateCentralJobStatus(
  pairing: CentralCompanionPairing,
  jobId: string,
  state: string,
  message?: string,
  retry?: boolean,
  progress: Record<string, unknown> = {},
  result: Record<string, unknown> | null = null,
  error: Record<string, unknown> | null = null,
  finalAction = false,
) {
  return supabaseRpc<Record<string, unknown>>(pairing, "companion_update_job", {
    p_token: pairing.pairingToken,
    p_instance_id: publishingCompanionId(),
    p_job_id: jobId,
    p_status: state === "published" ? "success" : state,
    p_progress: progress,
    p_message: message || null,
    p_retry: retry === true,
    p_result: result,
    p_error: error,
    p_final_action: finalAction,
  });
}

export function centralDeliveryFailure(upload?: PlatformUpload) {
  const recordedFailure = upload?.failureReason?.trim();
  if (recordedFailure) return {
    message: recordedFailure,
    retry: upload?.publishActionState !== "submitted" && upload?.publishActionState !== "uncertain",
    state: upload?.publishActionState === "submitted" || upload?.publishActionState === "uncertain" ? "uncertain" : "failed",
  };
  if (!upload) return {
    message: "Companion could not find the local copy of this publishing job. It is safe to retry.",
    retry: true,
    state: "failed",
  };
  if (upload.status === "queued") return {
    message: upload.safetyReason || "Companion kept this post queued and did not submit it. It is safe to retry.",
    retry: true,
    state: "failed",
  };
  const finalActionUncertain = upload.publishActionState === "submitted" || upload.publishActionState === "uncertain";
  if (finalActionUncertain) return {
    message: "Companion stopped after the final publish action. Verify the platform before retrying to prevent a duplicate post.",
    retry: false,
    state: "uncertain",
  };
  return {
    message: `Companion stopped before ${upload.platform} confirmed the post. No final publish action was recorded, so it is safe to retry.`,
    retry: true,
    state: "failed",
  };
}

async function runCentralPublishingJob(pairing: CentralCompanionPairing, job: CentralPublishingJob) {
  let leaseHeartbeat: NodeJS.Timeout | null = null;
  let cancellationRequested = false;
  const { account: remoteAccount, upload } = job.payload;
  try {
    const account = await upsertSyncedPlatformAccount({
      ...remoteAccount,
      companionId: publishingCompanionId(),
      // Only a verified local record can assert that a browser session exists.
      // Central metadata must never create a credential-ready local account.
      credentialConfigured: false,
    });
    if (!account.credentialConfigured) {
      await updateCentralJobStatus(pairing, job.id, "reconnect_required", "The saved social media session needs reconnecting.", false);
      return;
    }
    if (upload.fileName) await downloadCentralPublishingMedia(pairing, upload.fileName, upload.artifact);
    await upsertSyncedUpload(upload);
    await updateCentralJobStatus(pairing, job.id, "opening_platform", "Opening the social platform.");
    await updateCentralJobStatus(pairing, job.id, "uploading", "Preparing content in the local browser session.");
    await updateCentralJobStatus(pairing, job.id, "publishing", "Publishing through the saved local session.");
    // Publishing media can take longer than a single job lease. Refresh the
    // lease while this Companion owns the browser so another process cannot
    // pick up the same post and submit it twice.
    leaseHeartbeat = setInterval(() => {
      void listUploads(undefined, remoteAccount.id, pairing.workspaceId)
        .then((items) => items.find((item) => item.id === upload.id))
        .then((current) => updateCentralJobStatus(
          pairing,
          job.id,
          "publishing",
          "Publishing through the saved local session.",
          false,
          {},
          null,
          null,
          current?.publishActionState === "submitted" || current?.publishActionState === "uncertain",
        ))
        .then(async (remote) => {
          if (!cancellationRequested && (remote.cancelRequested === true || remote.status === "cancel_requested")) {
            cancellationRequested = true;
            await cancelAutomation("Publishing cancellation was requested from the workspace.");
          }
        })
        .catch(() => undefined);
    }, 1_000);
    await runAutomation({ trigger: "companion", workspaceId: pairing.workspaceId, uploadIds: [upload.id] });
    const localUpload = (await listUploads(undefined, remoteAccount.id, pairing.workspaceId)).find((item) => item.id === upload.id);
    if (localUpload?.status === "posted") {
      await updateCentralJobStatus(pairing, job.id, "published", "Published successfully.", false, {}, null, null, true);
      return;
    }
    const failure = centralDeliveryFailure(localUpload);
    await updateCentralJobStatus(pairing, job.id, failure.state, failure.message, failure.retry, {}, null, null, failure.state === "uncertain");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The workspace Companion could not complete this job.";
    const reconnect = /login|session|credential|authenticat/i.test(message);
    const localUpload = (await listUploads(undefined, remoteAccount.id, pairing.workspaceId).catch(() => []))
      .find((item) => item.id === upload.id);
    const failure = centralDeliveryFailure(localUpload);
    if (cancellationRequested) {
      const finalAction = localUpload?.publishActionState === "submitted" || localUpload?.publishActionState === "uncertain";
      await updateCentralJobStatus(
        pairing,
        job.id,
        finalAction ? "uncertain" : "cancelled",
        finalAction
          ? "Publishing was cancelled after the final platform action. Verify the platform before retrying."
          : "Publishing was cancelled before the final platform action.",
        false,
        {},
        null,
        finalAction ? { code: "cancelled_after_final_action", message } : null,
        finalAction,
      ).catch(() => undefined);
      return;
    }
    await updateCentralJobStatus(
      pairing,
      job.id,
      reconnect ? "reconnect_required" : failure.state,
      reconnect ? message : failure.message || message,
      reconnect ? false : failure.retry,
      {},
      null,
      { code: reconnect ? "login_required" : "publish_failed", message },
      failure.state === "uncertain",
    ).catch(() => undefined);
  } finally {
    if (leaseHeartbeat) clearInterval(leaseHeartbeat);
  }
}

async function runCentralScrapingJob(
  pairing: CentralCompanionPairing,
  job: Exclude<CentralCompanionJob, CentralPublishingJob>,
) {
  const ownerKey = `supabase:${pairing.workspaceId}`;
  const instagram = job.type === "scrape.instagram";
  let localJobId = "";
  try {
    const created = instagram
      ? createInstagramCompanionJob(ownerKey, job.payload)
      : createFacebookCompanionJob(ownerKey, job.payload);
    localJobId = String(created?.job?.id || "");
    if (!localJobId) throw new Error("Companion could not create the local scraping job.");
    await updateCentralJobStatus(pairing, job.id, "running", `Starting ${instagram ? "Instagram" : "Facebook"} scraping.`, false, {
      stage: "starting",
      localJobId,
    });

    let lastRemoteUpdate = 0;
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      const current = instagram
        ? getInstagramCompanionJob(ownerKey, localJobId)
        : getFacebookCompanionJob(ownerKey, localJobId);
      if (!current?.job) throw new Error("The local scraping job was not found after it started.");
      if (current.job.status === "complete") {
        await updateCentralJobStatus(
          pairing,
          job.id,
          "success",
          current.message || `${instagram ? "Instagram" : "Facebook"} scraping completed.`,
          false,
          current.job.progress || { stage: "complete" },
          current as Record<string, unknown>,
        );
        return;
      }
      if (current.job.status === "failed" || current.job.status === "cancelled") {
        const cancelled = current.job.status === "cancelled";
        await updateCentralJobStatus(
          pairing,
          job.id,
          cancelled ? "cancelled" : "failed",
          current.job.error?.message || `Local ${instagram ? "Instagram" : "Facebook"} scraping failed.`,
          !cancelled && current.job.error?.retryable === true,
          current.job.progress || {},
          null,
          current.job.error || { code: cancelled ? "cancelled" : "scrape_failed" },
        );
        return;
      }
      if (Date.now() - lastRemoteUpdate >= 5_000) {
        const remote = await updateCentralJobStatus(
          pairing,
          job.id,
          "running",
          current.job.progress?.message || `Collecting ${instagram ? "Instagram" : "Facebook"} data.`,
          false,
          current.job.progress || {},
        );
        lastRemoteUpdate = Date.now();
        if (remote.cancelRequested === true || remote.status === "cancel_requested") {
          if (instagram) await cancelInstagramCompanionJob(ownerKey, localJobId);
          else await cancelFacebookCompanionJob(ownerKey, localJobId);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error("The scraping job exceeded the Companion execution limit.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Companion scraping failed.";
    if (localJobId) {
      if (instagram) await cancelInstagramCompanionJob(ownerKey, localJobId).catch(() => undefined);
      else await cancelFacebookCompanionJob(ownerKey, localJobId).catch(() => undefined);
    }
    await updateCentralJobStatus(pairing, job.id, "failed", message, true, {}, null, {
      code: /login|session|authenticat/i.test(message) ? "login_required" : "scrape_failed",
      message,
    }).catch(() => undefined);
  }
}

async function pollCentralWorkspaceCompanion() {
  if (centralPollInFlight) return;
  centralPollInFlight = true;
  try {
    const pairing = await readCentralPairing();
    if (!pairing) {
      centralConnectionState = { status: "unpaired", lastHeartbeatAt: null, lastError: null, companion: null };
      return;
    }
    centralConnectionState = { ...centralConnectionState, status: "connecting", lastError: null };
    await heartbeatCentralPairing(pairing);
    const jobs = await supabaseRpc<CentralCompanionJob[]>(pairing, "companion_claim_jobs", {
      p_token: pairing.pairingToken,
      p_instance_id: publishingCompanionId(),
      p_limit: 1,
    });
    for (const job of jobs || []) {
      if (job.type === "publish") await runCentralPublishingJob(pairing, job);
      else await runCentralScrapingJob(pairing, job);
    }
  } catch (error) {
    // A network outage is normal while the server is unavailable. The next
    // heartbeat retries automatically without exposing secrets in the UI.
    const message = error instanceof Error ? error.message : String(error);
    if (/pairing is no longer valid/i.test(message)) {
      await fs.promises.unlink(centralPairingFile).catch(() => undefined);
      centralConnectionState = { status: "unpaired", lastHeartbeatAt: null, lastError: message, companion: null };
      console.warn("Workspace Companion pairing was removed from the server. Pair this device again to resume publishing.");
    } else if (/Update Companion to/i.test(message)) {
      centralConnectionState = { ...centralConnectionState, status: "outdated", lastError: message };
    } else {
      centralConnectionState = { ...centralConnectionState, status: "offline", lastError: message };
      console.warn("Workspace Companion reconnect pending:", message);
    }
  } finally {
    centralPollInFlight = false;
  }
}

function startCentralWorkspaceCompanionPolling() {
  if (centralPollingTimer) return;
  void pollCentralWorkspaceCompanion();
  centralPollingTimer = setInterval(() => void pollCentralWorkspaceCompanion(), centralPollIntervalMs);
}

function stopCentralWorkspaceCompanionPolling() {
  if (!centralPollingTimer) return;
  clearInterval(centralPollingTimer);
  centralPollingTimer = null;
}

export async function wakeCentralWorkspaceCompanion() {
  await pollCentralWorkspaceCompanion();
}

export function companionRuntimeActivity() {
  const instagram = instagramCompanionQueueHealth();
  const facebook = facebookCompanionQueueHealth();
  return {
    publishing: isAutomationRunning(),
    // Queued scraping jobs are encrypted on disk and safely resume after a
    // restart. Only a browser task that is actively executing must delay a
    // watchdog restart or update installation.
    scraping: instagram.activeJobs > 0 || facebook.activeJobs > 0,
  };
}

export function stopPublishingBackgroundServices() {
  stopScheduler();
  stopCentralWorkspaceCompanionPolling();
}

app.use((req, res, next) => {
  if (req.headers["access-control-request-private-network"] === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  next();
});

function resolveFromRoot(candidate: string) {
  return path.isAbsolute(candidate) ? candidate : path.resolve(rootDir, candidate);
}

function normalizeScheduledAt(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Scheduled date and time must be a string.");

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Scheduled date and time is invalid.");
  if (timestamp <= Date.now()) throw new Error("Scheduled date and time must be in the future.");

  return new Date(timestamp).toISOString();
}

function localTemplateDateTime(dateValue: string | undefined, time: string) {
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function assertScheduleCanReceivePosts(schedule: PublishingSchedule) {
  if (schedule.status !== "active") throw new Error(`${schedule.name} is inactive. Choose an active schedule.`);
  if (schedule.frequency !== "onetime") return;
  const runAt = localTemplateDateTime(schedule.endDate, schedule.time);
  if (!runAt || runAt.getTime() <= Date.now()) {
    throw new Error(`${schedule.name} is a past one-time schedule. Create a future schedule or choose Queue now.`);
  }
}

function safeUploadFileName(originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  const safeBase = path.basename(originalName, extension)
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "local-post";
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}${extension}`;
}

type StoredUploadFile = {
  originalname: string;
  filename: string;
  mimetype: string;
  size: number;
};

function postFormatForFile(file: StoredUploadFile): PostFormat {
  if (file.mimetype.startsWith("image/")) return "image" as const;
  if (file.mimetype.startsWith("video/")) return "video" as const;
  if (file.mimetype === "text/plain") return "text" as const;
  throw new Error("Upload an image or video.");
}

type PublishingScheduleSafetyIssue = {
  accountId: string;
  platform: Platform;
  accountName: string;
  requestedAt: string;
  earliestAt: string;
  message: string;
};

async function assessDestinationPublishingSafety(
  user: UserProfile,
  postFormat: PostFormat,
  destinationsInput: unknown,
  excludeUploadId?: string,
) {
  const destinations = unifiedPostDestinationsSchema.parse(destinationsInput);
  const [accounts, schedules, uploads] = await Promise.all([
    listPlatformAccounts(undefined, user.workspaceId),
    listPublishingSchedules(user.workspaceId),
    listUploads(undefined, undefined, user.workspaceId),
  ]);
  const accountById = new Map(accounts.map(account => [account.id, account]));
  const scheduleById = new Map(schedules.map(schedule => [schedule.id, schedule]));
  const safetyUploads = uploads.map(upload => {
    if (!upload.scheduleId || upload.scheduledAt) return upload;
    const schedule = scheduleById.get(upload.scheduleId);
    const occurrence = schedule ? nextPublishingScheduleOccurrence(schedule) : null;
    return occurrence ? { ...upload, scheduledAt: occurrence.toISOString() } : upload;
  });
  const issues: PublishingScheduleSafetyIssue[] = [];
  const assessments = destinations.map(destination => {
    const account = accountById.get(destination.accountId);
    if (!account) throw new Error("One of the selected publishing accounts no longer exists.");
    let requestedAt = Date.now();
    if (destination.scheduledAt) {
      requestedAt = Date.parse(normalizeScheduledAt(destination.scheduledAt)!);
    } else if (destination.scheduleId) {
      const schedule = scheduleById.get(destination.scheduleId);
      if (!schedule) throw new Error(`Schedule #${destination.scheduleId} was not found.`);
      assertScheduleCanReceivePosts(schedule);
      const occurrence = nextPublishingScheduleOccurrence(schedule);
      if (!occurrence) throw new Error(`${schedule.name} has no future publishing time.`);
      requestedAt = occurrence.getTime();
    }

    const assessment = assessScheduledPublishingSafety(
      { id: excludeUploadId ?? `preview_${account.id}`, platform: account.platform, postFormat },
      safetyUploads.filter(upload => upload.accountId === account.id && upload.id !== excludeUploadId),
      requestedAt,
      account.safetyMode ?? "standard",
    );
    if (!assessment.allowed) {
      const earliest = new Date(assessment.earliestAt);
      issues.push({
        accountId: account.id,
        platform: account.platform,
        accountName: account.displayName,
        requestedAt: assessment.requestedAt,
        earliestAt: assessment.earliestAt,
        message: `${account.displayName} will wait until ${earliest.toLocaleString()}. ${assessment.reason ?? "A publishing safety limit is active."} Other selected accounts can continue.`,
      });
    }
    return { accountId: account.id, platform: account.platform, ...assessment };
  });
  return { allowed: true, issues, assessments };
}

async function applyPublishingSafetyDeferrals(
  uploads: PlatformUpload[],
  issues: PublishingScheduleSafetyIssue[],
) {
  const issueByAccountId = new Map(issues.map(issue => [issue.accountId, issue]));
  const updated: PlatformUpload[] = [];
  for (const upload of uploads) {
    const issue = issueByAccountId.get(upload.accountId);
    if (!issue) {
      updated.push(upload);
      continue;
    }
    const deferred = await deferUploadForSafety(upload.id, issue.earliestAt, issue.message);
    updated.push(deferred ?? upload);
  }
  return updated;
}

function assertPlatformPostCompatible(platform: Platform, file: StoredUploadFile, title: string, description: string) {
  const rules = platformPostRules[platform];
  const postFormat = postFormatForFile(file);
  if (!rules.formats.includes(postFormat)) {
    throw new Error(`${platformLabels[platform]} does not support ${postFormat} posts in this publishing flow.`);
  }
  const titleRequired = rules.titleRequired || rules.titleRequiredFor?.includes(postFormat);
  if (titleRequired && !title) throw new Error(`${platformLabels[platform]} requires a title.`);
  if (rules.titleLimit && title.length > rules.titleLimit) {
    throw new Error(`${platformLabels[platform]} titles must be ${rules.titleLimit} characters or fewer.`);
  }
  if (description.length > rules.descriptionLimit) {
    throw new Error(`${platformLabels[platform]} descriptions must be ${rules.descriptionLimit.toLocaleString()} characters or fewer.`);
  }
}

type CentralAccessLevel = "view" | "operate" | "configure";
type RequestWithUser = express.Request & {
  user?: UserProfile;
  centralAccessLevel?: CentralAccessLevel;
  centralGrants?: Record<string, unknown>;
  centralCapabilities?: string[];
};
type RequestWithInstagramOwner = express.Request & { instagramOwnerKey?: string; trialWorkspaceId?: string };
type RequestWithFacebookOwner = express.Request & { facebookOwnerKey?: string; trialWorkspaceId?: string };

const companionTrialScrapeLimiter = new RollingTrialUsageLimiter();
const TRIAL_SCRAPES_PER_PROFILE_PER_HOUR = 2;

function companionTrialScrapeLimitKey(
  req: RequestWithInstagramOwner | RequestWithFacebookOwner,
  platform: "instagram" | "facebook",
) {
  if (!req.trialWorkspaceId) return null;
  return `${req.trialWorkspaceId}:${platform}`;
}

function companionTrialScrapeLimit(key: string) {
  return companionTrialScrapeLimiter.check(key, TRIAL_SCRAPES_PER_PROFILE_PER_HOUR, 60 * 60_000);
}

function recordCompanionTrialScrape(key: string) {
  companionTrialScrapeLimiter.consume(key, TRIAL_SCRAPES_PER_PROFILE_PER_HOUR, 60 * 60_000);
}

const tokenPayloadSchema = z.object({
  sub: z.string(),
  exp: z.number().int().positive()
});

const instagramScrapingTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  workspaceId: z.string().min(1),
  scope: z.literal("instagram:scraping"),
  exp: z.number().int().positive(),
});
const facebookScrapingTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  workspaceId: z.string().min(1),
  scope: z.literal("facebook:scraping"),
  exp: z.number().int().positive(),
});

const scheduleOnlyUpdateSchema = z.object({
  scheduledAt: z.string().nullable().optional(),
  scheduleId: scheduleIdSchema.nullable().optional()
});

const automationRunRequestSchema = z.object({
  uploadIds: z.array(z.string().trim().min(1)).max(100).optional()
});
const manualLoginRequestSchema = z.object({
  surface: z.enum(["engine", "embedded", "external"]).default("engine"),
});

const publishingSafetyRequestSchema = z.object({
  postFormat: postFormatSchema,
  destinations: unifiedPostDestinationsSchema,
});

const platformPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const stagedUploadCreateSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  size: z.number().int().positive()
});

const stagedUploadIdSchema = z.string().regex(/^stage_[A-Za-z0-9_-]{12,}$/, "The staged upload ID is invalid.");

const stagedUnifiedPostSchema = z.object({
  stagedUploadId: stagedUploadIdSchema,
  title: z.string().max(500).optional().default(""),
  description: z.string().trim().min(1, "Enter a post description."),
  destinations: unifiedPostDestinationsSchema,
  rightsConfirmed: z.boolean().optional().default(false),
  confirmWarnings: z.boolean().optional().default(false)
});

const textUnifiedPostSchema = z.object({
  description: z.string().trim().min(1, "Write your post text."),
  destinations: unifiedPostDestinationsSchema,
  confirmWarnings: z.boolean().optional().default(false)
});

const stagedSubmissionSchema = z.object({
  stagedUploadId: stagedUploadIdSchema,
  title: z.string().trim().max(500).optional().default(""),
  description: z.string().trim().min(1, "Enter a post description."),
  selectedAccountIds: z.array(z.string().trim().min(1)).min(1, "Choose at least one publishing account").max(100),
  rightsConfirmed: z.boolean().optional().default(false),
  confirmWarnings: z.boolean().optional().default(false)
});

const textSubmissionSchema = z.object({
  description: z.string().trim().min(1, "Write your post text."),
  selectedAccountIds: z.array(z.string().trim().min(1)).min(1, "Choose at least one publishing account").max(100),
  confirmWarnings: z.boolean().optional().default(false)
});

const scheduleSubmissionSchema = z.object({
  destinations: unifiedPostDestinationsSchema,
  confirmWarnings: z.boolean().optional().default(false)
}).superRefine((value, context) => {
  value.destinations.forEach((destination, index) => {
    if (!destination.scheduledAt && !destination.scheduleId) {
      context.addIssue({
        code: "custom",
        path: ["destinations", index],
        message: "Choose an exact time or schedule template for every destination."
      });
    }
  });
});

type StagedUploadRecord = {
  id: string;
  userId: string;
  workspaceId: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

function authSecret() {
  const configured = process.env.PUBLISH_QUEUE_AUTH_TOKEN_SECRET?.trim()
    || process.env.AUTH_TOKEN_SECRET?.trim()
    || process.env.LOCAL_ACCOUNT_SECRET_KEY?.trim();
  if (configured) return configured;
  if (process.env.SERVERLESS === "true" || process.env.NETLIFY === "true") {
    return "local-development-auth-token-secret";
  }

  const configuredStorePath = resolveFromRoot(process.env.PUBLISH_QUEUE_DATA_PATH ?? "./data/store.json");
  const secretPath = resolveFromRoot(
    process.env.PUBLISH_QUEUE_LOCAL_AUTH_SECRET_PATH ?? path.join(path.dirname(configuredStorePath), ".auth-token-secret"),
  );
  try {
    const saved = fs.readFileSync(secretPath, "utf8").trim();
    if (saved.length >= 32) return saved;
  } catch {
    // Create a local-only secret below.
  }

  const generated = randomBytes(48).toString("base64url");
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, generated, { encoding: "utf8", mode: 0o600 });
  return generated;
}

function encodeBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signPart(value: string) {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function signAuthToken(user: UserProfile) {
  const lifetimeSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 60 * 60 * 12);
  const payload = encodeBase64Url(JSON.stringify({
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds
  }));
  return `${payload}.${signPart(payload)}`;
}

async function userFromAuthToken(token: string) {
  const rawPayload = verifiedTokenPayload(token);
  if (!rawPayload) return null;
  const payload = tokenPayloadSchema.parse(rawPayload);
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

  const user = await getUserProfile(payload.sub);
  return user?.isActive ? user : null;
}

function verifiedTokenPayload(token: string) {
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return null;

  const expectedSignature = Buffer.from(signPart(payloadPart), "base64url");
  const providedSignature = Buffer.from(signaturePart, "base64url");
  if (expectedSignature.length !== providedSignature.length || !timingSafeEqual(expectedSignature, providedSignature)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

async function authenticateApi(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const request = req as RequestWithUser;
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) {
      res.status(401).json({ message: "Sign in to continue." });
      return;
    }

    const centralIdentity = verifyPublishingWorkspaceIdentity(token);
    if (centralIdentity) {
      const centralAccessLevel = publishingAccessLevel(centralIdentity.grants);
      if (!centralAccessLevel) {
        res.status(403).json({ message: "Your AgenticThat role cannot access Publishing." });
        return;
      }
      const requiredLevel = requiredPublishingLevel(req);
      if (publishingLevelRank(centralAccessLevel) < publishingLevelRank(requiredLevel)) {
        res.status(403).json({ message: `Your AgenticThat role requires ${requiredLevel} Publishing access for this action.` });
        return;
      }
      const centralCapabilities = Array.isArray(centralIdentity.capabilities)
        ? centralIdentity.capabilities.map(String)
        : [];
      const requiredCapability = requiredPublishingCapability(req);
      if (requiredCapability && !centralCapabilities.includes(requiredCapability)) {
        res.status(403).json({ message: `Your workspace role does not include ${requiredCapability}.` });
        return;
      }
      request.user = await upsertCentralWorkspaceActor(platformIdentity(token), centralAccessLevel, centralCapabilities);
      request.centralAccessLevel = centralAccessLevel;
      request.centralGrants = centralIdentity.grants;
      request.centralCapabilities = centralCapabilities;
      next();
      return;
    }

    const user = legacyHumanAuthAllowed() ? await userFromAuthToken(token) : null;
    if (!user) {
      res.status(401).json({ message: "Session expired. Sign in again." });
      return;
    }

    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function legacyHumanAuthAllowed() {
  return process.env.NODE_ENV === "test" || process.env.RBAC_ENFORCEMENT_MODE === "shadow";
}

function publishingLevelRank(level: CentralAccessLevel) {
  return level === "configure" ? 3 : level === "operate" ? 2 : 1;
}

function publishingAccessLevel(grants: Record<string, unknown>): CentralAccessLevel | null {
  let result: CentralAccessLevel | null = null;
  for (const [resource, rawLevel] of Object.entries(grants || {})) {
    if (!resource.startsWith("publishing.")) continue;
    const level = rawLevel === "configure" || rawLevel === "operate" || rawLevel === "view" ? rawLevel : null;
    if (level && (!result || publishingLevelRank(level) > publishingLevelRank(result))) result = level;
  }
  return result;
}

function requiredPublishingLevel(req: express.Request): CentralAccessLevel {
  if (req.method === "GET" || req.method === "HEAD") return "view";
  const path = req.originalUrl.split("?")[0];
  if (
    path.startsWith("/api/users") ||
    /^\/api\/(?:platforms\/[^/]+\/accounts|accounts(?:\/|$))/.test(path)
  ) return "configure";
  return "operate";
}

function requiredPublishingCapability(req: express.Request) {
  const requestPath = req.originalUrl.split("?")[0];
  if (requestPath.startsWith("/api/users")) return "workspace.team.manage";
  if (requestPath === "/api/automation/consent") return "publishing.accounts.configure";
  if (requestPath.startsWith("/api/automation")) return "publishing.execute";
  if (requestPath === "/api/publishing-safety/assess") return "publishing.execute";
  if (req.method === "GET" || req.method === "HEAD") return "publishing.view";
  if (/^\/api\/(?:platforms\/[^/]+\/accounts|accounts(?:\/|$))/.test(requestPath)) return "publishing.accounts.configure";
  if (requestPath.startsWith("/api/schedules") || /^\/api\/submissions\/[^/]+\/schedule$/.test(requestPath)) return "publishing.schedule.manage";
  if (requestPath.startsWith("/api/posts/unified")) return "publishing.execute";
  if (requestPath.startsWith("/api/submissions") || requestPath.startsWith("/api/staged-uploads")) return "publishing.content.create";
  if (/^\/api\/uploads\/[^/]+\/status$/.test(requestPath) || (req.method === "DELETE" && requestPath.startsWith("/api/uploads/"))) return "publishing.execute";
  if (req.method === "PATCH" && /^\/api\/uploads\/[^/]+$/.test(requestPath)) {
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const fields = Object.keys(body);
    return fields.length > 0 && fields.every(field => field === "scheduledAt" || field === "scheduleId")
      ? "publishing.schedule.manage"
      : "publishing.content.edit";
  }
  return "publishing.execute";
}

function assertCentralCapability(req: RequestWithUser, capability: string) {
  if (req.centralCapabilities === undefined) return;
  if (!req.centralCapabilities.includes(capability)) {
    throw new PublishingAccessError(`Your workspace role does not include ${capability}.`);
  }
}

class PublishingAccessError extends Error {}

function centralPlatformAccess(req: RequestWithUser, platform: Platform) {
  if (!req.centralGrants) return req.centralAccessLevel || null;
  const level = req.centralGrants[`publishing.${platform}`];
  return level === "view" || level === "operate" || level === "configure" ? level : null;
}

function assertCentralPlatformAccess(req: RequestWithUser, platform: Platform, required: CentralAccessLevel) {
  if (!req.centralGrants) return;
  const level = centralPlatformAccess(req, platform);
  if (!level || publishingLevelRank(level) < publishingLevelRank(required)) {
    throw new PublishingAccessError(`Your AgenticThat role requires ${required} access to publishing.${platform}.`);
  }
}

function filterCentralPlatforms<T extends { platform: Platform }>(req: RequestWithUser, rows: T[]) {
  return req.centralGrants ? rows.filter(row => Boolean(centralPlatformAccess(req, row.platform))) : rows;
}

function filterVisibleAccounts(req: RequestWithUser, rows: PlatformAccount[]) {
  const visible = filterCentralPlatforms(req, rows);
  return req.centralCapabilities !== undefined && req.user?.role === "post_uploader"
    ? visible.filter(account => account.enabled)
    : visible;
}

function requireRoles(...roles: UserRole[]): express.RequestHandler {
  return (req, res, next) => {
    const request = req as RequestWithUser;
    const user = request.user;
    if (!user) {
      res.status(401).json({ message: "Sign in to continue." });
      return;
    }
    if (request.centralCapabilities === undefined && !roles.includes(user.role)) {
      res.status(403).json({ message: "Your role cannot perform this action." });
      return;
    }
    next();
  };
}

function currentUser(req: RequestWithUser) {
  if (!req.user) throw new Error("Sign in to continue.");
  return req.user;
}

function pathParam(value: string | string[] | undefined, name: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0];
  throw new Error(`${name} path parameter is required.`);
}

function canEditContent(role: UserRole) {
  return role === "operations_manager" || role === "post_uploader";
}

function canEditSchedule(role: UserRole) {
  return role === "operations_manager" || role === "scheduler";
}

async function findUploadOrThrow(uploadId: string, workspaceId?: string): Promise<PlatformUpload> {
  const uploads = await listUploads(undefined, undefined, workspaceId);
  const upload = uploads.find(item => item.id === uploadId);
  if (!upload) throw new Error("Upload not found");
  return upload;
}

function stagedMetadataPath(stagedUploadId: string) {
  return path.join(stagedUploadDir, `${stagedUploadId}.json`);
}

function stagedContentPath(stagedUploadId: string) {
  return path.join(stagedUploadDir, `${stagedUploadId}.part`);
}

async function readStagedUpload(stagedUploadId: string) {
  const parsed = JSON.parse(await fs.promises.readFile(stagedMetadataPath(stagedUploadId), "utf8")) as StagedUploadRecord;
  if (parsed.id !== stagedUploadId) throw new Error("The staged upload metadata is invalid.");
  return parsed;
}

async function removeStagedUpload(stagedUploadId: string) {
  await Promise.all([
    fs.promises.unlink(stagedMetadataPath(stagedUploadId)).catch(() => undefined),
    fs.promises.unlink(stagedContentPath(stagedUploadId)).catch(() => undefined),
  ]);
}

async function cleanExpiredStagedUploads() {
  const expiry = Date.now() - 24 * 60 * 60 * 1000;
  const entries = await fs.promises.readdir(stagedUploadDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter(entry => entry.isFile()).map(async (entry) => {
    const entryPath = path.join(stagedUploadDir, entry.name);
    const stat = await fs.promises.stat(entryPath).catch(() => null);
    if (stat && stat.mtimeMs < expiry) await fs.promises.unlink(entryPath).catch(() => undefined);
  }));
}

async function assertStagedMediaSignature(record: StagedUploadRecord, contentPath: string) {
  const extension = path.extname(record.originalName).toLowerCase();
  const handle = await fs.promises.open(contentPath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    const ascii = bytes.toString("ascii");
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isGif = ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a");
    const isWebp = ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
    const isMp4Family = ascii.slice(4, 8) === "ftyp";
    const isAvi = ascii.startsWith("RIFF") && ascii.slice(8, 11) === "AVI";
    const isEbml = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    const signatureValid = extension === ".jpg" || extension === ".jpeg" ? isJpeg
      : extension === ".png" ? isPng
        : extension === ".gif" ? isGif
          : extension === ".webp" ? isWebp
            : extension === ".avi" ? isAvi
              : extension === ".webm" || extension === ".mkv" ? isEbml
                : isMp4Family;
    if (!signatureValid) throw new Error("The uploaded file content does not match its image or video extension.");
  } finally {
    await handle.close();
  }
}

async function createUnifiedPosts(
  file: StoredUploadFile,
  user: UserProfile,
  titleInput: string,
  descriptionInput: string,
  destinationsInput: unknown,
  preflightOptions: { rightsConfirmed: boolean; confirmWarnings: boolean },
  request?: RequestWithUser,
) {
  const createdUploads: PlatformUpload[] = [];
  const title = titleInput.trim();
  const description = descriptionInput.trim();
  if (!description) throw new Error("Enter a post description.");
  const postFormat = postFormatForFile(file);

  try {
    const destinations = unifiedPostDestinationsSchema.parse(destinationsInput);
    if (destinations.some(destination => destination.scheduledAt || destination.scheduleId)) {
      throw new Error("Scheduling is temporarily unavailable. Publish or queue the post now instead.");
    }
    const uniqueAccountIds = new Set(destinations.map(destination => destination.accountId));
    if (uniqueAccountIds.size !== destinations.length) throw new Error("Each publishing account can be selected only once.");
    if (user.role === "post_uploader" && destinations.some(destination => destination.scheduledAt || destination.scheduleId)) {
      throw new Error("Post uploaders can create queued posts but cannot assign schedules.");
    }

    const [allAccounts, allSchedules] = await Promise.all([
      listPlatformAccounts(undefined, user.workspaceId),
      listPublishingSchedules(user.workspaceId),
    ]);
    const accountById = new Map(allAccounts.map(account => [account.id, account]));
    const scheduleById = new Map(allSchedules.map(schedule => [schedule.id, schedule]));
    const destinationAccounts = destinations.map(destination => {
      const account = accountById.get(destination.accountId);
      if (!account) throw new Error("One of the selected publishing accounts no longer exists.");
      if (request) assertCentralPlatformAccess(request, account.platform, "operate");
      return { destination, account };
    });

    const youtubeVideoSelected = postFormat === "video" && destinationAccounts.some(({ account }) => account.platform === "youtube");
    if (youtubeVideoSelected && !title) throw new Error("YouTube requires a title.");

    for (const { destination, account } of destinationAccounts) {
      const platformDescription = destination.description?.trim() || description;
      if (!account.enabled) throw new Error(`${account.displayName} is disabled and cannot receive new posts.`);
      assertPlatformPostCompatible(account.platform, file, title, platformDescription);
      if (destination.scheduleId) {
        const schedule = scheduleById.get(destination.scheduleId);
        if (!schedule) throw new Error(`Schedule #${destination.scheduleId} was not found.`);
        assertScheduleCanReceivePosts(schedule);
      }
    }

    const safety = await assessDestinationPublishingSafety(user, postFormat, destinations);

    const preflightIssues = evaluateContentPreflight({
      postFormat,
      title,
      description,
      originalName: file.originalname,
      size: file.size,
      rightsConfirmed: preflightOptions.rightsConfirmed,
      destinations: destinationAccounts.map(({ destination, account }) => ({
        accountId: account.id,
        platform: account.platform,
        description: destination.description?.trim() || description,
        scheduledAt: destination.scheduledAt,
        scheduleId: destination.scheduleId,
      })),
    }, await listUploads(undefined, undefined, user.workspaceId));
    assertContentPreflight(preflightIssues, preflightOptions.confirmWarnings);

    for (const { destination, account } of destinationAccounts) {
      const scheduledAt = destination.scheduledAt ? normalizeScheduledAt(destination.scheduledAt) : undefined;
      createdUploads.push(await createUpload(destination.accountId, {
        originalName: file.originalname,
        fileName: file.filename,
        mimeType: file.mimetype,
        postFormat,
        size: file.size,
        url: postFormat === "text" ? "" : `/uploads/${file.filename}`,
        title: account.platform === "youtube" && postFormat === "video" ? title : undefined,
        caption: destination.description?.trim() || description,
        scheduledAt,
        scheduleId: destination.scheduleId,
      }, user.id, user.workspaceId));
    }

    await logActivity(user.id, "post.unified_created", "post_group", createdUploads[0]?.id, `${title || file.originalname} was prepared for ${createdUploads.length} publishing ${createdUploads.length === 1 ? "destination" : "destinations"}.`, {
      title,
      uploadIds: createdUploads.map(upload => upload.id),
      accountIds: destinations.map(destination => destination.accountId),
      platforms: [...new Set(createdUploads.map(upload => upload.platform))],
      confirmedPreflightWarnings: preflightIssues.filter(issue => issue.severity === "warning").map(issue => issue.code),
    });
    return await applyPublishingSafetyDeferrals(createdUploads, safety.issues);
  } catch (error) {
    await Promise.all(createdUploads.map(upload => deleteUpload(upload.id, user.workspaceId).catch(() => undefined)));
    throw error;
  }
}

async function scheduleContentSubmission(
  submissionId: string,
  user: UserProfile,
  destinationsInput: unknown,
  confirmWarnings: boolean,
) {
  const createdUploads: PlatformUpload[] = [];
  const submission = await claimContentSubmission(submissionId, user.id, user.workspaceId);
  if (!submission) throw new Error("Content submission not found.");

  const file: StoredUploadFile = {
    originalname: submission.originalName,
    filename: submission.fileName,
    mimetype: submission.mimeType,
    size: submission.size,
  };
  const title = submission.title?.trim() || "";
  try {
    const destinations = scheduleSubmissionSchema.parse({ destinations: destinationsInput }).destinations;
    const uniqueAccountIds = new Set(destinations.map(destination => destination.accountId));
    if (uniqueAccountIds.size !== destinations.length) throw new Error("Each publishing account can be selected only once.");
    const selectedAccountIds = new Set(submission.selectedAccountIds);
    if (selectedAccountIds.size > 0 && (uniqueAccountIds.size !== selectedAccountIds.size || [...uniqueAccountIds].some(accountId => !selectedAccountIds.has(accountId)))) {
      throw new Error("The Scheduler must use exactly the publishing accounts selected by the uploader.");
    }
    const [allAccounts, allSchedules] = await Promise.all([
      listPlatformAccounts(undefined, user.workspaceId),
      listPublishingSchedules(user.workspaceId),
    ]);
    const accountById = new Map(allAccounts.map(account => [account.id, account]));
    const scheduleById = new Map(allSchedules.map(schedule => [schedule.id, schedule]));
    const destinationAccounts = destinations.map(destination => {
      const account = accountById.get(destination.accountId);
      if (!account) throw new Error("One of the selected publishing accounts no longer exists.");
      return { destination, account };
    });

    for (const { destination, account } of destinationAccounts) {
      if (!account.enabled) throw new Error(`${account.displayName} is disabled and cannot receive new posts.`);
      assertPlatformPostCompatible(account.platform, file, title, submission.description);
      if (destination.scheduleId) {
        const schedule = scheduleById.get(destination.scheduleId);
        if (!schedule) throw new Error(`Schedule #${destination.scheduleId} was not found.`);
        assertScheduleCanReceivePosts(schedule);
      }
    }

    const safety = await assessDestinationPublishingSafety(user, submission.postFormat, destinations);

    const preflightIssues = evaluateContentPreflight({
      postFormat: submission.postFormat,
      title,
      description: submission.description,
      originalName: submission.originalName,
      size: submission.size,
      rightsConfirmed: submission.rightsConfirmed,
      destinations: destinationAccounts.map(({ destination, account }) => ({
        accountId: account.id,
        platform: account.platform,
        description: submission.description,
        scheduledAt: destination.scheduledAt,
        scheduleId: destination.scheduleId,
      })),
    }, await listUploads(undefined, undefined, user.workspaceId));
    assertContentPreflight(preflightIssues, confirmWarnings);

    for (const { destination, account } of destinationAccounts) {
      const scheduledAt = destination.scheduledAt ? normalizeScheduledAt(destination.scheduledAt) : undefined;
      createdUploads.push(await createUpload(destination.accountId, {
        originalName: submission.originalName,
        fileName: submission.fileName,
        mimeType: submission.mimeType,
        postFormat: submission.postFormat,
        size: submission.size,
        url: submission.url,
        title: account.platform === "youtube" && submission.postFormat === "video" ? title : undefined,
        caption: submission.description,
        scheduledAt,
        scheduleId: destination.scheduleId,
      }, user.id, user.workspaceId, {
        createdByUserId: submission.createdByUserId,
        scheduledByUserId: user.id,
        sourceSubmissionId: submission.id,
      }));
    }

    const safelyQueuedUploads = await applyPublishingSafetyDeferrals(createdUploads, safety.issues);
    const completed = await completeContentSubmission(
      submission.id,
      safelyQueuedUploads.map(upload => upload.id),
      user.id,
      user.workspaceId,
    );
    if (!completed) throw new Error("Content submission not found.");
    return { submission: completed, uploads: safelyQueuedUploads };
  } catch (error) {
    await Promise.all(createdUploads.map(upload => deleteUpload(upload.id, user.workspaceId).catch(() => undefined)));
    await releaseContentSubmissionClaim(submission.id, user.id, user.workspaceId).catch(() => undefined);
    throw error;
  }
}

async function validateSubmissionAccounts(
  req: RequestWithUser,
  user: UserProfile,
  file: StoredUploadFile,
  title: string,
  description: string,
  selectedAccountIds: string[],
) {
  assertCentralCapability(req, "publishing.destinations.select");
  const uniqueIds = [...new Set(selectedAccountIds)];
  if (uniqueIds.length !== selectedAccountIds.length) throw new Error("Each publishing account can be selected only once.");
  const accounts = await listPlatformAccounts(undefined, user.workspaceId);
  const accountById = new Map(accounts.map(account => [account.id, account]));
  for (const accountId of uniqueIds) {
    const account = accountById.get(accountId);
    if (!account) throw new Error("One of the selected publishing accounts is unavailable in this workspace.");
    if (!account.enabled) throw new Error(`${account.displayName} is disabled and cannot receive new posts.`);
    assertCentralPlatformAccess(req, account.platform, "operate");
    assertPlatformPostCompatible(account.platform, file, title, description);
  }
  return uniqueIds;
}

app.use(
  cors({
    origin(requestOrigin, callback) {
      if (!requestOrigin) {
        callback(null, true);
        return;
      }

      let loopbackOrigin = false;
      try {
        const hostname = new URL(requestOrigin).hostname.toLowerCase();
        loopbackOrigin = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
      } catch {
        loopbackOrigin = false;
      }

      let trustedAgenticThatOrigin = false;
      try {
        const origin = new URL(requestOrigin);
        // The local service still verifies every API call with a short-lived
        // AgenticThat workspace token. Allowing HTTPS customer domains here
        // avoids a manual CORS/tunnel setup for Netlify custom domains.
        trustedAgenticThatOrigin = origin.protocol === "https:";
      } catch {
        trustedAgenticThatOrigin = false;
      }

      callback(null, loopbackOrigin || trustedAgenticThatOrigin || configuredWebOrigins.has(requestOrigin));
    }
  })
);
app.use(express.json({ limit: "2mb" }));
if (fs.existsSync(runtimeDesktopAssets)) {
  app.use("/desktop", express.static(runtimeDesktopAssets));
}

// --- HEALTH ---
app.get("/api/health", async (_req, res) => {
  try {
    const storage = await localStorageHealth();
    const serverless = process.env.SERVERLESS === "true" || process.env.NETLIFY === "true";
    const browser = publishingBrowserRuntimeHealth();
    const centralPairing = serverless ? null : await readCentralPairing();
    const localAccounts = serverless ? [] : await listPlatformAccounts();
    res.json({
      ok: true,
      service: "agenticthat-publish-queue-runner",
      storage: storage.storage,
      storageHealth: storage,
      automationReady: !serverless && browser.automationAvailable,
      automationRunning: isAutomationRunning(),
      chromeInstalled: browser.chromeInstalled,
      embeddedBrowser: browser.embeddedBrowser,
      engines: browser.engines,
      companionInstanceId: publishingCompanionId(),
      companionVersion: process.env.AGENTICTHAT_COMPANION_VERSION?.trim() || null,
      paired: Boolean(centralPairing),
      securePairingStorage: Boolean(centralPairing && pairingEncryptionKey()),
      controlPlane: centralConnectionState,
      accountHealth: {
        total: localAccounts.length,
        ready: localAccounts.filter(account => account.enabled && account.credentialConfigured).length,
        loginRequired: localAccounts.filter(account => account.enabled && !account.credentialConfigured).length,
      },
      extensionBridge: true,
      capabilities: {
        publishing: true,
        instagramScraping: instagramCompanionQueueHealth(),
        facebookScraping: facebookCompanionQueueHealth(),
        resourceScheduler: companionResourceSchedulerState(),
      },
      platforms,
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: "agenticthat-publish-queue-runner",
      storage: "unavailable",
      message: error instanceof Error ? error.message : "Local storage unavailable"
    });
  }
});

app.post("/api/companion/pair", async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    const identity = verifyPublishingWorkspaceIdentity(token);
    if (!identity || !Array.isArray(identity.capabilities) || !identity.capabilities.includes("publishing.accounts.configure")) {
      res.status(403).json({ message: "A Publishing Manager must pair the workspace Companion." });
      return;
    }
    const body = z.object({
      supabaseUrl: z.string().min(1),
      supabaseApiKey: z.string().min(20).optional(),
      supabaseAnonKey: z.string().min(20).optional(),
      pairingCode: z.string().min(32),
    }).refine(value => Boolean(value.supabaseApiKey || value.supabaseAnonKey), {
      message: "A Supabase publishable API key is required.",
    }).parse(req.body ?? {});
    const supabaseUrl = supabaseApiOrigin(body.supabaseUrl);
    const supabaseApiKey = body.supabaseApiKey || body.supabaseAnonKey || "";
    const redeemed = await supabaseRpc<{
      token?: string;
      companion?: { id?: string; workspaceId?: string; status?: string };
    }>({ supabaseUrl, supabaseApiKey }, "companion_redeem_pairing", {
      p_pairing_code: body.pairingCode,
      p_instance_id: publishingCompanionId(),
      p_version: process.env.AGENTICTHAT_COMPANION_VERSION?.trim() || null,
      p_platform: process.platform,
      p_architecture: process.arch,
      p_secure_storage: Boolean(pairingEncryptionKey()),
    });
    if (!redeemed.token || !redeemed.companion?.id || !redeemed.companion?.workspaceId) {
      throw new Error("Supabase rejected the pairing request.");
    }
    if (redeemed.companion.workspaceId !== identity.workspaceId) {
      res.status(403).json({ message: "This Companion can only be paired to its own workspace." });
      return;
    }
    await writeCentralPairing({
      supabaseUrl,
      supabaseApiKey,
      pairingToken: redeemed.token,
      companionId: redeemed.companion.id,
      workspaceId: redeemed.companion.workspaceId,
      savedAt: new Date().toISOString(),
    });
    centralConnectionState = { status: "connecting", lastHeartbeatAt: null, lastError: null, companion: redeemed.companion };
    await pollCentralWorkspaceCompanion();
    startCentralWorkspaceCompanionPolling();
    res.status(201).json({
      paired: true,
      workspaceId: redeemed.companion.workspaceId,
      companionInstanceId: publishingCompanionId(),
      companion: centralConnectionState.companion || redeemed.companion,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    if (!legacyHumanAuthAllowed()) {
      res.status(410).json({ message: "Use your AgenticThat login." });
      return;
    }
    const payload = loginInputSchema.parse(req.body);
    const user = await loginUser(payload.username, payload.password);
    if (!user) {
      res.status(401).json({ message: "Invalid username or password." });
      return;
    }

    res.json({ user, token: signAuthToken(user) });
  } catch (error) {
    next(error);
  }
});

function platformIdentity(token: string) {
  const identity = verifyPublishingWorkspaceIdentity(token);
  if (!identity) throw new Error("Your AgenticThat workspace session is invalid or expired.");
  return {
    platformUserId: identity.sub,
    workspaceId: identity.workspaceId,
    fullName: identity.name,
    email: identity.email,
    grants: identity.grants,
  };
}

function scrapingIdentity(
  token: string,
  resource: "scraping.instagram" | "scraping.facebook",
  requiredCapability: "scraping.view" | "scraping.run" = "scraping.run",
) {
  const identity = verifyServiceAccessToken(token, "scraping");
  const level = identity?.grants?.[resource];
  if (!identity || !level || !["view", "operate", "configure"].includes(level)) return null;
  if (!Array.isArray(identity.capabilities) || !identity.capabilities.includes(requiredCapability)) return null;
  return identity;
}

function signInstagramScrapingToken(identity: ReturnType<typeof platformIdentity>) {
  const lifetimeSeconds = Math.max(300, Math.min(4 * 60 * 60, Number(process.env.INSTAGRAM_COMPANION_TOKEN_TTL_SECONDS) || 2 * 60 * 60));
  const payload = encodeBase64Url(JSON.stringify({
    sub: identity.platformUserId,
    workspaceId: identity.workspaceId,
    scope: "instagram:scraping",
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  }));
  return `${payload}.${signPart(payload)}`;
}

function signFacebookScrapingToken(identity: ReturnType<typeof platformIdentity>) {
  const lifetimeSeconds = Math.max(300, Math.min(4 * 60 * 60, Number(process.env.FACEBOOK_COMPANION_TOKEN_TTL_SECONDS) || 2 * 60 * 60));
  const payload = encodeBase64Url(JSON.stringify({
    sub: identity.platformUserId,
    workspaceId: identity.workspaceId,
    scope: "facebook:scraping",
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  }));
  return `${payload}.${signPart(payload)}`;
}

async function authenticateInstagramScraping(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) {
      res.status(401).json({ message: "Sign in to AgenticThat to use Local Companion scraping." });
      return;
    }

    const centralIdentity = scrapingIdentity(token, "scraping.instagram", req.method === "GET" ? "scraping.view" : "scraping.run");
    if (centralIdentity) {
      (req as RequestWithInstagramOwner).instagramOwnerKey = `${centralIdentity.workspaceId}:${centralIdentity.sub}`;
      if (centralIdentity.billingStatus === "trialing") {
        (req as RequestWithInstagramOwner).trialWorkspaceId = centralIdentity.workspaceId;
      }
      next();
      return;
    }

    const user = legacyHumanAuthAllowed() ? await userFromAuthToken(token) : null;
    if (user) {
      (req as RequestWithInstagramOwner).instagramOwnerKey = `${user.workspaceId}:${user.id}`;
      next();
      return;
    }
    if (!legacyHumanAuthAllowed()) {
      res.status(401).json({ message: "A current AgenticThat scraping token is required." });
      return;
    }

    const rawPayload = verifiedTokenPayload(token);
    const payload = rawPayload ? instagramScrapingTokenPayloadSchema.safeParse(rawPayload) : null;
    if (!payload?.success || payload.data.exp <= Math.floor(Date.now() / 1000)) {
      res.status(401).json({ message: "Local Companion scraping session expired. Refresh the page and try again." });
      return;
    }
    (req as RequestWithInstagramOwner).instagramOwnerKey = `${payload.data.workspaceId}:${payload.data.sub}`;
    next();
  } catch (error) {
    next(error);
  }
}

function instagramCompanionOwner(req: RequestWithInstagramOwner) {
  if (!req.instagramOwnerKey) throw new Error("Local Companion scraping authentication is missing.");
  return req.instagramOwnerKey;
}

async function authenticateFacebookScraping(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) {
      res.status(401).json({ message: "Sign in to AgenticThat to use Local Companion Facebook scraping." });
      return;
    }
    const centralIdentity = scrapingIdentity(token, "scraping.facebook", req.method === "GET" ? "scraping.view" : "scraping.run");
    if (centralIdentity) {
      (req as RequestWithFacebookOwner).facebookOwnerKey = `${centralIdentity.workspaceId}:${centralIdentity.sub}`;
      if (centralIdentity.billingStatus === "trialing") {
        (req as RequestWithFacebookOwner).trialWorkspaceId = centralIdentity.workspaceId;
      }
      next();
      return;
    }
    const user = legacyHumanAuthAllowed() ? await userFromAuthToken(token) : null;
    if (user) {
      (req as RequestWithFacebookOwner).facebookOwnerKey = `${user.workspaceId}:${user.id}`;
      next();
      return;
    }
    if (!legacyHumanAuthAllowed()) {
      res.status(401).json({ message: "A current AgenticThat scraping token is required." });
      return;
    }
    const rawPayload = verifiedTokenPayload(token);
    const payload = rawPayload ? facebookScrapingTokenPayloadSchema.safeParse(rawPayload) : null;
    if (!payload?.success || payload.data.exp <= Math.floor(Date.now() / 1000)) {
      res.status(401).json({ message: "Local Companion Facebook scraping session expired. Refresh the page and try again." });
      return;
    }
    (req as RequestWithFacebookOwner).facebookOwnerKey = `${payload.data.workspaceId}:${payload.data.sub}`;
    next();
  } catch (error) {
    next(error);
  }
}

function facebookCompanionOwner(req: RequestWithFacebookOwner) {
  if (!req.facebookOwnerKey) throw new Error("Local Companion Facebook scraping authentication is missing.");
  return req.facebookOwnerKey;
}

app.post("/api/auth/platform/status", async (req, res, next) => {
  try {
    if (!legacyHumanAuthAllowed()) {
      res.status(410).json({ message: "Publishing access is managed by AgenticThat." });
      return;
    }
    const token = z.object({ token: z.string().min(1) }).parse(req.body).token;
    res.json(await platformWorkspaceManagerStatus(platformIdentity(token)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/platform/setup", async (req, res, next) => {
  try {
    if (!legacyHumanAuthAllowed()) {
      res.status(410).json({ message: "Publishing passwords are disabled. Use AgenticThat." });
      return;
    }
    const payload = platformPasswordSchema.parse(req.body);
    const user = await setupPlatformWorkspaceManager(platformIdentity(payload.token), payload.password);
    res.json({ user, token: signAuthToken(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/platform/login", async (req, res, next) => {
  try {
    if (!legacyHumanAuthAllowed()) {
      res.status(410).json({ message: "Publishing passwords are disabled. Use AgenticThat." });
      return;
    }
    const payload = platformPasswordSchema.parse(req.body);
    const user = await loginPlatformWorkspaceManager(platformIdentity(payload.token), payload.password);
    if (!user) {
      res.status(401).json({ message: "Incorrect Operations Manager password." });
      return;
    }
    res.json({ user, token: signAuthToken(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/platform/instagram-scraping", (req, res, next) => {
  try {
    const token = z.object({ token: z.string().min(1) }).parse(req.body).token;
    const identity = scrapingIdentity(token, "scraping.instagram");
    if (!identity) {
      res.status(403).json({ message: "Instagram scraping operate access is required." });
      return;
    }
    res.json({
      token,
      expiresInSeconds: Math.max(1, Number(identity.exp) - Math.floor(Date.now() / 1000)),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/platform/facebook-scraping", (req, res, next) => {
  try {
    const token = z.object({ token: z.string().min(1) }).parse(req.body).token;
    const identity = scrapingIdentity(token, "scraping.facebook");
    if (!identity) {
      res.status(403).json({ message: "Facebook scraping operate access is required." });
      return;
    }
    res.json({
      token,
      expiresInSeconds: Math.max(1, Number(identity.exp) - Math.floor(Date.now() / 1000)),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/scraping/instagram/jobs", authenticateInstagramScraping, (req: RequestWithInstagramOwner, res, next) => {
  try {
    const body = req.body || {};
    const trialLimitKey = companionTrialScrapeLimitKey(req, "instagram");
    const trialLimit = trialLimitKey ? companionTrialScrapeLimit(trialLimitKey) : null;
    if (trialLimit && !trialLimit.allowed) {
      res.status(429).json({
        message: `Trial limit reached for Instagram scraping. Try again in ${trialLimit.retryAfterSeconds} seconds.`,
      });
      return;
    }
    const job = createInstagramCompanionJob(instagramCompanionOwner(req), body);
    if (trialLimitKey) recordCompanionTrialScrape(trialLimitKey);
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof Error && /Companion scraping is unavailable/i.test(error.message)) {
      res.status(503).json({
        message: error.message,
        code: "companion_unavailable",
      });
      return;
    }
    next(error);
  }
});

app.get("/api/scraping/instagram/jobs/:id", authenticateInstagramScraping, (req: RequestWithInstagramOwner, res) => {
  const response = getInstagramCompanionJob(instagramCompanionOwner(req), pathParam(req.params.id, "id"));
  if (!response) {
    res.status(404).json({ message: "Local Instagram scrape job not found." });
    return;
  }
  res.json(response);
});

app.delete("/api/scraping/instagram/jobs/:id", authenticateInstagramScraping, async (req: RequestWithInstagramOwner, res, next) => {
  try {
    const response = await cancelInstagramCompanionJob(
      instagramCompanionOwner(req),
      pathParam(req.params.id, "id"),
    );
    if (!response) {
      res.status(404).json({ message: "Local Instagram scrape job not found." });
      return;
    }
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/scraping/facebook/jobs", authenticateFacebookScraping, (req: RequestWithFacebookOwner, res, next) => {
  try {
    const body = req.body || {};
    const trialLimitKey = companionTrialScrapeLimitKey(req, "facebook");
    const trialLimit = trialLimitKey ? companionTrialScrapeLimit(trialLimitKey) : null;
    if (trialLimit && !trialLimit.allowed) {
      res.status(429).json({
        message: `Trial limit reached for Facebook scraping. Try again in ${trialLimit.retryAfterSeconds} seconds.`,
      });
      return;
    }
    const job = createFacebookCompanionJob(facebookCompanionOwner(req), body);
    if (trialLimitKey) recordCompanionTrialScrape(trialLimitKey);
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof Error && /Companion Facebook scraping is unavailable/i.test(error.message)) {
      res.status(503).json({ message: error.message, code: "companion_unavailable" });
      return;
    }
    next(error);
  }
});

app.get("/api/scraping/facebook/jobs/:id", authenticateFacebookScraping, (req: RequestWithFacebookOwner, res) => {
  const response = getFacebookCompanionJob(facebookCompanionOwner(req), pathParam(req.params.id, "id"));
  if (!response) {
    res.status(404).json({ message: "Local Facebook scrape job not found." });
    return;
  }
  res.json(response);
});

app.delete("/api/scraping/facebook/jobs/:id", authenticateFacebookScraping, async (req: RequestWithFacebookOwner, res, next) => {
  try {
    const response = await cancelFacebookCompanionJob(facebookCompanionOwner(req), pathParam(req.params.id, "id"));
    if (!response) {
      res.status(404).json({ message: "Local Facebook scrape job not found." });
      return;
    }
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.use("/api", authenticateApi);

app.post("/api/companion/accounts/import", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const account = req.body?.account as PlatformAccount | undefined;
    const user = currentUser(req);
    if (!account || typeof account !== "object" || !account.id || !account.platform || account.workspaceId !== user.workspaceId) {
      res.status(400).json({ message: "A valid workspace publishing account is required." });
      return;
    }
    const selectedPlatform = platformSchema.parse(account.platform);
    assertCentralPlatformAccess(req, selectedPlatform, "configure");
    const imported = await upsertSyncedPlatformAccount({
      ...account,
      platform: selectedPlatform,
      companionId: publishingCompanionId(),
      credentialConfigured: Boolean(account.credentialConfigured),
      enabled: account.enabled !== false,
      executionEngine: "companion",
      displayName: String(account.displayName || account.handle || selectedPlatform),
      handle: String(account.handle || ""),
      loginIdentifier: String(account.loginIdentifier || ""),
      createdAt: account.createdAt || new Date().toISOString(),
      updatedAt: account.updatedAt || new Date().toISOString(),
    });
    res.status(201).json(imported);
  } catch (error) {
    next(error);
  }
});

app.get("/api/media/:fileName", async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const fileName = path.basename(pathParam(req.params.fileName, "fileName"));
    const [submission, upload] = await Promise.all([
      listContentSubmissions(user.workspaceId).then(items => items.find(item => item.fileName === fileName)),
      listUploads(undefined, undefined, user.workspaceId).then(items => items.find(item => item.fileName === fileName)),
    ]);
    const media = submission || upload;
    if (!media) {
      res.status(404).json({ message: "Publishing media not found." });
      return;
    }
    const bytes = await readPublishingMedia(fileName, user.workspaceId);
    res.setHeader("Content-Type", media.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", (req: RequestWithUser, res) => {
  res.json(currentUser(req));
});

app.post("/api/publishing-safety/assess", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = publishingSafetyRequestSchema.parse(req.body);
    res.json(await assessDestinationPublishingSafety(user, payload.postFormat, payload.destinations));
  } catch (error) {
    next(error);
  }
});

app.post("/api/automation/consent", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const desktopHost = publishingDesktopHost();
    if (!desktopHost) {
      res.status(409).json({ message: "Open Companion to approve protected workspace publishing." });
      return;
    }
    await desktopHost.requestPersistentPublishingPermission();
    const user = currentUser(req);
    await logActivity(user.id, "automation.permission_granted", "automation_run", null, "Protected workspace publishing was approved in Companion.", {});
    res.json({ granted: true, message: "Publishing permission saved for approved publish-now jobs." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", requireRoles("operations_manager"), async (_req, res, next) => {
  try {
    res.json(await listUserProfiles(currentUser(_req as RequestWithUser).workspaceId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = createUserProfileSchema.parse(req.body);
    const user = currentUser(req);
    res.status(201).json(await createUserProfile(payload, user.id, user.workspaceId));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/users/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = updateUserProfileSchema.parse(req.body);
    const actor = currentUser(req);
    const user = await updateUserProfile(pathParam(req.params.id, "id"), payload, actor.id, actor.workspaceId);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/users/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const actor = currentUser(req);
    const user = await deactivateUserProfile(pathParam(req.params.id, "id"), actor.id, actor.workspaceId);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/activity-logs", requireRoles("operations_manager"), async (req, res, next) => {
  try {
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
    res.json(await listActivityLogs(limit, currentUser(req as RequestWithUser).workspaceId));
  } catch (error) {
    next(error);
  }
});

// --- DASHBOARD ---
app.get("/api/dashboard", async (req: RequestWithUser, res, next) => {
  try {
    res.json(await dashboardSummary(currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/submissions", async (req: RequestWithUser, res, next) => {
  try {
    res.json(await listContentSubmissions(currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

// --- LIST UPLOADS ---
app.get("/api/uploads", async (req: RequestWithUser, res, next) => {
  try {
    const platform = req.query.platform ? platformSchema.parse(req.query.platform) : undefined;
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
    if (platform) assertCentralPlatformAccess(req, platform, "view");
    res.json(filterCentralPlatforms(req, await listUploads(platform, accountId, currentUser(req).workspaceId)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/platforms/:platform/uploads", async (req: RequestWithUser, res, next) => {
  try {
    const platform = platformSchema.parse(req.params.platform);
    assertCentralPlatformAccess(req, platform, "view");
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
    res.json(await listUploads(platform, accountId, currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

// --- PUBLISHING ACCOUNTS ---
app.get("/api/accounts", async (req: RequestWithUser, res, next) => {
  try {
    const platform = req.query.platform ? platformSchema.parse(req.query.platform) : undefined;
    if (platform) assertCentralPlatformAccess(req, platform, "view");
    res.json(filterVisibleAccounts(req, await listPlatformAccounts(platform, currentUser(req).workspaceId)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/platforms/:platform/accounts", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const platform = platformSchema.parse(req.params.platform);
    assertCentralPlatformAccess(req, platform, "configure");
    const payload = upsertPlatformAccountSchema.parse(req.body);
    const user = currentUser(req);
    const account = await createPlatformAccount(platform, {
      ...payload,
      executionEngine: "companion",
      companionId: publishingCompanionId(),
    }, user.workspaceId);
    await logActivity(user.id, "account.created", "publishing_account", account.id, `${account.displayName} account was added for ${platform}.`, { platform, handle: account.handle });
    res.status(201).json(account);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/accounts/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = upsertPlatformAccountSchema.parse(req.body);
    const user = currentUser(req);
    const accountId = pathParam(req.params.id, "id");
    const existing = await getPlatformAccount(accountId, user.workspaceId);
    if (!existing) {
      res.status(404).json({ message: "Publishing account not found" });
      return;
    }
    assertCentralPlatformAccess(req, existing.platform, "configure");
    const account = await updatePlatformAccount(accountId, {
      ...payload,
      executionEngine: "companion",
      companionId: publishingCompanionId(),
    }, user.workspaceId);
    if (!account) {
      res.status(404).json({ message: "Publishing account not found" });
      return;
    }
    await logActivity(
      user.id,
      "account.updated",
      "publishing_account",
      account.id,
      `${account.displayName} account was updated.`,
      {
        platform: account.platform,
        handle: account.handle,
        executionEngine: "companion",
      },
    );
    res.json(account);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const accountId = pathParam(req.params.id, "id");
    const existing = await getPlatformAccount(accountId, user.workspaceId);
    if (existing) assertCentralPlatformAccess(req, existing.platform, "configure");
    const account = await deletePlatformAccount(accountId, user.workspaceId);
    if (!account) {
      res.status(404).json({ message: "Publishing account not found" });
      return;
    }
    await removeSavedAccountProfile(account).catch(error => {
      console.warn(`Could not remove the saved browser profile for ${account.handle}:`, error instanceof Error ? error.message : error);
    });
    await logActivity(user.id, "account.deleted", "publishing_account", account.id, `${account.displayName} account was deleted.`, { platform: account.platform, handle: account.handle });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:id/manual-login", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    if (process.env.SERVERLESS === "true" || process.env.NETLIFY === "true") {
      res.status(409).json({
        message: "Interactive browser login requires the persistent Publish Queue Runner. Configure PUBLISH_QUEUE_API_URL to that runner before opening a manual login session."
      });
      return;
    }
    const user = currentUser(req);
    const accountId = pathParam(req.params.id, "id");
    const existing = await getPlatformAccount(accountId, user.workspaceId);
    if (!existing) {
      res.status(404).json({ message: "Publishing account not found" });
      return;
    }
    assertCentralPlatformAccess(req, existing.platform, "configure");
    const { surface } = manualLoginRequestSchema.parse(req.body ?? {});
    const { account, started, surface: activeSurface } = await startManualAccountSession(accountId, surface);
    const surfaceLabel = activeSurface === "embedded" ? "Companion" : "Chrome, Edge, or Chromium";
    await logActivity(
      user.id,
      started ? "account.manual_login_started" : "account.manual_login_already_running",
      "publishing_account",
      account.id,
      started
        ? `${account.displayName} manual login session was opened in ${surfaceLabel}.`
        : `${account.displayName} manual login session is already open in ${surfaceLabel}.`,
      { platform: account.platform, handle: account.handle, surface: activeSurface, executionEngine: account.executionEngine ?? "companion" },
    );
    res.status(202).json({
      message: started
        ? activeSurface === "embedded"
          ? "Secure login opened inside Companion. Complete sign-in there; Companion will detect success, protect the local account session, and close the login pane automatically."
          : "Secure login opened in Chrome, Edge, or Chromium. Complete sign-in there; Companion will transfer it into the embedded browser when the provider permits, or retain the protected Companion-managed browser profile when the provider binds the session to that browser."
        : "Manual login is already running for this account.",
      started,
      surface: activeSurface,
      executionEngine: "companion",
    });
  } catch (error) {
    next(error);
  }
});

// Scheduling is intentionally paused in this Companion release. Keep historical
// records intact, but reject every route that could create or change timed work.
const schedulingUnavailable = (_req: express.Request, res: express.Response) => {
  res.status(410).json({ message: "Scheduling is temporarily unavailable. Publish or queue the post now instead." });
};
app.all(["/api/schedules", "/api/schedules/:id", "/api/social-media-schedules", "/api/submissions/:id/schedule"], schedulingUnavailable);
app.post(["/api/submissions/text", "/api/submissions/staged"], schedulingUnavailable);
app.patch("/api/uploads/:id", (req, res, next) => {
  const payload = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  if (Object.hasOwn(payload, "scheduledAt") || Object.hasOwn(payload, "scheduleId")) {
    schedulingUnavailable(req, res);
    return;
  }
  next();
});

// --- LEGACY REUSABLE SCHEDULES (kept for data compatibility) ---
app.get("/api/schedules", async (req: RequestWithUser, res, next) => {
  try {
    res.json(await listPublishingSchedules(currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/schedules", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = upsertPublishingScheduleSchema.parse(req.body);
    const user = currentUser(req);
    const schedule = await createPublishingSchedule(payload, user.workspaceId);
    await logActivity(user.id, "schedule.created", "schedule_template", schedule.id, `${schedule.name} schedule was created.`, { frequency: schedule.frequency, time: schedule.time });
    res.status(201).json(schedule);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/schedules/:id", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const scheduleId = scheduleIdSchema.parse(req.params.id);
    const payload = upsertPublishingScheduleSchema.parse(req.body);
    const user = currentUser(req);
    const schedule = await updatePublishingSchedule(scheduleId, payload, user.workspaceId);
    if (!schedule) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }
    await logActivity(user.id, "schedule.updated", "schedule_template", schedule.id, `${schedule.name} schedule was updated.`, { frequency: schedule.frequency, time: schedule.time, status: schedule.status });
    res.json(schedule);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/schedules/:id", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const scheduleId = scheduleIdSchema.parse(req.params.id);
    const user = currentUser(req);
    const schedule = await deletePublishingSchedule(scheduleId, user.workspaceId);
    if (!schedule) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }
    await logActivity(user.id, "schedule.deleted", "schedule_template", schedule.id, `${schedule.name} schedule was deleted.`, { frequency: schedule.frequency, time: schedule.time });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/social-media-schedules", async (req: RequestWithUser, res, next) => {
  try {
    res.json(await listSocialMediaSchedules(currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

// --- LOCAL DEVICE UPLOADS ---
app.post("/api/staged-uploads", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = stagedUploadCreateSchema.parse(req.body);
    const extension = path.extname(payload.originalName).toLowerCase();
    if (!allowedUploadExtensions.has(extension) || !allowedUploadMimePrefixes.some(prefix => payload.mimeType.startsWith(prefix))) {
      throw new Error("Upload images or videos only.");
    }
    if ((payload.mimeType.startsWith("image/") && !imageUploadExtensions.has(extension))
      || (payload.mimeType.startsWith("video/") && !videoUploadExtensions.has(extension))) {
      throw new Error("The selected file extension does not match its media type.");
    }
    if (payload.size > maxUploadFileSize) {
      throw new Error(`The selected media exceeds the ${Math.floor(maxUploadFileSize / (1024 * 1024))} MB upload limit.`);
    }

    await cleanExpiredStagedUploads();
    const id = `stage_${randomUUID().replace(/-/g, "")}`;
    const record: StagedUploadRecord = {
      id,
      userId: user.id,
      workspaceId: user.workspaceId,
      originalName: payload.originalName,
      fileName: safeUploadFileName(payload.originalName),
      mimeType: payload.mimeType,
      size: payload.size,
      createdAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(stagedMetadataPath(id), JSON.stringify(record), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.promises.writeFile(stagedContentPath(id), Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    res.status(201).json({ id, offset: 0, chunkSize: 2 * 1024 * 1024 });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/staged-uploads/:id/chunks",
  requireRoles("operations_manager", "post_uploader"),
  express.raw({ type: "application/octet-stream", limit: "3mb" }),
  async (req: RequestWithUser, res, next) => {
    try {
      const user = currentUser(req);
      const stagedUploadId = stagedUploadIdSchema.parse(pathParam(req.params.id, "id"));
      const record = await readStagedUpload(stagedUploadId);
      if (record.workspaceId !== user.workspaceId || (record.userId !== user.id && user.role !== "operations_manager")) {
        throw new Error("This staged upload belongs to another workspace.");
      }
      const requestedOffset = Number(req.headers["x-upload-offset"]);
      if (!Number.isInteger(requestedOffset) || requestedOffset < 0) throw new Error("The upload offset is invalid.");
      const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (content.length === 0) throw new Error("The upload chunk is empty.");
      const contentPath = stagedContentPath(stagedUploadId);
      const currentSize = (await fs.promises.stat(contentPath)).size;
      if (currentSize !== requestedOffset) {
        res.status(409).json({ message: "The upload offset is out of date.", offset: currentSize });
        return;
      }
      if (currentSize + content.length > record.size) throw new Error("The uploaded data exceeds the declared file size.");
      await fs.promises.appendFile(contentPath, content);
      res.json({ id: stagedUploadId, offset: currentSize + content.length });
    } catch (error) {
      next(error);
    }
  },
);

app.delete("/api/staged-uploads/:id", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const stagedUploadId = stagedUploadIdSchema.parse(pathParam(req.params.id, "id"));
    const record = await readStagedUpload(stagedUploadId);
    if (record.workspaceId !== user.workspaceId || (record.userId !== user.id && user.role !== "operations_manager")) {
      throw new Error("This staged upload belongs to another workspace.");
    }
    await removeStagedUpload(stagedUploadId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions/text", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = textSubmissionSchema.parse(req.body);
    assertCentralCapability(req, "publishing.submissions.create");
    const selectedAccountIds = await validateSubmissionAccounts(req, user, {
      originalname: "Text post",
      filename: "",
      mimetype: "text/plain",
      size: Buffer.byteLength(payload.description, "utf8"),
    }, "", payload.description, payload.selectedAccountIds);
    const preflightIssues = evaluateContentPreflight({
      postFormat: "text",
      description: payload.description,
      originalName: "Text post",
      size: Buffer.byteLength(payload.description, "utf8"),
      rightsConfirmed: true,
    });
    assertContentPreflight(preflightIssues, payload.confirmWarnings);
    const submission = await createContentSubmission({
      originalName: "Text post",
      fileName: "",
      mimeType: "text/plain",
      postFormat: "text",
      size: Buffer.byteLength(payload.description, "utf8"),
      url: "",
      description: payload.description,
      rightsConfirmed: true,
      selectedAccountIds,
    }, user.workspaceId, user.id);
    res.status(201).json(submission);
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions/staged", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  let finalFileName: string | null = null;
  let finalWorkspaceId: string | null = null;
  try {
    const user = currentUser(req);
    const payload = stagedSubmissionSchema.parse(req.body);
    assertCentralCapability(req, "publishing.submissions.create");
    const record = await readStagedUpload(payload.stagedUploadId);
    if (record.workspaceId !== user.workspaceId || (record.userId !== user.id && user.role !== "operations_manager")) {
      throw new Error("This staged upload belongs to another workspace.");
    }
    const stagedPath = stagedContentPath(record.id);
    const receivedSize = (await fs.promises.stat(stagedPath)).size;
    if (receivedSize !== record.size) throw new Error(`The media upload is incomplete (${receivedSize} of ${record.size} bytes received).`);
    await assertStagedMediaSignature(record, stagedPath);

    const postFormat = postFormatForFile({
      originalname: record.originalName,
      filename: record.fileName,
      mimetype: record.mimeType,
      size: record.size,
    });
    if (postFormat === "video" && !payload.title) {
      throw new Error("Enter a video title so the scheduler can choose any supported platform.");
    }

    const preflightIssues = evaluateContentPreflight({
      postFormat,
      title: payload.title,
      description: payload.description,
      originalName: record.originalName,
      size: record.size,
      rightsConfirmed: payload.rightsConfirmed,
    });
    assertContentPreflight(preflightIssues, payload.confirmWarnings);
    const selectedAccountIds = await validateSubmissionAccounts(req, user, {
      originalname: record.originalName,
      filename: record.fileName,
      mimetype: record.mimeType,
      size: record.size,
    }, payload.title, payload.description, payload.selectedAccountIds);

    finalFileName = record.fileName;
    finalWorkspaceId = user.workspaceId;
    await fs.promises.rename(stagedPath, path.join(uploadDir, record.fileName));
    await storePublishingMedia(record.fileName, user.workspaceId, record.mimeType);
    const submission = await createContentSubmission({
      originalName: record.originalName,
      fileName: record.fileName,
      mimeType: record.mimeType,
      postFormat,
      size: record.size,
      url: `/uploads/${record.fileName}`,
      title: payload.title,
      description: payload.description,
      rightsConfirmed: payload.rightsConfirmed,
      selectedAccountIds,
    }, user.workspaceId, user.id);
    await fs.promises.unlink(stagedMetadataPath(record.id)).catch(() => undefined);
    res.status(201).json(submission);
  } catch (error) {
    if (finalFileName && finalWorkspaceId) await deletePublishingMedia(finalFileName, finalWorkspaceId);
    next(error);
  }
});

app.post("/api/submissions/:id/schedule", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = scheduleSubmissionSchema.parse(req.body);
    const result = await scheduleContentSubmission(
      pathParam(req.params.id, "id"),
      currentUser(req),
      payload.destinations,
      payload.confirmWarnings,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/posts/unified/text", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = textUnifiedPostSchema.parse(req.body);
    const createdUploads = await createUnifiedPosts({
      originalname: "Text post",
      filename: "",
      mimetype: "text/plain",
      size: Buffer.byteLength(payload.description, "utf8"),
    }, user, "", payload.description, payload.destinations, { rightsConfirmed: true, confirmWarnings: payload.confirmWarnings }, req);
    res.status(201).json(createdUploads);
  } catch (error) {
    next(error);
  }
});

app.post("/api/posts/unified/staged", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  let finalFileName: string | null = null;
  let finalWorkspaceId: string | null = null;
  try {
    const user = currentUser(req);
    const payload = stagedUnifiedPostSchema.parse(req.body);
    const record = await readStagedUpload(payload.stagedUploadId);
    if (record.workspaceId !== user.workspaceId || (record.userId !== user.id && user.role !== "operations_manager")) {
      throw new Error("This staged upload belongs to another workspace.");
    }
    const stagedPath = stagedContentPath(record.id);
    const receivedSize = (await fs.promises.stat(stagedPath)).size;
    if (receivedSize !== record.size) throw new Error(`The media upload is incomplete (${receivedSize} of ${record.size} bytes received).`);
    await assertStagedMediaSignature(record, stagedPath);

    finalFileName = record.fileName;
    finalWorkspaceId = user.workspaceId;
    await fs.promises.rename(stagedPath, path.join(uploadDir, record.fileName));
    await storePublishingMedia(record.fileName, user.workspaceId, record.mimeType);
    const createdUploads = await createUnifiedPosts({
      originalname: record.originalName,
      filename: record.fileName,
      mimetype: record.mimeType,
      size: record.size,
    }, user, payload.title, payload.description, payload.destinations, {
      rightsConfirmed: payload.rightsConfirmed,
      confirmWarnings: payload.confirmWarnings,
    }, req);
    await fs.promises.unlink(stagedMetadataPath(record.id)).catch(() => undefined);
    res.status(201).json(createdUploads);
  } catch (error) {
    if (finalFileName && finalWorkspaceId) await deletePublishingMedia(finalFileName, finalWorkspaceId);
    next(error);
  }
});

// --- UPDATE STATUS ---
app.patch("/api/uploads/:id/status", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = updateUploadStatusSchema.parse(req.body);
    const uploadId = pathParam(req.params.id, "id");
    const existing = await findUploadOrThrow(uploadId, user.workspaceId);
    assertCentralPlatformAccess(req, existing.platform, "operate");
    const item = await updateUploadStatus(uploadId, payload.status, payload.failureReason ?? "Post status updated", user.id, user.workspaceId);

    if (!item) {
      res.status(404).json({ message: "Upload not found" });
      return;
    }

    await logActivity(user.id, "post.status_updated", "post", item.id, `${item.title || item.originalName} status changed to ${item.status}.`, { status: item.status });
    res.json(item);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/uploads/:id", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    if (req.centralCapabilities !== undefined && user.role === "post_uploader") {
      res.status(403).json({ message: "Submitted content is locked after handoff to the Scheduler." });
      return;
    }
    const uploadId = pathParam(req.params.id, "id");
    const existing = await findUploadOrThrow(uploadId, user.workspaceId);
    assertCentralPlatformAccess(req, existing.platform, "operate");
    let payload;
    let action = "post.updated";
    let summaryDetail = "details";

    if (user.role === "scheduler") {
      const schedulePayload = scheduleOnlyUpdateSchema.parse(req.body);
      const scheduledAt = schedulePayload.scheduledAt ? normalizeScheduledAt(schedulePayload.scheduledAt) : schedulePayload.scheduledAt;
      payload = {
        title: existing.title,
        caption: existing.caption,
        accountId: existing.accountId,
        scheduledAt,
        scheduleId: schedulePayload.scheduleId
      };
      action = "post.scheduled";
      summaryDetail = "schedule";
    } else {
      const contentPayload = updateUploadDetailsSchema.parse(req.body);
      const scheduledAt = contentPayload.scheduledAt ? normalizeScheduledAt(contentPayload.scheduledAt) : contentPayload.scheduledAt;
      payload = {
        ...contentPayload,
        scheduledAt,
        scheduleId: contentPayload.scheduleId
      };
      action = scheduledAt || contentPayload.scheduleId ? "post.scheduled" : "post.updated";
      summaryDetail = scheduledAt || contentPayload.scheduleId ? "schedule" : "content";
    }

    if (!canEditContent(user.role) && !canEditSchedule(user.role)) {
      res.status(403).json({ message: "Your role cannot edit posts." });
      return;
    }

    if (payload.scheduleId) {
      const schedule = (await listPublishingSchedules(user.workspaceId)).find(item => item.id === payload.scheduleId);
      if (!schedule) throw new Error(`Schedule #${payload.scheduleId} was not found.`);
      assertScheduleCanReceivePosts(schedule);
    }

    let scheduleSafetyIssues: PublishingScheduleSafetyIssue[] = [];
    if (payload.scheduledAt || payload.scheduleId) {
      const postFormat = existing.postFormat ?? postFormatForFile({
        originalname: existing.originalName,
        filename: existing.fileName,
        mimetype: existing.mimeType,
        size: existing.size,
      });
      const safety = await assessDestinationPublishingSafety(user, postFormat, [{
        accountId: payload.accountId ?? existing.accountId,
        scheduledAt: payload.scheduledAt ?? undefined,
        scheduleId: payload.scheduleId ?? undefined,
      }], existing.id);
      scheduleSafetyIssues = safety.issues;
    }

    let item = await updateUploadDetails(uploadId, payload, user.id, user.workspaceId);

    if (!item) {
      res.status(404).json({ message: "Upload not found" });
      return;
    }

    if (scheduleSafetyIssues.length > 0) {
      [item] = await applyPublishingSafetyDeferrals([item], scheduleSafetyIssues);
    }

    await logActivity(user.id, action, "post", item.id, `${item.title || item.originalName} ${summaryDetail} was updated.`, { platform: item.platform, accountId: item.accountId, scheduledAt: item.scheduledAt, scheduleId: item.scheduleId });
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// --- DELETE UPLOAD ---
app.delete("/api/uploads/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const uploadId = pathParam(req.params.id, "id");
    const existing = await findUploadOrThrow(uploadId, user.workspaceId);
    assertCentralPlatformAccess(req, existing.platform, "operate");
    const deleted = await deleteUpload(uploadId, user.workspaceId);

    if (!deleted) {
      res.status(404).json({ message: "Upload not found" });
      return;
    }

    const fileStillUsed = (await listUploads(undefined, undefined, user.workspaceId)).some(upload => upload.fileName === deleted.fileName)
      || (await listContentSubmissions(user.workspaceId)).some(submission => submission.fileName === deleted.fileName);
    if (!fileStillUsed && deleted.fileName) await deletePublishingMedia(deleted.fileName, user.workspaceId);

    await logActivity(user.id, "post.deleted", "post", deleted.id, `${deleted.title || deleted.originalName} was deleted.`, { platform: deleted.platform, accountId: deleted.accountId });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// --- AUTOMATION INPUT ---
app.get("/api/automation/input", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    res.json(await automationInput(undefined, "ready", currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/automation/platforms/:platform/input", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const platform = platformSchema.parse(req.params.platform);
    res.json(await automationInput(platform, "ready", currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

// --- TRIGGER AUTOMATION ---
app.post("/api/automation/run", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    if (process.env.SERVERLESS === "true" || process.env.NETLIFY === "true") {
      res.status(409).json({
        message: "Browser publishing requires the persistent Publish Queue Runner. Configure PUBLISH_QUEUE_API_URL to the runner and try again."
      });
      return;
    }
    const user = currentUser(req);
    const payload = automationRunRequestSchema.parse(req.body ?? {});
    await logActivity(user.id, "automation.started", "automation_run", null, "Manual publisher automation was started.", {});
    if (payload.uploadIds?.length) {
      const allowedIds = new Set((await listUploads(undefined, undefined, user.workspaceId)).map(upload => upload.id));
      if (payload.uploadIds.some(id => !allowedIds.has(id))) {
        res.status(404).json({ message: "One or more posts were not found in this workspace." });
        return;
      }
    }
    runAutomation({ trigger: "manual", startedByUserId: user.id, workspaceId: user.workspaceId, uploadIds: payload.uploadIds })
      .catch(err => console.error("Background error:", err));
    res.status(202).json({
      message: payload.uploadIds?.length
        ? `Publishing started for ${payload.uploadIds.length} ${payload.uploadIds.length === 1 ? "post" : "posts"}.`
        : "Publisher automation started.",
      uploadIds: payload.uploadIds ?? []
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/automation/stop", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const stopped = await cancelAutomation();
    const user = currentUser(req);
    await logActivity(
      user.id,
      stopped ? "automation.emergency_stop" : "automation.stop_checked",
      "automation_run",
      null,
      stopped ? "Emergency stop cancelled active and queued publishing work." : "Publishing stop was checked while automation was idle.",
      { stopped },
    );
    res.json({
      stopped,
      message: stopped ? "Publishing automation is stopping." : "No publishing automation is running.",
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({
    message: `Publishing API route not found: ${req.method} ${req.originalUrl}`,
  });
});

// --- ERROR HANDLER ---
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ContentPreflightError) {
    res.status(error.code === "CONTENT_PREFLIGHT_WARNINGS" ? 409 : 422).json({
      message: error.message,
      code: error.code,
      issues: error.issues,
    });
    return;
  }

  if (error instanceof PublishingAccessError) {
    res.status(403).json({ message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      message: "Validation failed",
      issues: error.issues
    });
    return;
  }

  if (error instanceof Error) {
    res.status(400).json({ message: error.message });
    return;
  }

  res.status(500).json({ message: "Unexpected server error" });
});

if (process.env.NODE_ENV === "production" && authSecret() === "local-development-auth-token-secret") {
  throw new Error("PUBLISH_QUEUE_AUTH_TOKEN_SECRET is required in production.");
}

if (process.env.NODE_ENV === "production") {
  const managerPassword = process.env.PUBLISH_QUEUE_OPERATIONS_MANAGER_PASSWORD?.trim()
    || process.env.OPERATIONS_MANAGER_PASSWORD?.trim()
    || process.env.ADMIN_PASSWORD?.trim();
  if (!managerPassword) {
    throw new Error("PUBLISH_QUEUE_OPERATIONS_MANAGER_PASSWORD or ADMIN_PASSWORD is required in production.");
  }
}

export type PublishingHttpServerOptions = {
  host?: string;
  port?: number;
  startBackgroundServices?: boolean;
};

export function createPublishingHttpServer(options: PublishingHttpServerOptions = {}): Server {
  const serverHost = options.host ?? host;
  const serverPort = options.port ?? port;
  const startBackgroundServices = options.startBackgroundServices ?? true;
  const server = app.listen(serverPort, serverHost, () => {
    const address = server.address();
    const resolvedPort = typeof address === "object" && address ? address.port : serverPort;
    console.log(`Publish Queue Runner API listening on http://${serverHost}:${resolvedPort}`);
    if (!startBackgroundServices) return;
    void (async () => {
      try {
        const recovery = await recoverInterruptedPublishingWork();
        if (recovery.recoveredUploads > 0) {
          console.warn(
            `Recovered ${recovery.recoveredUploads} interrupted post(s) in ${recovery.recoveryMode} mode.`,
          );
        }
      } catch (error) {
        console.error("Could not recover interrupted publishing work:", error instanceof Error ? error.message : error);
      }

      await reconcileSavedAccountSessions().catch(error => {
        console.warn("Could not reconcile saved publishing sessions:", error instanceof Error ? error.message : error);
      });
      startScheduler();
      startCentralWorkspaceCompanionPolling();
    })();
  });
  return server;
}

const isDirectExecution = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

const server = isDirectExecution
  ? createPublishingHttpServer()
  : null;

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopPublishingBackgroundServices();
  server?.close();
}

if (server) {
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
