import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { WorkspaceScrapeStore } from "./workspace-scrape-store.ts";
import { DurableDocumentStore } from "./durable-document-store.ts";

test("separate scraper instances preserve concurrent jobs, isolate workspaces and claim each job once", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aws-scraper-test-"));
  try {
    const owner = new WorkspaceScrapeStore("test", directory, "workspace-a");
    const second = new WorkspaceScrapeStore("test", directory, "workspace-a");
    const outsider = new WorkspaceScrapeStore("test", directory, "workspace-b");
    const [first, other] = await Promise.all([owner.createJob({ query: "one" }), second.createJob({ query: "two" })]);
    assert.ok(await second.getJob(first.id));
    assert.ok(await owner.getJob(other.id));
    assert.equal(await outsider.getJob(first.id), null);
    const claims = await Promise.all([owner.claimJob(first.id), second.claimJob(first.id)]);
    assert.equal(claims.filter(Boolean).length, 1);
    const run = await owner.saveRun({});
    assert.ok(await second.getRun(run.id));
    assert.equal(await outsider.getRun(run.id), null);
    await owner.updateJob(first.id, { status: "complete" });
    assert.equal(await second.claimJob(first.id), null);
  } finally {
    assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test("a corrupt local document is reported and never replaced with empty data", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aws-document-test-"));
  try {
    const file = path.join(directory, "store.json");
    await writeFile(file, "broken JSON");
    const store = new DurableDocumentStore("test", file, () => ({ count: 0 }), value => value as { count: number });
    await assert.rejects(store.mutate(document => { document.count++; }), SyntaxError);
  } finally {
    assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});
