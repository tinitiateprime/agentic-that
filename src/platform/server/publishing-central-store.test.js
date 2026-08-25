import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { centralPublishingTestHelpers, listCentralAccounts } from "./publishing-central-store.js";

test("central publishing initializes persistent local development state without a database URL", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-central-publishing-"));
  const previousPath = process.env.PLATFORM_DOCUMENT_DATA_PATH;
  process.env.PLATFORM_DOCUMENT_DATA_PATH = path.join(directory, "documents.json");
  try {
    assert.deepEqual(await listCentralAccounts("workspace_local"), []);
    assert.deepEqual(await listCentralAccounts("workspace_local"), []);
  } finally {
    if (previousPath === undefined) delete process.env.PLATFORM_DOCUMENT_DATA_PATH;
    else process.env.PLATFORM_DOCUMENT_DATA_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test("central publishing resumes reconnect-required jobs only after the paired Companion is online", () => {
  const timestamp = Date.now();
  const companion = { id: "companion_1", status: "online", lastSeenAt: new Date(timestamp).toISOString() };
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
  const online = { status: "online", lastSeenAt: new Date(timestamp).toISOString() };
  const offline = { status: "offline", lastSeenAt: new Date(timestamp).toISOString() };
  assert.equal(centralPublishingTestHelpers.accountReadiness({ enabled: true, credentialConfigured: true }, online), "ready");
  assert.equal(centralPublishingTestHelpers.accountReadiness({ enabled: true, credentialConfigured: true }, offline), "waiting_for_companion");
  assert.equal(centralPublishingTestHelpers.accountReadiness({ enabled: true, credentialConfigured: false }, online), "reconnect_required");
  assert.equal(centralPublishingTestHelpers.companionPublishingEngine("external_browser"), "companion");

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
