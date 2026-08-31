import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import postgres from "postgres";
import { migrateAutomationPostgres } from "./postgres-database.ts";
import { PostgresAutomationJobStore } from "./postgres-job-store.ts";
import { PostgresAutomationLoginStore } from "./postgres-login-store.ts";
import { AutomationFileStore } from "./profile-store.ts";

const integrationUrl = process.env.TEST_AUTOMATION_POSTGRES_URL?.trim();

test("PostgreSQL atomically claims jobs, fences stale workers, and audits manual resolution", {
  skip: integrationUrl ? false : "TEST_AUTOMATION_POSTGRES_URL is not configured",
}, async () => {
  if (!integrationUrl) return;
  const schema = `automation_test_${randomBytes(8).toString("hex")}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-postgres-"));
  const migration = postgres(integrationUrl, { max: 1, prepare: false });
  const workerA = postgres(integrationUrl, { max: 1, prepare: false });
  const workerB = postgres(integrationUrl, { max: 1, prepare: false });
  try {
    await migration.unsafe(`CREATE SCHEMA "${schema}"`);
    for (const connection of [migration, workerA, workerB]) {
      await connection.unsafe(`SET search_path TO "${schema}"`);
    }
    await migrateAutomationPostgres(migration);
    const files = new AutomationFileStore(directory);
    await files.initialize();
    const storeA = new PostgresAutomationJobStore(workerA, files);
    const storeB = new PostgresAutomationJobStore(workerB, files);
    const account = await storeA.createAccount({
      workspaceId: "postgres-workspace",
      platform: "instagram",
      displayName: "PostgreSQL Instagram",
    });
    await migration`UPDATE social_accounts SET status = 'CONNECTED' WHERE id = ${account.id}`;
    await migration`UPDATE browser_profiles SET version = 1, last_saved_at = clock_timestamp() WHERE account_id = ${account.id}`;
    const base = {
      workspaceId: "postgres-workspace",
      accountId: account.id,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      originalTimezone: "UTC",
      caption: "PostgreSQL production test",
      media: [],
      platformOptions: {},
    };
    const first = await storeA.createPublishingJob({ ...base, idempotencyKey: "postgres-job-one" }, "LIVE", "LOCAL", true);
    await storeA.createPublishingJob({ ...base, idempotencyKey: "postgres-job-two" }, "LIVE", "LOCAL", true);
    const future = await storeA.createPublishingJob({
      ...base,
      scheduledAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      idempotencyKey: "postgres-future-job",
    }, "LIVE", "LOCAL", true);

    const claims = await Promise.all([
      storeA.claimDuePublishingJob("postgres-worker-a", 60),
      storeB.claimDuePublishingJob("postgres-worker-b", 60),
    ]);
    const claimed = claims.find(Boolean);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(claimed?.id, first.id);
    assert.ok(claimed?.fencingToken);
    await assert.rejects(
      new PostgresAutomationLoginStore(migration).createOrGetSession("postgres-workspace", account.id),
      /publishing worker/,
    );
    await storeA.markPublishingFinalActionStarting(claimed!.id, claimed!.leaseOwner!, claimed!.fencingToken!);
    const uncertain = await storeA.finishPublishingJob({
      jobId: claimed!.id,
      workerId: claimed!.leaseOwner!,
      fencingToken: claimed!.fencingToken!,
      state: "UNCERTAIN",
      errorCode: "TEST_UNCERTAIN",
      errorMessage: "Production test requires manual verification.",
    });
    assert.equal(uncertain.state, "UNCERTAIN");
    const resolved = await storeA.resolveUncertainPublishingJob(claimed!.id, {
      workspaceId: "postgres-workspace",
      resolvedBy: "integration-test-operator",
      resolution: "PUBLISHED",
      note: "Verified using the platform test-account history.",
      platformPostId: "verified-post-id",
    });
    assert.equal(resolved.status, "RESOLVED");
    assert.equal(resolved.job?.resolvedBy, "integration-test-operator");

    const second = await storeB.claimDuePublishingJob("postgres-worker-b", 60);
    assert.ok(second);
    assert.ok(second!.fencingToken! > claimed!.fencingToken!);
    assert.equal(await storeA.heartbeatPublishingJob(second!.id, "postgres-worker-a", claimed!.fencingToken!, 60), false);
    await assert.rejects(storeA.finishPublishingJob({
      jobId: second!.id,
      workerId: "postgres-worker-a",
      fencingToken: claimed!.fencingToken!,
      state: "PUBLISHED",
    }), /lease is no longer owned/);
    await migration`
      UPDATE publishing_jobs SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${second!.id}
    `;
    await migration`
      UPDATE account_execution_locks SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE account_id = ${account.id}
    `;
    const [recovered] = await storeA.quarantineExpiredPublishingJobs();
    assert.equal(recovered?.id, second!.id);
    assert.equal(recovered?.state, "UNCERTAIN");
    assert.equal(recovered?.errorCode, "WORKER_LEASE_EXPIRED");
    assert.equal(await storeB.claimDuePublishingJob("postgres-worker-b", 60), null);
    assert.equal((await storeA.getPublishingJob("postgres-workspace", future.id))?.state, "SCHEDULED");
  } finally {
    await Promise.allSettled([workerA.end({ timeout: 2 }), workerB.end({ timeout: 2 })]);
    await migration.unsafe("SET search_path TO public").catch(() => undefined);
    await migration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await migration.end({ timeout: 2 });
    await rm(directory, { recursive: true, force: true });
  }
});
