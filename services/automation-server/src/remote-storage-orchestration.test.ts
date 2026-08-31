import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AutomationFileStore } from "./profile-store.ts";
import type { AutomationRemoteStorage, RemoteProfileVersion } from "./remote-storage.ts";

class FakeRemoteStorage implements AutomationRemoteStorage {
  profile: RemoteProfileVersion = { version: 2, etag: "etag-2" };

  async assertReady() {}
  async restoreProfile(_workspaceId: string, _accountId: string, _storageKey: string, targetDirectory: string) {
    await mkdir(path.join(targetDirectory, "Default"), { recursive: true });
    await writeFile(path.join(targetDirectory, "Default", "Cookies"), "encrypted-remote-session");
    return { ...this.profile };
  }
  async saveProfile(
    _workspaceId: string,
    _accountId: string,
    _storageKey: string,
    _sourceDirectory: string,
    expected: RemoteProfileVersion,
  ) {
    if (expected.version !== this.profile.version || expected.etag !== this.profile.etag) {
      throw new Error("profile version conflict");
    }
    this.profile = { version: expected.version + 1, etag: `etag-${expected.version + 1}` };
    return { ...this.profile };
  }
  async removeProfile() {}
  async uploadMedia(_workspaceId: string, _storageKey: string, _sourceFile: string, _mimeType: string) {}
  async downloadMedia(_workspaceId: string, _storageKey: string, destinationFile: string) {
    await writeFile(destinationFile, "remote-media");
  }
  async uploadArtifact() {}
  async downloadArtifact(_workspaceId: string, _storageKey: string, destinationFile: string) {
    await writeFile(destinationFile, "remote-artifact");
  }
}

test("remote profiles are version-checked, persisted conditionally, and removed from temporary disk", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-remote-profile-"));
  const remote = new FakeRemoteStorage();
  const files = new AutomationFileStore(directory, 16 * 1024 * 1024, remote);
  try {
    await files.initialize();
    const profile = await files.prepareProfile("workspace-one", "account-one", 2);
    assert.equal(await readFile(path.join(profile, "Default", "Cookies"), "utf8"), "encrypted-remote-session");
    assert.deepEqual(await files.persistProfile("workspace-one", "account-one"), { version: 3, etag: "etag-3" });
    await files.discardPreparedProfile("account-one");
    await assert.rejects(readFile(path.join(profile, "Default", "Cookies")));

    await files.prepareProfile("workspace-one", "account-one", 3);
    remote.profile = { version: 4, etag: "etag-4" };
    await assert.rejects(files.persistProfile("workspace-one", "account-one"), /version conflict/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("remote media hydration remains workspace-scoped through the storage interface", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-remote-media-"));
  const remote = new FakeRemoteStorage();
  const files = new AutomationFileStore(directory, 16 * 1024 * 1024, remote);
  try {
    await files.initialize();
    await files.prepareJobFiles("workspace-one", "account-one", [{ storageKey: "media_remote.jpg" }], 2);
    assert.equal(await readFile(files.mediaFilePath("media_remote.jpg"), "utf8"), "remote-media");
    await files.discardPreparedProfile("account-one");
    await assert.rejects(readFile(files.mediaFilePath("media_remote.jpg")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
