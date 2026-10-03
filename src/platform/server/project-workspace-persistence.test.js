import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { restoreProjectWorkspace, safeLocalPath, snapshotProjectWorkspace } from "./project-workspace-persistence.js";

test("project snapshots round-trip encrypted and binary files across fresh temporary directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aws-project-test-"));
  try {
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await mkdir(path.join(source, "tenant"), { recursive: true });
    const bytes = Buffer.from([0, 255, 18, 160]);
    await writeFile(path.join(source, "tenant", "credentials.bin"), bytes);
    const snapshot = await snapshotProjectWorkspace(source);
    await restoreProjectWorkspace(target, snapshot);
    assert.deepEqual(await readFile(path.join(target, "tenant", "credentials.bin")), bytes);
    assert.deepEqual(await snapshotProjectWorkspace(target), snapshot);
    for (const name of ["../outside", "tenant/../../outside", "/absolute", "C:\\outside", "tenant/./file"]) assert.throws(() => safeLocalPath(target, name));
  } finally {
    assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

test("the embedded project module retains its generated key and encrypted GitHub token after a cold start", async () => {
  const { CredentialStore } = await import(new URL("./credential-store.js", import.meta.resolve("@project-workspace/embedded/server")));
  const originals = { project: process.env.PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY, legacy: process.env.TOKEN_ENCRYPTION_KEY };
  delete process.env.PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY;
  delete process.env.TOKEN_ENCRYPTION_KEY;
  const root = await mkdtemp(path.join(os.tmpdir(), "aws-project-key-test-"));
  try {
    const source = path.join(root, "first");
    const target = path.join(root, "cold-start");
    await mkdir(source);
    const first = new CredentialStore(source);
    await first.initialize();
    await first.set("repository", "test-github-token");
    const files = await snapshotProjectWorkspace(source);
    assert.ok(files["token-encryption.key"]);
    assert.equal(JSON.stringify(files).includes("test-github-token"), false);
    await restoreProjectWorkspace(target, files);
    const second = new CredentialStore(target);
    await second.initialize();
    assert.equal(await second.get("repository"), "test-github-token");
    assert.equal((await snapshotProjectWorkspace(target))["token-encryption.key"], files["token-encryption.key"]);
  } finally {
    for (const [name, value] of [["PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY", originals.project], ["TOKEN_ENCRYPTION_KEY", originals.legacy]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});
