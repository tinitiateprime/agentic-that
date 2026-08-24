import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadAutomationConfig } from "./config.ts";
import { createAutomationDatabase } from "./database.ts";
import { InstagramPublishingDryRunValidator } from "./instagram-dry-run.ts";
import { AutomationJobStore } from "./job-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { AutomationPublishingDryRunWorker } from "./publishing-dry-run-worker.ts";
import { migrateAutomationSchema } from "./schema.ts";

test("the Instagram dry-run worker validates and cancels a job without publishing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-dry-run-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();
  const database = createAutomationDatabase(config);
  migrateAutomationSchema(database);
  const store = new AutomationJobStore(database, files);
  const worker = new AutomationPublishingDryRunWorker(
    store,
    new Map([["instagram", new InstagramPublishingDryRunValidator(files)]]),
    1_000,
    "dryrun_test_worker",
  );

  try {
    const account = await store.createAccount({
      workspaceId: "dry-run-workspace",
      platform: "instagram",
      displayName: "Dry-run Instagram",
    });
    const connectedAt = new Date().toISOString();
    database.prepare("UPDATE social_accounts SET status = 'CONNECTED', updated_at = ? WHERE id = ?")
      .run(connectedAt, account.id);
    database.prepare(`
      UPDATE browser_profiles SET version = 1, last_saved_at = ?, updated_at = ? WHERE account_id = ?
    `).run(connectedAt, connectedAt, account.id);
    const storageKey = "media_dry_run_test.jpg";
    await sharp({ create: { width: 640, height: 640, channels: 3, background: "#167552" } })
      .jpeg()
      .toFile(files.mediaFilePath(storageKey));
    const job = store.createPublishingJob({
      workspaceId: "dry-run-workspace",
      accountId: account.id,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      originalTimezone: "UTC",
      caption: "Safe local dry run",
      media: [{ storageKey, fileName: "test.jpg", mimeType: "image/jpeg" }],
      idempotencyKey: "dry-run-validation-001",
    }, "DRY_RUN");
    assert.equal(job.executionMode, "DRY_RUN");

    const completed = await worker.runOnce();
    assert.equal(completed?.state, "CANCELLED");
    assert.equal(completed?.errorCode, "DRY_RUN_COMPLETE");
    assert.equal(completed?.platformPostId, null);
    const attempt = database.prepare(`
      SELECT state, detail FROM publishing_attempts WHERE job_id = ?
    `).get(job.id) as { state: string; detail: string };
    assert.equal(attempt.state, "DRY_RUN_COMPLETE");
    assert.deepEqual(JSON.parse(attempt.detail).published, false);
    assert.deepEqual(JSON.parse(attempt.detail).networkAccess, false);

    const wideStorageKey = "media_too_wide_test.png";
    await sharp({ create: { width: 1900, height: 867, channels: 3, background: "#167552" } })
      .png()
      .toFile(files.mediaFilePath(wideStorageKey));
    store.createPublishingJob({
      ...job,
      id: undefined,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      media: [{ storageKey: wideStorageKey, fileName: "too-wide.png", mimeType: "image/png" }],
      idempotencyKey: "dry-run-validation-too-wide-001",
    }, "DRY_RUN");
    const rejected = await worker.runOnce();
    assert.equal(rejected?.errorCode, "DRY_RUN_VALIDATION_FAILED");
    assert.match(rejected?.errorMessage || "", /1900x867 \(2\.19:1\).*1\.91:1 or narrower/);
  } finally {
    await worker.stop();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
