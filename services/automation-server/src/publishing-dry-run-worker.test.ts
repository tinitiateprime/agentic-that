import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadAutomationConfig } from "./config.ts";
import { createAutomationDatabase } from "./database.ts";
import { InstagramPublishingDryRunValidator } from "./instagram-dry-run.ts";
import { FacebookPublishingDryRunValidator } from "./facebook-dry-run.ts";
import { XPublishingDryRunValidator } from "./x-dry-run.ts";
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

    store.createPublishingJob({
      ...job,
      id: undefined,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      media: [
        { storageKey, fileName: "carousel-1.jpg", mimeType: "image/jpeg" },
        { storageKey, fileName: "carousel-2.jpg", mimeType: "image/jpeg" },
      ],
      idempotencyKey: "dry-run-validation-carousel-001",
    }, "DRY_RUN");
    const carouselCompleted = await worker.runOnce();
    assert.equal(carouselCompleted?.state, "CANCELLED");
    assert.equal(carouselCompleted?.errorCode, "DRY_RUN_COMPLETE");

    const videoStorageKey = "media_dry_run_test.mp4";
    await writeFile(files.mediaFilePath(videoStorageKey), Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    ]));
    store.createPublishingJob({
      ...job,
      id: undefined,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      media: [{ storageKey: videoStorageKey, fileName: "reel.mp4", mimeType: "video/mp4" }],
      idempotencyKey: "dry-run-validation-video-001",
    }, "DRY_RUN");
    const videoCompleted = await worker.runOnce();
    assert.equal(videoCompleted?.state, "CANCELLED");
    assert.equal(videoCompleted?.errorCode, "DRY_RUN_COMPLETE");

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

test("the Facebook dry-run accepts text-only posts with a saved session", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-facebook-dry-run-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();
  const database = createAutomationDatabase(config);
  migrateAutomationSchema(database);
  const store = new AutomationJobStore(database, files);
  const worker = new AutomationPublishingDryRunWorker(
    store,
    new Map([["facebook", new FacebookPublishingDryRunValidator(files)]]),
    1_000,
    "facebook_dryrun_test_worker",
  );
  try {
    const account = await store.createAccount({ workspaceId: "facebook-workspace", platform: "facebook", displayName: "Facebook test" });
    const connectedAt = new Date().toISOString();
    database.prepare("UPDATE social_accounts SET status = 'CONNECTED', updated_at = ? WHERE id = ?").run(connectedAt, account.id);
    database.prepare("UPDATE browser_profiles SET version = 1, last_saved_at = ?, updated_at = ? WHERE account_id = ?").run(connectedAt, connectedAt, account.id);
    store.createPublishingJob({
      workspaceId: "facebook-workspace",
      accountId: account.id,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      originalTimezone: "UTC",
      caption: "Safe Facebook text post",
      media: [],
      idempotencyKey: "facebook-text-dry-run-001",
    }, "DRY_RUN");
    const completed = await worker.runOnce();
    assert.equal(completed?.state, "CANCELLED");
    assert.equal(completed?.errorCode, "DRY_RUN_COMPLETE");
  } finally {
    await worker.stop();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the X dry-run accepts bounded text and rejects over-limit text", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-x-dry-run-"));
  const files = new AutomationFileStore(directory);
  await files.initialize();
  try {
    const validator = new XPublishingDryRunValidator(files);
    const base = {
      id: "job_x_dry_run",
      workspaceId: "x-workspace",
      accountId: "account_x_dry_run",
      platform: "x" as const,
      executionMode: "DRY_RUN" as const,
      validationStage: "LOCAL" as const,
      caption: "Safe X text post",
      media: [],
      fencingToken: 1,
    };
    const profile = { version: 1, lastSavedAt: new Date().toISOString() };
    assert.equal((await validator.validate(base, profile, new AbortController().signal)).valid, true);
    const rejected = await validator.validate({ ...base, caption: "x".repeat(281) }, profile, new AbortController().signal);
    assert.equal(rejected.valid, false);
    assert.match(rejected.issues.join(" "), /280 characters/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
