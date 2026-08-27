import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadAutomationConfig } from "./config.ts";
import { createAutomationDatabase } from "./database.ts";
import { InstagramPublishingDryRunValidator } from "./instagram-dry-run.ts";
import { prepareInstagramMedia } from "./instagram-media.ts";
import { FacebookPublishingDryRunValidator } from "./facebook-dry-run.ts";
import { XPublishingDryRunValidator } from "./x-dry-run.ts";
import { LinkedInPublishingDryRunValidator } from "./linkedin-dry-run.ts";
import { YouTubePublishingDryRunValidator } from "./youtube-dry-run.ts";
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
    const wideImageCompleted = await worker.runOnce();
    assert.equal(wideImageCompleted?.state, "CANCELLED");
    assert.equal(wideImageCompleted?.errorCode, "DRY_RUN_COMPLETE");

    const webpStorageKey = "media_instagram_webp_test.webp";
    await sharp({ create: { width: 776, height: 370, channels: 3, background: "#167552" } })
      .webp()
      .toFile(files.mediaFilePath(webpStorageKey));
    store.createPublishingJob({
      ...job,
      id: undefined,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      media: [{ storageKey: webpStorageKey, fileName: "wide.webp", mimeType: "image/webp" }],
      idempotencyKey: "dry-run-validation-webp-001",
    }, "DRY_RUN");
    const webpCompleted = await worker.runOnce();
    assert.equal(webpCompleted?.state, "CANCELLED");
    assert.equal(webpCompleted?.errorCode, "DRY_RUN_COMPLETE");
  } finally {
    await worker.stop();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Instagram preserves compliant originals and pads out-of-range images without cropping", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-instagram-media-"));
  const files = new AutomationFileStore(directory);
  await files.initialize();
  try {
    const wideKey = "media_wide.webp";
    const tallKey = "media_tall.tiff";
    const squareKey = "media_square.jpg";
    await sharp({ create: { width: 776, height: 370, channels: 3, background: "#167552" } })
      .webp()
      .toFile(files.mediaFilePath(wideKey));
    await sharp({ create: { width: 300, height: 900, channels: 3, background: "#0a66c2" } })
      .tiff()
      .toFile(files.mediaFilePath(tallKey));
    await sharp({ create: { width: 1_000, height: 1_000, channels: 3, background: "#b42318" } })
      .jpeg()
      .toFile(files.mediaFilePath(squareKey));

    const media = {
      media: [
        { storageKey: wideKey, fileName: "wide.webp", mimeType: "image/webp" },
        { storageKey: tallKey, fileName: "tall.tiff", mimeType: "image/tiff" },
        { storageKey: squareKey, fileName: "square.jpg", mimeType: "image/jpeg" },
      ],
    };
    const prepared = await prepareInstagramMedia(files, media);
    assert.equal(prepared.normalizedImages, 2);
    assert.equal(prepared.paths[2], files.mediaFilePath(squareKey));
    const [wide, tall] = await Promise.all(prepared.paths.slice(0, 2).map(filePath => sharp(filePath).metadata()));
    assert.equal(wide.format, "jpeg");
    assert.ok((wide.width || 0) / (wide.height || 1) <= 1.91);
    assert.equal(tall.format, "jpeg");
    assert.ok((tall.width || 0) / (tall.height || 1) >= 0.8);
    const temporaryDirectory = path.dirname(prepared.paths[0]!);
    await prepared.cleanup();
    await assert.rejects(access(temporaryDirectory));
  } finally {
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
      platformOptions: {},
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
      platformOptions: {},
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

test("the LinkedIn dry-run accepts text and one supported media file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-linkedin-dry-run-"));
  const files = new AutomationFileStore(directory);
  await files.initialize();
  try {
    const storageKey = "linkedin-test.png";
    await sharp({ create: { width: 640, height: 640, channels: 3, background: "#0a66c2" } })
      .png()
      .toFile(files.mediaFilePath(storageKey));
    const validator = new LinkedInPublishingDryRunValidator(files);
    const base = {
      id: "job_linkedin_dry_run",
      workspaceId: "linkedin-workspace",
      accountId: "account_linkedin_dry_run",
      platform: "linkedin" as const,
      executionMode: "DRY_RUN" as const,
      validationStage: "LOCAL" as const,
      caption: "Safe LinkedIn post",
      media: [{ storageKey, fileName: "post.png", mimeType: "image/png" }],
      platformOptions: {},
      fencingToken: 1,
    };
    const profile = { version: 1, lastSavedAt: new Date().toISOString() };
    assert.equal((await validator.validate(base, profile, new AbortController().signal)).valid, true);
    const tooMany = await validator.validate({ ...base, media: [...base.media, ...base.media] }, profile, new AbortController().signal);
    assert.equal(tooMany.valid, false);
    assert.match(tooMany.issues.join(" "), /at most one media file/);
    const tooLong = await validator.validate({ ...base, caption: "x".repeat(3_001) }, profile, new AbortController().signal);
    assert.equal(tooLong.valid, false);
    assert.match(tooLong.issues.join(" "), /3,000 characters/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the YouTube dry-run requires explicit video audience and visibility", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-youtube-dry-run-"));
  const files = new AutomationFileStore(directory);
  await files.initialize();
  try {
    const storageKey = "youtube-test.mp4";
    await writeFile(files.mediaFilePath(storageKey), Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    ]));
    const validator = new YouTubePublishingDryRunValidator(files);
    const base = {
      id: "job_youtube_dry_run",
      workspaceId: "youtube-workspace",
      accountId: "account_youtube_dry_run",
      platform: "youtube" as const,
      executionMode: "DRY_RUN" as const,
      validationStage: "LOCAL" as const,
      caption: "Safe YouTube video description",
      media: [{ storageKey, fileName: "video.mp4", mimeType: "video/mp4" }],
      platformOptions: {},
      fencingToken: 1,
    };
    const profile = { version: 1, lastSavedAt: new Date().toISOString() };
    const missing = await validator.validate(base, profile, new AbortController().signal);
    assert.equal(missing.valid, false);
    assert.match(missing.issues.join(" "), /explicit title, audience classification, and visibility/);
    const explicit = await validator.validate({
      ...base,
      platformOptions: { youtube: { title: "Safe title", audience: "not_made_for_kids", visibility: "private" } },
    }, profile, new AbortController().signal);
    assert.equal(explicit.valid, true);
    assert.match(explicit.checks.join(" "), /explicitly set to private/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
