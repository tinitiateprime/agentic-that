import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { getDatabaseSql, mutateDatabaseDocument, readDatabaseDocument } from "../lib/database-document-store.js";
import { runRequestJobStep } from "../lib/request-job-runner.js";
import { restoreProjectWorkspace, snapshotProjectWorkspace } from "../src/platform/server/project-workspace-persistence.js";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
process.env.DATA_STORE = "postgres";
process.env.NODE_ENV = "production";
process.env.RUN_DATABASE_MIGRATIONS = "false";
const sql = await getDatabaseSql();
const key = `aws-validation/${randomUUID()}`;
const root = await mkdtemp(path.join(os.tmpdir(), "agenticthat-aws-validation-"));
try {
  await Promise.all(Array.from({ length: 20 }, () => mutateDatabaseDocument(key, { count: 0 }, document => ({ document: { count: document.count + 1 }, result: undefined }))));
  assert.equal((await readDatabaseDocument(key)).count, 20);
  await assert.rejects(mutateDatabaseDocument(key, {}, () => { throw new Error("rollback-check"); }), /rollback-check/);
  assert.equal((await readDatabaseDocument(key)).count, 20);
  await mutateDatabaseDocument(`${key}/job`, {}, () => ({ document: { ownerId: key, stage: "ai", count: 0 }, result: undefined }));
  let claims = 0;
  await Promise.all(Array.from({ length: 10 }, () => runRequestJobStep(`${key}/job`, key, async job => {
    claims++;
    return { ...job, stage: "complete", count: job.count + 1 };
  })));
  assert.equal(claims, 1);
  assert.equal((await readDatabaseDocument(`${key}/job`)).count, 1);
  await assert.rejects(runRequestJobStep(`${key}/job`, "other-owner", async job => job), error => error.status === 404);
  const { CredentialStore } = await import(new URL("./credential-store.js", import.meta.resolve("@project-workspace/embedded/server")));
  // Isolated test directories and document keys never touch business projects.
  delete process.env.PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY;
  delete process.env.TOKEN_ENCRYPTION_KEY;
  const firstDirectory = path.join(root, "first");
  await mkdir(firstDirectory);
  const first = new CredentialStore(firstDirectory);
  await first.initialize();
  await first.set("validation-repository", "validation-only-token");
  const files = await snapshotProjectWorkspace(firstDirectory);
  await mutateDatabaseDocument(`${key}/credentials`, {}, () => ({ document: { files }, result: undefined }));
  const secondDirectory = path.join(root, "cold-start");
  await restoreProjectWorkspace(secondDirectory, (await readDatabaseDocument(`${key}/credentials`)).files);
  const second = new CredentialStore(secondDirectory);
  await second.initialize();
  assert.equal(await second.get("validation-repository"), "validation-only-token");
  console.log("Supabase durable storage passed concurrent-write and transaction-rollback checks.");
  console.log("Request job ownership and cold-start project credential checks passed.");
} finally {
  await sql`DELETE FROM agentic_that.app_document_store WHERE key IN (${key}, ${`${key}/job`}, ${`${key}/credentials`})`;
  await sql.end();
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("agenticthat-aws-validation-")) throw new Error("Invalid validation directory.");
  await rm(root, { recursive: true, force: true });
}
