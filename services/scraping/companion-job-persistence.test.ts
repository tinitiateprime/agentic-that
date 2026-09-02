import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCompanionJobs, persistCompanionJobs } from "./companion-job-persistence.js";

test("Companion scraping jobs are encrypted, durable, and recover from a corrupt primary file", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agenticthat-scrape-jobs-"));
  const previousPath = process.env.PUBLISH_QUEUE_DATA_PATH;
  const previousKey = process.env.PUBLISH_QUEUE_SESSION_ENCRYPTION_KEY;
  process.env.PUBLISH_QUEUE_DATA_PATH = path.join(root, "store.json");
  process.env.PUBLISH_QUEUE_SESSION_ENCRYPTION_KEY = "test-encryption-key-with-enough-randomness";
  context.after(() => {
    if (previousPath === undefined) delete process.env.PUBLISH_QUEUE_DATA_PATH;
    else process.env.PUBLISH_QUEUE_DATA_PATH = previousPath;
    if (previousKey === undefined) delete process.env.PUBLISH_QUEUE_SESSION_ENCRYPTION_KEY;
    else process.env.PUBLISH_QUEUE_SESSION_ENCRYPTION_KEY = previousKey;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const first = [{ id: "job_1", ownerKey: "workspace:user", input: { query: "private target" }, status: "queued" }];
  const second = [{ id: "job_2", ownerKey: "workspace:user", input: { query: "second target" }, status: "queued" }];
  persistCompanionJobs("instagram", first);
  const queuePath = path.join(root, "instagram-companion-jobs.json");
  assert.doesNotMatch(fs.readFileSync(queuePath, "utf8"), /private target/);
  assert.deepEqual(loadCompanionJobs("instagram"), first);

  persistCompanionJobs("instagram", second);
  fs.writeFileSync(queuePath, "{corrupt", "utf8");
  assert.deepEqual(loadCompanionJobs("instagram"), first);
  assert.deepEqual(loadCompanionJobs("instagram"), first);
});
