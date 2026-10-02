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
