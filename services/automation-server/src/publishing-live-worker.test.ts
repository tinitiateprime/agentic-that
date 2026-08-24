import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadAutomationConfig } from "./config.ts";
import { createAutomationDatabase } from "./database.ts";
import type { ServerPublishingExecutor } from "./executor.ts";
import { InstagramPublishingDryRunValidator } from "./instagram-dry-run.ts";
import { AutomationJobStore } from "./job-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { AutomationPublishingLiveWorker } from "./publishing-live-worker.ts";
import { migrateAutomationSchema } from "./schema.ts";

test("the live worker requires authorization and fences Instagram's final action", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-live-publishing-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();
  const database = createAutomationDatabase(config);
  migrateAutomationSchema(database);
  const store = new AutomationJobStore(database, files);
  let finalActions = 0;
  const executor: ServerPublishingExecutor = {
    platform: "instagram",
    async publish(job, _signal, onFinalActionStarting, reportProgress) {
      assert.equal(job.executionMode, "LIVE");
      assert.equal(job.validationStage, "LOCAL");
      reportProgress?.("Fake final composer ready.");
      if (job.caption === "Missing final fence") return { state: "PUBLISHED" };
      await onFinalActionStarting();
      finalActions += 1;
      assert.equal(store.getPublishingJob(job.workspaceId, job.id)?.state, "VERIFYING");
      if (job.caption === "Uncertain after final action") throw new Error("Fake confirmation was unavailable.");
      return { state: "PUBLISHED" };
    },
  };
  const worker = new AutomationPublishingLiveWorker(
    store,
    new Map([["instagram", new InstagramPublishingDryRunValidator(files)]]),
    new Map([["instagram", executor]]),
    1_000,
    "live_test_worker",
  );

  try {
    const account = await store.createAccount({
      workspaceId: "live-workspace",
      platform: "instagram",
      displayName: "Live test Instagram",
    });
    const connectedAt = new Date().toISOString();
    database.prepare("UPDATE social_accounts SET status = 'CONNECTED', updated_at = ? WHERE id = ?")
      .run(connectedAt, account.id);
    database.prepare(`
      UPDATE browser_profiles SET version = 1, last_saved_at = ?, updated_at = ? WHERE account_id = ?
    `).run(connectedAt, connectedAt, account.id);
    const storageKey = "media_live_test.jpg";
    await sharp({ create: { width: 640, height: 640, channels: 3, background: "#167552" } })
      .jpeg()
      .toFile(files.mediaFilePath(storageKey));
    const request = {
      workspaceId: "live-workspace",
      accountId: account.id,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      originalTimezone: "UTC",
      caption: "Authorized live test",
      media: [{ storageKey, fileName: "live.jpg", mimeType: "image/jpeg" }],
      idempotencyKey: "authorized-live-publishing-001",
    };
    assert.throws(() => store.createPublishingJob(request), /explicit final-action authorization/);
    const job = store.createPublishingJob(request, "LIVE", "LOCAL", true);
    assert.equal(job.liveAuthorized, true);

    const completed = await worker.runOnce();
    assert.equal(finalActions, 1);
    assert.equal(completed?.state, "PUBLISHED");
    const finalActionEvent = database.prepare(`
      SELECT event_type FROM job_events WHERE job_id = ? AND event_type = 'final_action_starting'
    `).get(job.id) as { event_type: string } | undefined;
    assert.equal(finalActionEvent?.event_type, "final_action_starting");

    const uncertainJob = store.createPublishingJob({
      ...request,
      caption: "Uncertain after final action",
      idempotencyKey: "authorized-live-publishing-002",
    }, "LIVE", "LOCAL", true);
    const uncertain = await worker.runOnce();
    assert.equal(uncertain?.id, uncertainJob.id);
    assert.equal(uncertain?.state, "UNCERTAIN");
    assert.equal(uncertain?.errorCode, "LIVE_RESULT_UNCERTAIN");
    assert.equal(finalActions, 2);

    const unfencedJob = store.createPublishingJob({
      ...request,
      caption: "Missing final fence",
      idempotencyKey: "authorized-live-publishing-003",
    }, "LIVE", "LOCAL", true);
    const unfenced = await worker.runOnce();
    assert.equal(unfenced?.id, unfencedJob.id);
    assert.equal(unfenced?.state, "FAILED");
    assert.equal(unfenced?.errorCode, "LIVE_FINAL_ACTION_NOT_RECORDED");
    assert.equal(finalActions, 2);
  } finally {
    await worker.stop();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the live Playwright executor has one exact guarded Share click", async () => {
  const liveSource = await readFile(new URL("./instagram-live.ts", import.meta.url), "utf8");
  const previewSource = await readFile(new URL("./instagram-preview.ts", import.meta.url), "utf8");
  assert.equal(liveSource.match(/share\.click\s*\(/g)?.length, 1);
  assert.match(liveSource, /exact Share-label guard/);
  assert.doesNotMatch(previewSource, /share\.click\s*\(/i);
  const originalCrop = previewSource.indexOf('page.getByText(/^Original$/i)');
  const cropNext = previewSource.indexOf("Instagram's crop Next control was not available.");
  assert.ok(originalCrop >= 0, "The shared Instagram flow must select Original crop.");
  assert.ok(cropNext > originalCrop, "Original crop must be selected before the crop Next step.");
});
