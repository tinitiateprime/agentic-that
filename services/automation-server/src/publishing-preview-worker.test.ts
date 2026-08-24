import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadAutomationConfig } from "./config.ts";
import { createAutomationDatabase } from "./database.ts";
import type { PublishingPreviewExecutor } from "./executor.ts";
import { InstagramPublishingDryRunValidator } from "./instagram-dry-run.ts";
import { InstagramPreviewPreparationError } from "./instagram-preview.ts";
import { AutomationJobStore } from "./job-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { AutomationPublishingDryRunWorker } from "./publishing-dry-run-worker.ts";
import { AutomationPublishingPreviewWorker } from "./publishing-preview-worker.ts";
import { migrateAutomationSchema } from "./schema.ts";

test("the Instagram preview worker is isolated from local dry-runs and can never publish", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-preview-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();
  const database = createAutomationDatabase(config);
  migrateAutomationSchema(database);
  const store = new AutomationJobStore(database, files);
  const validator = new InstagramPublishingDryRunValidator(files);
  const screenshot = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#173f35" },
  }).jpeg().toBuffer();
  let prepared = 0;
  const executor: PublishingPreviewExecutor = {
    platform: "instagram",
    async prepare(job, _signal, reportProgress) {
      prepared += 1;
      reportProgress?.("Fake Instagram composer progress");
      assert.equal(
        store.getPublishingJob(job.workspaceId, job.id)?.progressMessage,
        "Fake Instagram composer progress",
      );
      if (job.caption === "Diagnostic failure") {
        throw new InstagramPreviewPreparationError("Fake Instagram stage failed.", screenshot);
      }
      return { screenshot, checks: ["Fake final composer reached without a final action."] };
    },
  };
  const dryRunWorker = new AutomationPublishingDryRunWorker(
    store,
    new Map([["instagram", validator]]),
    1_000,
    "dryrun_isolation_worker",
  );
  const previewWorker = new AutomationPublishingPreviewWorker(
    store,
    files,
    new Map([["instagram", validator]]),
    new Map([["instagram", executor]]),
    1_000,
    "preview_test_worker",
  );

  try {
    const account = await store.createAccount({
      workspaceId: "preview-workspace",
      platform: "instagram",
      displayName: "Preview Instagram",
    });
    const connectedAt = new Date().toISOString();
    database.prepare("UPDATE social_accounts SET status = 'CONNECTED', updated_at = ? WHERE id = ?")
      .run(connectedAt, account.id);
    database.prepare(`
      UPDATE browser_profiles SET version = 1, last_saved_at = ?, updated_at = ? WHERE account_id = ?
    `).run(connectedAt, connectedAt, account.id);
    const storageKey = "media_preview_test.jpg";
    await sharp({ create: { width: 640, height: 640, channels: 3, background: "#167552" } })
      .jpeg()
      .toFile(files.mediaFilePath(storageKey));
    const job = store.createPublishingJob({
      workspaceId: "preview-workspace",
      accountId: account.id,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      originalTimezone: "UTC",
      caption: "Private Instagram composer preview",
      media: [{ storageKey, fileName: "preview.jpg", mimeType: "image/jpeg" }],
      idempotencyKey: "instagram-preview-validation-001",
    }, "DRY_RUN", "INSTAGRAM_PREVIEW");
    assert.equal(job.validationStage, "INSTAGRAM_PREVIEW");
    assert.equal(await dryRunWorker.runOnce(), null);

    const completed = await previewWorker.runOnce();
    assert.equal(prepared, 1);
    assert.equal(completed?.state, "CANCELLED");
    assert.equal(completed?.errorCode, "PREVIEW_COMPLETE");
    assert.equal(completed?.platformPostId, null);
    assert.deepEqual(await files.readPublishingPreview(job.id), screenshot);
    const attempt = database.prepare(`
      SELECT state, detail FROM publishing_attempts WHERE job_id = ?
    `).get(job.id) as { state: string; detail: string };
    const detail = JSON.parse(attempt.detail);
    assert.equal(attempt.state, "PREVIEW_COMPLETE");
    assert.equal(detail.networkAccess, true);
    assert.equal(detail.finalShareClicked, false);
    assert.equal(detail.published, false);

    const failedJob = store.createPublishingJob({
      workspaceId: "preview-workspace",
      accountId: account.id,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      originalTimezone: "UTC",
      caption: "Diagnostic failure",
      media: [{ storageKey, fileName: "preview.jpg", mimeType: "image/jpeg" }],
      idempotencyKey: "instagram-preview-diagnostic-002",
    }, "DRY_RUN", "INSTAGRAM_PREVIEW");
    const failed = await previewWorker.runOnce();
    assert.equal(failed?.id, failedJob.id);
    assert.equal(failed?.errorCode, "PREVIEW_FAILED");
    assert.match(failed?.errorMessage || "", /Fake Instagram stage failed/);
    assert.deepEqual(await files.readPublishingPreview(failedJob.id), screenshot);
  } finally {
    await previewWorker.stop();
    await dryRunWorker.stop();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the Playwright preview implementation contains no Share click or publish call", async () => {
  const source = await readFile(new URL("./instagram-preview.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bshare\s*\.\s*click\s*\(/i);
  assert.doesNotMatch(source, /\.publish\s*\(/i);
  assert.equal(source.match(/\.click\s*\(/g)?.length, 1, "Every preview click must pass through safePreviewClick.");
  assert.match(source, /refused Instagram's Share control/);
  assert.match(source, /150_000/);
  assert.match(source, /never clicks Share/i);
});
