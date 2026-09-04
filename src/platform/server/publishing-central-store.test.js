import assert from "node:assert/strict";
import test from "node:test";
import { centralPublishingTestHelpers } from "./publishing-central-store.js";

test("central publishing resumes reconnect-required jobs only after the paired Companion is online", () => {
  const timestamp = Date.now();
  const companion = { id: "companion_1", status: "online", version: "2.1.6", runtimeStatus: "ready", lastSeenAt: new Date(timestamp).toISOString() };
  const account = { id: "account_1", workspaceId: "workspace_1", credentialConfigured: true };
  const document = {
    uploads: [
      { id: "upload_due", status: "failed", failureReason: "Session expired" },
      { id: "upload_later", status: "failed", failureReason: "Session expired" },
    ],
    jobs: [
      { id: "job_due", workspaceId: "workspace_1", accountId: "account_1", uploadId: "upload_due", state: "reconnect_required", notBefore: null },
      { id: "job_later", workspaceId: "workspace_1", accountId: "account_1", uploadId: "upload_later", state: "reconnect_required", notBefore: new Date(timestamp + 60_000).toISOString() },
    ],
  };

  centralPublishingTestHelpers.resumeReconnectJobs(document, account, companion, timestamp);

  assert.equal(document.jobs[0].state, "queued");
  assert.equal(document.jobs[1].state, "waiting_for_companion");
  assert.equal(document.uploads[0].status, "queued");
  assert.equal(document.uploads[0].failureReason, null);
  assert.equal(document.uploads[1].status, "queued");
});

test("central publishing reports account readiness and accepts only the active Companion job lease", () => {
  const timestamp = Date.now();
  const online = { status: "online", version: "2.1.6", runtimeStatus: "ready", lastSeenAt: new Date(timestamp).toISOString() };
  const offline = { status: "offline", lastSeenAt: new Date(timestamp).toISOString() };
  assert.equal(centralPublishingTestHelpers.accountReadiness({ enabled: true, credentialConfigured: true }, online), "ready");
  assert.equal(centralPublishingTestHelpers.accountReadiness({ enabled: true, credentialConfigured: true }, offline), "waiting_for_companion");
  assert.equal(centralPublishingTestHelpers.accountReadiness({ enabled: true, credentialConfigured: false }, online), "reconnect_required");
  assert.equal(centralPublishingTestHelpers.companionPublishingEngine("instagram", "companion"), "companion");
  assert.equal(centralPublishingTestHelpers.companionPublishingEngine("instagram", "external_browser"), "external_browser");
  assert.equal(centralPublishingTestHelpers.companionPublishingEngine("x", "companion"), "external_browser");
  assert.equal(centralPublishingTestHelpers.companionPublishingEngine("youtube", "companion"), "external_browser");

  assert.equal(centralPublishingTestHelpers.hasActiveJobLease({ leaseOwner: "companion_1", leaseExpiresAt: new Date(timestamp + 1_000).toISOString() }, "companion_1", timestamp), true);
  assert.equal(centralPublishingTestHelpers.hasActiveJobLease({ leaseOwner: "companion_2", leaseExpiresAt: new Date(timestamp + 1_000).toISOString() }, "companion_1", timestamp), false);
  assert.equal(centralPublishingTestHelpers.hasActiveJobLease({ leaseOwner: "companion_1", leaseExpiresAt: new Date(timestamp - 1_000).toISOString() }, "companion_1", timestamp), false);
});

test("central publishing accepts a confirmed late success without reopening other failed work", () => {
  const timestamp = Date.now();
  const failedJob = { state: "failed", leaseOwner: null, leaseExpiresAt: null };

  assert.equal(centralPublishingTestHelpers.centralJobUpdateIsAllowed(failedJob, "companion_1", "published", timestamp), true);
  assert.equal(centralPublishingTestHelpers.centralJobUpdateIsAllowed(failedJob, "companion_1", "publishing", timestamp), false);
  assert.equal(centralPublishingTestHelpers.centralJobUpdateIsAllowed({ state: "published" }, "companion_1", "published", timestamp), false);
  assert.equal(centralPublishingTestHelpers.centralJobUpdateIsAllowed({ state: "uncertain" }, "companion_1", "published", timestamp), true);
});

