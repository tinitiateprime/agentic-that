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

    const claimed = store.claimDuePublishingJob("worker-a", 60);
    assert.equal(claimed?.id, job.id);
    assert.equal(claimed?.state, "PUBLISHING");
    assert.equal(store.claimDuePublishingJob("worker-b", 60), null);
    assert.throws(
      () => new AutomationLoginStore(database).createOrGetSession("test-workspace", account.id),
      /publishing worker/,
    );
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
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
