import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
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
