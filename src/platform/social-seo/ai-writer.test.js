import assert from "node:assert/strict";
import test from "node:test";
import { AI_PLATFORMS, aiStatusFromEvent } from "./ai-writer.js";

test("AI events become card states: done with results, limit, failed, still working", () => {
  assert.deepEqual(aiStatusFromEvent({ provider: "gemini", ok: true, results: { instagram: { caption: "Hi" } }, complete: true, ms: 1200, watchedVideo: 1 }),
    { state: "done", results: { instagram: { caption: "Hi" } }, complete: true, raw: undefined, ms: 1200, live: "", watchedVideo: true });
  assert.deepEqual(aiStatusFromEvent({ provider: "claude", ok: false, limit: true, message: "Upload limit reached" }), { state: "limit", message: "Upload limit reached" });
  assert.deepEqual(aiStatusFromEvent({ provider: "chatgpt", ok: false, message: "Timed out" }), { state: "failed", message: "Timed out" });
  assert.deepEqual(aiStatusFromEvent({ provider: "chatgpt", state: "working", step: "writing", detail: "Writing…" }), { state: "working", step: "writing", detail: "Writing…", live: "" });
});

test("the AI writes for every app the composer can post to", () => {
  assert.deepEqual(AI_PLATFORMS, ["instagram", "facebook", "linkedin", "youtube", "x", "reddit"]);
});
