import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("reaction endpoint retains AgenticThat operate permission enforcement", async () => {
  const route = await source("app/api/messages/react/route.js");
  assert.match(route, /getCurrentUser\("operate"\)/);
  assert.match(route, /whatsappAccessErrorResponse\("operate"\)/);
  assert.match(route, /getMessage\(user\.business_id, messageId\)/);
});

test("all inbound provider webhooks process reaction events", async () => {
  for (const path of [
    "app/api/webhooks/meta/route.js",
    "app/api/webhooks/wati/route.js",
    "app/api/webhooks/baileys/[businessId]/route.js",
  ]) {
    const route = await source(path);
    assert.match(route, /applyReaction/);
  }
});

test("Baileys webhook still fails closed when its secret is missing", async () => {
  const route = await source("app/api/webhooks/baileys/[businessId]/route.js");
  assert.match(route, /if \(!expectedSecret\)/);
  assert.match(route, /webhook secret is not configured/);
});

test("reaction migration is versioned and creates both cursor columns", async () => {
  const database = await source("services/messaging/whatsapp/src/lib/db.js");
  assert.match(database, /whatsapp-schema-v2-reactions/);
  assert.match(database, /ADD COLUMN IF NOT EXISTS reaction TEXT/);
  assert.match(database, /ADD COLUMN IF NOT EXISTS reaction_at TIMESTAMPTZ/);
  assert.match(database, /export async function migrateWhatsAppSchema/);
});

test("WATI recovery sync remains operator-only", async () => {
  const route = await source("app/api/wati/messages/sync/route.js");
  const component = await source("services/messaging/whatsapp/src/components/WatiMessageAutoSync.jsx");
  assert.match(route, /getCurrentUser\("operate"\)/);
  assert.match(component, /SYNC_INTERVAL_MS = 60_000/);
  assert.match(component, /running\.current/);
});
