import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TelegramMediaStore } from "./media-store.ts";

test("device media is uploaded in ordered private chunks and remains account scoped", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agenticthat-telegram-media-store-"));
  const store = new TelegramMediaStore(dataDir, 1024);
  try {
    await store.initialize();
    const created = await store.create("owner-one", "account-one", {
      fileName: "demo video.mp4",
      mimeType: "video/mp4",
      size: 11,
    });
    assert.equal(created.offset, 0);
    await assert.rejects(store.append("owner-two", "account-one", created.id, 0, Buffer.from("bad")), /not found/);
    await store.append("owner-one", "account-one", created.id, 0, Buffer.from("video-"));
    await assert.rejects(store.append("owner-one", "account-one", created.id, 0, Buffer.from("bad")), /offset/);
    await store.append("owner-one", "account-one", created.id, 6, Buffer.from("bytes"));
    const completed = await store.complete("owner-one", "account-one", created.id);
    assert.ok(completed.completedAt);
    const resolved = await store.resolve("owner-one", "account-one", created.id);
    assert.equal(await readFile(resolved.path, "utf8"), "video-bytes");
    assert.equal((await stat(resolved.path)).mode & 0o777, 0o600);
    await assert.rejects(store.resolve("owner-one", "account-two", created.id), /not found/);
    await store.remove("owner-one", "account-one", created.id);
    await assert.rejects(store.resolve("owner-one", "account-one", created.id), /not found/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("device media size is bounded before storage is allocated", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agenticthat-telegram-media-store-"));
  const store = new TelegramMediaStore(dataDir, 10);
  try {
    await store.initialize();
    await assert.rejects(store.create("owner", "account", {
      fileName: "too-large.mp4",
      mimeType: "video/mp4",
      size: 11,
    }), /between 1 byte and 10 bytes/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
