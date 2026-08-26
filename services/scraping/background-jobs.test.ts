import assert from "node:assert/strict";
import test from "node:test";
import { InProcessBackgroundJobs } from "./background-jobs.ts";

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

test("starts long work without awaiting it and deduplicates the same job", async () => {
  const jobs = new InProcessBackgroundJobs();
  let release!: () => void;
  let started = 0;
  const operation = () => new Promise<void>((resolve) => {
    started += 1;
    release = resolve;
  });

  assert.equal(jobs.start("workspace:job", operation), true);
  assert.equal(jobs.start("workspace:job", operation), false);
  assert.equal(jobs.has("workspace:job"), true);
  await nextTurn();
  assert.equal(started, 1);
  assert.equal(jobs.active, 1);
  assert.equal(jobs.queued, 0);

  release();
  await nextTurn();
  assert.equal(jobs.has("workspace:job"), false);
});

test("queues different jobs instead of running browser work concurrently", async () => {
  const jobs = new InProcessBackgroundJobs();
  const started: string[] = [];
  let releaseFirst!: () => void;
  const first = () => new Promise<void>((resolve) => {
    started.push("first");
    releaseFirst = resolve;
  });
  const second = async () => { started.push("second"); };

  assert.equal(jobs.start("workspace:first", first), true);
  assert.equal(jobs.start("workspace:second", second), true);
  await nextTurn();
  assert.deepEqual(started, ["first"]);
  assert.equal(jobs.active, 1);
  assert.equal(jobs.queued, 1);

  releaseFirst();
  await nextTurn();
  assert.deepEqual(started, ["first", "second"]);
  await nextTurn();
  assert.equal(jobs.size, 0);
});

test("rejects invalid concurrency", () => {
  assert.throws(() => new InProcessBackgroundJobs(0), /positive integer/);
});

test("contains rejected background work and reports it once", async () => {
  const jobs = new InProcessBackgroundJobs();
  const reported: unknown[] = [];

  assert.equal(jobs.start("workspace:failed", async () => {
    throw new Error("expected failure");
  }, error => reported.push(error)), true);
  await nextTurn();
  await nextTurn();

  assert.equal(jobs.size, 0);
  assert.equal(reported.length, 1);
  assert.match(String(reported[0]), /expected failure/);
});
