import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundJobError, backgroundJobMode, dispatchBackgroundJob, validateBackgroundJob } from "./background-jobs.js";

test("AWS dispatch waits for acceptance and sends only the scoped job identity", async () => {
  const previous = process.env.BACKGROUND_JOB_FUNCTION_NAME;
  process.env.BACKGROUND_JOB_FUNCTION_NAME = "test-jobs";
  try {
    const job = { version: 1, kind: "instagram", jobId: "job-1", workspaceId: "workspace-1" };
    let received;
    await dispatchBackgroundJob(job, { send: async command => { received = command.input; return { StatusCode: 202 }; } });
    assert.equal(received.InvocationType, "Event");
    assert.equal(received.FunctionName, "test-jobs");
    assert.deepEqual(JSON.parse(Buffer.from(received.Payload).toString()), job);
    await assert.rejects(dispatchBackgroundJob(job, { send: async () => ({ StatusCode: 200 }) }), BackgroundJobError);
  } finally {
    if (previous === undefined) delete process.env.BACKGROUND_JOB_FUNCTION_NAME;
    else process.env.BACKGROUND_JOB_FUNCTION_NAME = previous;
  }
});

test("background execution prefers a configured Lambda and otherwise uses requests", () => {
  assert.equal(backgroundJobMode({}), "request");
  assert.equal(backgroundJobMode({ BACKGROUND_JOB_FUNCTION_NAME: "existing-jobs" }), "lambda");
  assert.equal(backgroundJobMode({ BACKGROUND_JOB_MODE: "request", BACKGROUND_JOB_FUNCTION_NAME: "existing-jobs" }), "request");
  assert.equal(backgroundJobMode({ BACKGROUND_JOB_MODE: "lambda" }), "lambda");
  assert.throws(() => backgroundJobMode({ BACKGROUND_JOB_MODE: "after-response" }), /auto, lambda or request/);
});

test("background events reject missing identities, unsupported kinds and invalid IDs", () => {
  assert.throws(() => validateBackgroundJob({ version: 1, kind: "instagram", jobId: "job-1" }), /workspace/);
  assert.throws(() => validateBackgroundJob({ version: 1, kind: "website-studio", jobId: "website_1" }), /token/);
  assert.throws(() => validateBackgroundJob({ version: 1, kind: "shell", jobId: "job-1", workspaceId: "workspace-1" }), /Invalid background job/);
  assert.throws(() => validateBackgroundJob({ version: 1, kind: "instagram", jobId: "../other", workspaceId: "workspace-1" }), /Invalid background job/);
});
