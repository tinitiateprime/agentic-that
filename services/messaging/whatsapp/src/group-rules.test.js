import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GroupRuleError, normalizeKeywords } from "./lib/group-rules.js";

const migrationPath = new URL(
  "../../../../supabase/migrations/202609200001_whatsapp_message_group_rules.sql",
  import.meta.url,
);

test("keywords are trimmed, lowercased and de-duplicated", () => {
  assert.deepEqual(normalizeKeywords(" Price , price,  QUOTE "), ["price", "quote"]);
  assert.deepEqual(normalizeKeywords(["order status", "Order Status"]), ["order status"]);
});

test("a rule cannot be saved without a usable keyword", () => {
  assert.throws(() => normalizeKeywords("  , ,"), GroupRuleError);
  assert.throws(() => normalizeKeywords([]), GroupRuleError);
  assert.throws(() => normalizeKeywords(Array.from({ length: 26 }, (_, index) => `k${index}`)), GroupRuleError);
  assert.throws(() => normalizeKeywords("x".repeat(61)), GroupRuleError);
});

test("the trigger only reacts to stored inbound messages", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /after insert on public\.messages/);
  assert.match(migration, /if new\.direction <> 'in' or coalesce\(new\.body, ''\) = '' then return null/);
  // Webhook delivery must survive a broken rule rather than rejecting the row.
  assert.match(migration, /exception when others then\s+raise warning/);
});

test("keywords are matched whole-word and escaped before they reach the regex", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /'\\m\(' \|\| string_agg\(regexp_replace\(btrim\(keyword\)/);
  assert.match(migration, /\|\| '\)\\M'/);
});

test("rules stay inside one business and cannot be reached through the Data API", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /business_id\s+integer not null references public\.businesses\(id\) on delete cascade/);
  assert.match(migration, /alter table public\.whatsapp_group_rules enable row level security/);
  assert.match(migration, /revoke all on table public\.whatsapp_group_rules from anon/);
  assert.match(migration, /revoke all on table public\.whatsapp_group_rules from authenticated/);
});

test("changing a rule re-checks recent messages without re-entering the trigger", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /after insert or update of keywords, min_occurrences, window_days, enabled, name/);
  assert.match(migration, /perform public\.whatsapp_backfill_group_rule\(new\.id\)/);
});

test("the rules API keeps changes operator-only", async () => {
  const collection = await readFile(new URL("../../../../app/api/groups/rules/route.js", import.meta.url), "utf8");
  const item = await readFile(new URL("../../../../app/api/groups/rules/[id]/route.js", import.meta.url), "utf8");
  assert.match(collection, /getCurrentUser\(\)/);
  assert.match(collection, /getCurrentUser\("operate"\)/);
  assert.equal((item.match(/getCurrentUser\("operate"\)/g) || []).length, 2);
});
