import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";
import { createAutomationDatabase } from "./database.ts";
import { AutomationJobStore } from "./job-store.ts";
import { AutomationLoginStore } from "./login-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { migrateAutomationSchema } from "./schema.ts";

test("SQLite stores accounts and safely leases publishing jobs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-jobs-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();
  const database = createAutomationDatabase(config);
  migrateAutomationSchema(database);
  const store = new AutomationJobStore(database, files);

  try {
    const account = await store.createAccount({
      workspaceId: "test-workspace",
      platform: "instagram",
      displayName: "Test account",
    });
    assert.equal(store.listAccounts("test-workspace").length, 1);
    database.prepare("UPDATE social_accounts SET status = 'CONNECTED' WHERE id = ?").run(account.id);

    const request = {
      workspaceId: "test-workspace",
      accountId: account.id,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      originalTimezone: "UTC",
      caption: "Local SQLite test",
      media: [],
      idempotencyKey: "sqlite-test-request",
    };
    const job = store.createPublishingJob(request);
    assert.equal(store.createPublishingJob(request).id, job.id);
    assert.throws(() => store.createPublishingJob(request, "DRY_RUN"), /idempotency key/);
    const validationRequest = { ...request, idempotencyKey: "sqlite-validation-request" };
    store.createPublishingJob(validationRequest, "DRY_RUN", "LOCAL");
    assert.throws(
      () => store.createPublishingJob(validationRequest, "DRY_RUN", "INSTAGRAM_PREVIEW"),
      /idempotency key/,
    );

    const claimed = store.claimDuePublishingJob("worker-a", 60);
    assert.equal(claimed?.id, job.id);
    assert.equal(claimed?.state, "PUBLISHING");
    assert.equal(store.claimDuePublishingJob("worker-b", 60), null);
    assert.throws(
      () => new AutomationLoginStore(database).createOrGetSession("test-workspace", account.id),
      /publishing worker/,
    );
    assert.equal(store.recordPublishingProgress(job.id, "worker-b", claimed!.fencingToken!, "Wrong worker"), false);
    assert.equal(store.recordPublishingProgress(job.id, "worker-a", claimed!.fencingToken!, "Opening test composer"), true);
    assert.equal(store.getPublishingJob("test-workspace", job.id)?.progressMessage, "Opening test composer");
    assert.equal(store.heartbeatPublishingJob(job.id, "worker-a", claimed!.fencingToken!, 60), true);

    const finished = store.finishPublishingJob({
      jobId: job.id,
      workerId: "worker-a",
      fencingToken: claimed!.fencingToken!,
      state: "PUBLISHED",
      platformPostId: "test-post",
    });
    assert.equal(finished.state, "PUBLISHED");
    assert.equal(store.heartbeatPublishingJob(job.id, "worker-a", claimed!.fencingToken!, 60), false);

    const validationClaimed = store.claimDuePublishingJob("validation-worker", 60, "DRY_RUN", "LOCAL");
    assert.equal(validationClaimed?.validationStage, "LOCAL");
    const expiredAt = new Date(0).toISOString();
    database.prepare("UPDATE publishing_jobs SET lease_expires_at = ? WHERE id = ?")
      .run(expiredAt, validationClaimed!.id);
    database.prepare("UPDATE account_execution_locks SET lease_expires_at = ? WHERE account_id = ?")
      .run(expiredAt, account.id);
    const [quarantined] = store.quarantineExpiredPublishingJobs();
    assert.equal(quarantined?.state, "CANCELLED");
    assert.equal(quarantined?.errorCode, "VALIDATION_LEASE_EXPIRED");
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
