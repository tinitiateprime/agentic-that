import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AutomationFileStore } from "./profile-store.ts";

test("account profile paths are opaque and remain inside the data directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenticthat-server-store-"));
  try {
    const store = new AutomationFileStore(root);
    await store.initialize();
    const directory = await store.ensureDevelopmentProfile("../../customer@example.com");
    assert.equal(path.dirname(directory), store.profilesRoot);
    assert.match(path.basename(directory), /^profile_[a-f0-9]{32}$/);
    assert.equal(directory.includes("customer@example.com"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("temporary scraping storage is removable without touching its root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenticthat-server-store-"));
  try {
    const store = new AutomationFileStore(root);
    await store.initialize();
    const temporary = await store.createTemporaryScrapingDirectory();
    await store.removeTemporaryDirectory(temporary);
    await assert.rejects(access(temporary));
    await assert.rejects(() => store.removeTemporaryDirectory(store.temporaryRoot), /Refusing to remove/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("media storage keys cannot escape the isolated media directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-media-"));
  try {
    const store = new AutomationFileStore(directory);
    await store.initialize();
    assert.equal(store.mediaFilePath("media_test.jpg"), path.join(directory, "media", "media_test.jpg"));
    assert.throws(() => store.mediaFilePath("../production.jpg"), /invalid/);
    assert.throws(() => store.mediaFilePath("folder/file.jpg"), /invalid/);
    const saved = await store.storeDevelopmentMedia(Buffer.from([0xff, 0xd8, 0xff]), "test.jpg", "image/jpeg");
    assert.match(saved.storageKey, /^media_[a-f0-9]{32}[.]jpg$/);
    assert.deepEqual(await readFile(store.mediaFilePath(saved.storageKey)), Buffer.from([0xff, 0xd8, 0xff]));
    await assert.rejects(
      () => store.storeDevelopmentMedia(Buffer.from("bad"), "bad.exe", "application/octet-stream"),
      /not supported/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("publishing preview screenshots use opaque job-scoped result paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-preview-files-"));
  const files = new AutomationFileStore(directory);
  try {
    await files.initialize();
    const screenshot = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const key = await files.storePublishingPreview("job_preview_test", screenshot);
    assert.match(key, /^preview_[a-f0-9]{32}\.jpg$/);
    assert.deepEqual(await files.readPublishingPreview("job_preview_test"), screenshot);
    assert.equal(files.publishingPreviewPath("job_preview_test").startsWith(files.resultsRoot), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
