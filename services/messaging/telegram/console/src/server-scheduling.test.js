import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Telegram post scheduling is delegated to the durable server worker", async () => {
  const source = await readFile(new URL("./telegram-controller.js", import.meta.url), "utf8");
  assert.match(source, /\/v1\/posts/);
  assert.match(source, /\/schedule/);
  assert.match(source, /\/send-now/);
  assert.match(source, /You may close this browser/);
  assert.doesNotMatch(source, /function runScheduler/);
  assert.doesNotMatch(source, /sendScheduledPost/);
  assert.doesNotMatch(source, /scheduledSending/);
  assert.doesNotMatch(source, /write\(keys\.postHistory/);
});
