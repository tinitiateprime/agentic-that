import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Telegram console offers immediate posting without client-side scheduling", async () => {
  const source = await readFile(new URL("./telegram-controller.js", import.meta.url), "utf8");
  const view = await readFile(new URL("./TelegramConsole.jsx", import.meta.url), "utf8");
  assert.match(source, /\/v1\/posts/);
  assert.match(source, /\/send-now/);
  assert.doesNotMatch(source, /\/schedule/);
  assert.match(view, /"id":"post-schedule"[^\n]+"hidden":true,"disabled":true/);
  assert.match(view, /"id":"post-scheduled-at"[^\n]+"hidden":true,"disabled":true/);
  assert.doesNotMatch(source, /function runScheduler/);
  assert.doesNotMatch(source, /sendScheduledPost/);
  assert.doesNotMatch(source, /scheduledSending/);
  assert.doesNotMatch(source, /write\(keys\.postHistory/);
});

test("Telegram contacts, groups, channels, and profiles use workspace-scoped server storage", async () => {
  const source = await readFile(new URL("./telegram-controller.js", import.meta.url), "utf8");

  assert.match(source, /\/v1\/workspace-data/);
  assert.match(source, /\/v1\/contacts/);
  assert.match(source, /\/v1\/groups/);
  assert.match(source, /\/v1\/channels/);
  assert.match(source, /\/v1\/profiles/);
  assert.match(source, /migrateLegacyWorkspaceData/);
  assert.match(source, /Contact saved on the server/);
  assert.doesNotMatch(source, /write\(keys\.(?:profiles|contacts|groups|channels)/);
});
