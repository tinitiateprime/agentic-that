import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublishingJobTransition,
  automationId,
  createPublishingJobSchema,
  loginBrowserInputSchema,
  loginBrowserInputBatchSchema,
  loginSessionStateSchema,
} from "./contracts.ts";

test("publishing state machine permits safe progress and rejects terminal retries", () => {
  assert.doesNotThrow(() => assertPublishingJobTransition("SCHEDULED", "PUBLISHING"));
  assert.doesNotThrow(() => assertPublishingJobTransition("PUBLISHING", "UNCERTAIN"));
  assert.doesNotThrow(() => assertPublishingJobTransition("UNCERTAIN", "VERIFYING"));
  assert.throws(() => assertPublishingJobTransition("PUBLISHED", "SCHEDULED"), /cannot move/);
  assert.throws(() => assertPublishingJobTransition("SCHEDULED", "PUBLISHED"), /cannot move/);
});

test("a publishing job needs content and a timezone-aware schedule", () => {
  const valid = createPublishingJobSchema.parse({
    workspaceId: "workspace_test",
    accountId: "account_test",
    scheduledAt: "2026-08-24T12:00:00+05:30",
    originalTimezone: "Asia/Calcutta",
    caption: "A safe staging post",
    idempotencyKey: "staging-job-0001",
  });
  assert.equal(valid.media.length, 0);
  assert.throws(() => createPublishingJobSchema.parse({
    workspaceId: "workspace_test",
    accountId: "account_test",
    scheduledAt: "2026-08-24T12:00:00",
    caption: "",
    idempotencyKey: "staging-job-0002",
  }));
});

test("automation ids are opaque and namespaced", () => {
  assert.match(automationId("job"), /^job_[a-f0-9]{32}$/);
});

test("login sessions expose only known lifecycle states", () => {
  assert.equal(loginSessionStateSchema.parse("AWAITING_USER"), "AWAITING_USER");
  assert.throws(() => loginSessionStateSchema.parse("PASSWORD_RECEIVED"));
});

test("website browser input is bounded and does not accept arbitrary commands", () => {
  const input = loginBrowserInputSchema.parse({ type: "text", text: "hello" });
  assert.equal(input.type, "text");
  if (input.type === "text") assert.equal(input.text, "hello");
  assert.throws(() => loginBrowserInputSchema.parse({ type: "key", key: "Control+L" }));
  assert.throws(() => loginBrowserInputSchema.parse({ type: "click", x: -1, y: 20 }));
  assert.equal(loginBrowserInputBatchSchema.parse([
    { type: "click", x: 10, y: 20, button: "left" },
    { type: "text", text: "batched typing" },
  ]).length, 2);
  assert.throws(() => loginBrowserInputBatchSchema.parse([]));
  assert.throws(() => loginBrowserInputBatchSchema.parse(Array.from({ length: 33 }, () => ({ type: "key", key: "Tab" }))));
});
