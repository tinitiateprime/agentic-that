import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";
import { createAutomationDatabase } from "./database.ts";
import { AutomationJobStore } from "./job-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { migrateAutomationSchema } from "./schema.ts";
import { AutomationScrapingWorker, type ServerScrapingExecutor } from "./scraping-worker.ts";

test("Instagram and Facebook scraping jobs are leased, isolated, and stored without publishing profiles", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-scraping-worker-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();
  const database = createAutomationDatabase(config);
  migrateAutomationSchema(database);
  const store = new AutomationJobStore(database, files);
  const calls: string[] = [];
  const executor: ServerScrapingExecutor = {
    async execute(input) {
      const query = String((input as { query?: unknown }).query || "");
      calls.push(query);
      return { posts: [{ url: `https://example.test/${query}` }] };
    },
  };
  const worker = new AutomationScrapingWorker(
    store,
    files,
    new Map([["instagram", executor], ["facebook", executor]]),
    1_000,
    60_000,
    1_000,
    "scraping-test-worker",
  );
  try {
    const instagram = store.createScrapingJob({
      workspaceId: "workspace-one",
      platform: "instagram",
      input: { query: "nature", maxResults: 5 },
      idempotencyKey: "scraping-instagram-one",
    });
    const duplicate = store.createScrapingJob({
      workspaceId: "workspace-one",
      platform: "instagram",
      input: { query: "nature", maxResults: 5 },
      idempotencyKey: "scraping-instagram-one",
    });
    assert.equal(duplicate.id, instagram.id);
    await worker.runOnce();
    const completed = store.getScrapingJob("workspace-one", instagram.id);
    assert.equal(completed?.state, "COMPLETE");
    assert.deepEqual(await files.readScrapingResult("workspace-one", instagram.id), {
      posts: [{ url: "https://example.test/nature" }],
    });
    assert.equal(store.getScrapingJob("workspace-two", instagram.id), null);
    assert.deepEqual(calls, ["nature"]);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
