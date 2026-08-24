import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadAutomationConfig } from "./config.ts";
import { createAutomationDatabase } from "./database.ts";
import type { PublishingDryRunValidator, ServerPublishingExecutor } from "./executor.ts";
import { InstagramPublishingDryRunValidator } from "./instagram-dry-run.ts";
import { AutomationJobStore } from "./job-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { AutomationPublishingLiveWorker, AutomationPublishingLiveWorkerPool } from "./publishing-live-worker.ts";
import { migrateAutomationSchema } from "./schema.ts";
import { interpretInstagramPublishResponse } from "./instagram-live.ts";

test("Instagram publish responses provide strong success and failure evidence", () => {
  assert.deepEqual(interpretInstagramPublishResponse(200, {
    status: "ok",
    media: { pk: "123456", code: "ABC_123" },
  }), {
    state: "PUBLISHED",
    platformPostId: "123456",
    platformPostUrl: "https://www.instagram.com/p/ABC_123/",
  });
  assert.deepEqual(interpretInstagramPublishResponse(400, {
    status: "fail",
    message: "Please wait a few minutes before trying again.",
  }), {
    state: "FAILED",
    message: "Please wait a few minutes before trying again.",
  });
  assert.equal(interpretInstagramPublishResponse(200, { status: "pending" }), null);
});

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
  assert.doesNotMatch(liveSource, /share\.click\(\{\s*force:/);
  assert.ok(liveSource.indexOf("waitForEnabledShare(page, share, signal)") < liveSource.indexOf("await onFinalActionStarting()"));
  assert.doesNotMatch(previewSource, /share\.click\s*\(/i);
  const originalCrop = previewSource.indexOf('page.getByText(/^Original$/i)');
  const cropNext = previewSource.indexOf("Instagram's crop Next control was not available.");
  assert.ok(originalCrop >= 0, "The shared Instagram flow must select Original crop.");
  assert.ok(cropNext > originalCrop, "Original crop must be selected before the crop Next step.");
});

test("the live worker pool runs different accounts concurrently but serializes each account", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-live-pool-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();
  const database = createAutomationDatabase(config);
  migrateAutomationSchema(database);
  const store = new AutomationJobStore(database, files);
  let releaseExecutions: () => void = () => undefined;
  let run: Promise<unknown[]> | null = null;

  try {
    const accountA = await store.createAccount({
      workspaceId: "pool-workspace",
      platform: "instagram",
      displayName: "Pool account A",
    });
    const accountB = await store.createAccount({
      workspaceId: "pool-workspace",
      platform: "instagram",
      displayName: "Pool account B",
    });
    database.prepare("UPDATE social_accounts SET status = 'CONNECTED' WHERE id IN (?, ?)")
      .run(accountA.id, accountB.id);
    const scheduledAt = new Date(Date.now() - 60_000).toISOString();
    const createJob = (accountId: string, caption: string, idempotencyKey: string) => store.createPublishingJob({
      workspaceId: "pool-workspace",
      accountId,
      scheduledAt,
      originalTimezone: "UTC",
      caption,
      media: [],
      idempotencyKey,
    }, "LIVE", "LOCAL", true);
    createJob(accountA.id, "Account A first", "pool-account-a-first");
    createJob(accountA.id, "Account A second", "pool-account-a-second");
    createJob(accountB.id, "Account B first", "pool-account-b-first");

    const validator: PublishingDryRunValidator = {
      platform: "instagram",
      async validate() {
        return { valid: true, checks: ["fake pool preflight"], issues: [] };
      },
    };
    let activeExecutions = 0;
    let maximumActiveExecutions = 0;
    const activeByAccount = new Map<string, number>();
    const maximumByAccount = new Map<string, number>();
    const enteredAccounts = new Set<string>();
    let signalBothStarted: () => void = () => undefined;
    const bothStarted = new Promise<void>(resolve => { signalBothStarted = resolve; });
    const executionRelease = new Promise<void>(resolve => { releaseExecutions = resolve; });
    const executor: ServerPublishingExecutor = {
      platform: "instagram",
      async publish(job, _signal, onFinalActionStarting) {
        await onFinalActionStarting();
        activeExecutions += 1;
        maximumActiveExecutions = Math.max(maximumActiveExecutions, activeExecutions);
        const accountActive = (activeByAccount.get(job.accountId) || 0) + 1;
        activeByAccount.set(job.accountId, accountActive);
        maximumByAccount.set(job.accountId, Math.max(maximumByAccount.get(job.accountId) || 0, accountActive));
        enteredAccounts.add(job.accountId);
        if (enteredAccounts.size === 2) signalBothStarted();
        await executionRelease;
        activeExecutions -= 1;
        activeByAccount.set(job.accountId, accountActive - 1);
        return { state: "PUBLISHED" };
      },
    };
    const pool = new AutomationPublishingLiveWorkerPool(
      store,
      new Map([["instagram", validator]]),
      new Map([["instagram", executor]]),
      1_000,
      3,
    );
    assert.equal(pool.size, 3);
    run = pool.runOnce();
    await Promise.race([
      bothStarted,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Two accounts did not start concurrently.")), 2_000)),
    ]);
    assert.deepEqual(enteredAccounts, new Set([accountA.id, accountB.id]));
    assert.equal(maximumActiveExecutions, 2);
    assert.equal(maximumByAccount.get(accountA.id), 1);
    assert.equal(maximumByAccount.get(accountB.id), 1);
    assert.equal(
      store.listPublishingJobs("pool-workspace").filter(job => job.accountId === accountA.id && job.state === "SCHEDULED").length,
      1,
    );

    releaseExecutions();
    const results = await run;
    assert.equal(results.filter(result => (result as { state?: string } | null)?.state === "PUBLISHED").length, 2);
    assert.equal(results.filter(result => result === null).length, 1);
    await pool.stop();
  } finally {
    releaseExecutions();
    await run?.catch(() => undefined);
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