test("central publishing enforces Companion compatibility and reports operational states", () => {
  const timestamp = Date.now();
  assert.equal(centralPublishingTestHelpers.versionAtLeast("2.1.6"), true);
  assert.equal(centralPublishingTestHelpers.versionAtLeast("2.1.5"), false);
  assert.equal(centralPublishingTestHelpers.versionAtLeast("1.9.0"), false);
  assert.equal(centralPublishingTestHelpers.versionAtLeast("1.8.9"), false);
  assert.equal(centralPublishingTestHelpers.versionAtLeast("2.1.2"), false);
  assert.equal(centralPublishingTestHelpers.companionCompatibility({ version: "1.8.0" }), "outdated");
  assert.equal(centralPublishingTestHelpers.companionStatus({
    status: "online", version: "2.1.6", runtimeStatus: "ready", updateStatus: "downloading",
    lastSeenAt: new Date(timestamp).toISOString(),
  }), "updating");
  assert.equal(centralPublishingTestHelpers.companionStatus({
    status: "online", version: "2.1.6", runtimeStatus: "error", lastSeenAt: new Date(timestamp).toISOString(),
  }), "error");
});

test("expired publishing leases become UNCERTAIN while pre-submit work is safely requeued", () => {
  const timestamp = Date.now();
  const document = {
    jobs: [
      { id: "final", workspaceId: "workspace_1", uploadId: "upload_final", state: "publishing", leaseOwner: "companion_1", leaseExpiresAt: new Date(timestamp - 1).toISOString() },
      { id: "safe", workspaceId: "workspace_1", uploadId: "upload_safe", state: "uploading", leaseOwner: "companion_1", leaseExpiresAt: new Date(timestamp - 1).toISOString() },
    ],
    uploads: [
      { id: "upload_final", status: "processing", publishActionState: "submitted" },
      { id: "upload_safe", status: "processing", publishActionState: "not_started" },
    ],
  };
  centralPublishingTestHelpers.recoverExpiredCentralJobLeases(document, "workspace_1", timestamp);
  assert.equal(document.jobs[0].state, "uncertain");
  assert.equal(document.uploads[0].publishActionState, "uncertain");
  assert.match(document.uploads[0].failureReason, /uncertain/i);
  assert.equal(document.jobs[1].state, "queued");
  assert.equal(document.uploads[1].status, "queued");
});

test("central publishing skips a disconnected account without starving later ready jobs", () => {
  const timestamp = Date.now();
  const document = {
    accounts: [
      { id: "account_disconnected", enabled: true, credentialConfigured: false },
      { id: "account_ready", enabled: true, credentialConfigured: true },
    ],
    uploads: [
      { id: "upload_disconnected" },
      { id: "upload_ready" },
    ],
    jobs: [
      { id: "job_disconnected", workspaceId: "workspace_1", accountId: "account_disconnected", uploadId: "upload_disconnected", state: "queued", attemptCount: 0 },
      { id: "job_ready", workspaceId: "workspace_1", accountId: "account_ready", uploadId: "upload_ready", state: "queued", attemptCount: 0 },
    ],
  };

  const selected = centralPublishingTestHelpers.selectClaimableCentralJobs(document, "workspace_1", timestamp, 1);

  assert.equal(document.jobs[0].state, "waiting_for_companion");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].job.id, "job_ready");
});

test("central publishing creates a multi-destination release atomically in one document mutation", () => {
  const platforms = ["instagram", "facebook", "x", "linkedin", "youtube"];
  const document = {
    accounts: platforms.map((platform, index) => ({
      id: `account_${index}`,
      workspaceId: "workspace_1",
      platform,
      enabled: true,
      credentialConfigured: true,
    })),
    uploads: [], jobs: [], schedules: [], activityLogs: [], companions: [],
  };
  const principal = { workspaceId: "workspace_1", userId: "user_1", name: "Manager" };

  const uploads = platforms.map((platform, index) => centralPublishingTestHelpers.createUploadInDocument(document, principal, {
    accountId: `account_${index}`,
    postFormat: "image",
    originalName: "release.jpg",
    mimeType: "image/jpeg",
    caption: `${platform} caption`,
    rightsConfirmed: true,
  }));

  assert.equal(uploads.length, 5);
  assert.equal(document.uploads.length, 5);
  assert.equal(document.jobs.length, 5);
  assert.deepEqual(document.uploads.map((upload) => upload.caption), platforms.map((platform) => `${platform} caption`));
});
