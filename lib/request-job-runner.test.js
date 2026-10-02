import assert from "node:assert/strict";
import test from "node:test";
import { runRequestJobStep } from "./request-job-runner.js";

function repository() {
  let state = { ownerId: "owner", stage: "ai", value: 0 };
  return {
    read: () => structuredClone(state),
    mutate: async (_key, _initial, operation) => {
      const outcome = operation(structuredClone(state));
      state = structuredClone(outcome.document);
      return outcome.result;
    },
  };
}

test("concurrent tabs execute one step and another owner cannot claim it", async () => {
  const store = repository();
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  const execute = state => { calls++; return waiting.then(() => ({ ...state, stage: "complete" })); };
  const first = runRequestJobStep("job", "owner", execute, store);
  await Promise.resolve();
  assert.deepEqual(await runRequestJobStep("job", "owner", execute, store), { advanced: false });
  await assert.rejects(runRequestJobStep("job", "other", execute, store), error => error.status === 404);
  finish();
  await first;
  assert.equal(calls, 1);
  assert.equal(store.read().stage, "complete");
  assert.deepEqual(await runRequestJobStep("job", "owner", execute, store), { advanced: false });
});

test("an expired claim can resume and the older process cannot overwrite its result", async () => {
  const store = repository();
  let clock = 0;
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const options = { ...store, now: () => clock };
  const first = runRequestJobStep("job", "owner", state => waiting.then(() => ({ ...state, value: 1 })), options);
  await Promise.resolve();
  clock = 91_000;
  await runRequestJobStep("job", "owner", async state => ({ ...state, value: 2 }), options);
  finish();
  assert.deepEqual(await first, { advanced: false });
  assert.equal(store.read().value, 2);
});

test("unexpected step failures release the claim for a later request", async () => {
  const store = repository();
  await assert.rejects(runRequestJobStep("job", "owner", async () => { throw new Error("network down"); }, store), /network down/);
  await runRequestJobStep("job", "owner", async state => ({ ...state, stage: "complete" }), store);
  assert.equal(store.read().stage, "complete");
});
