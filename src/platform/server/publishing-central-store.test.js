import assert from "node:assert/strict";
import test from "node:test";
import { centralPublishingTestHelpers } from "./publishing-central-store.js";

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
