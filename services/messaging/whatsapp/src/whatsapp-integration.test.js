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

test("WhatsApp maps viewer, operator, and manager requests to distinct capabilities", async () => {
  const auth = await source("services/messaging/whatsapp/src/lib/auth.js");
  assert.match(auth, /if \(requiredLevel === "configure"\) return "messaging\.configure"/);
  assert.match(auth, /if \(requiredLevel === "operate"\) return "messaging\.operate"/);
  assert.match(auth, /return "messaging\.view"/);
  assert.match(auth, /assertPrincipalAccess\(principal, "messaging\.whatsapp", requiredLevel\)/);
  assert.match(auth, /assertPrincipalCapability\(principal, capabilityForLevel\(requiredLevel\)\)/);
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

test("schema migration is versioned and creates the reaction cursor columns", async () => {
  const database = await source("services/messaging/whatsapp/src/lib/db.js");
  // The key gates the whole DDL block, so it has to move whenever statements
  // are added or an already-migrated database never sees them.
  assert.match(database, /WHATSAPP_SCHEMA_MIGRATION_KEY = "whatsapp-schema-v3-session-business"/);
  assert.match(database, /ADD COLUMN IF NOT EXISTS reaction TEXT/);
  assert.match(database, /ADD COLUMN IF NOT EXISTS reaction_at TIMESTAMPTZ/);
  assert.match(database, /export async function migrateWhatsAppSchema/);
});

test("login sessions are mapped to a business and backfilled", async () => {
  const database = await source("services/messaging/whatsapp/src/lib/db.js");
  assert.match(database, /ALTER TABLE sessions ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses\(id\)/);
  assert.match(database, /idx_sessions_business ON sessions\(business_id\)/);
  assert.match(database, /idx_users_business ON users\(business_id\)/);
  // Existing sessions must keep working after the column is added.
  assert.match(database, /SET business_id = u\.business_id/);
});

test("the WhatsApp workspace loads the session's business, but only when entitled", async () => {
  const auth = await source("services/messaging/whatsapp/src/lib/auth.js");
  // The session stores the business it was opened for...
  assert.match(auth, /INSERT INTO sessions \(token, user_id, business_id\)/);
  // ...and the workspace is selected through it rather than users.business_id.
  assert.match(auth, /JOIN businesses b ON b\.id = COALESCE\(s\.business_id, u\.business_id\)/);
  // Pinning a business is gated, so the cookie can never open another tenant.
  assert.match(auth, /function sessionBusinessAllowed/);
  assert.match(auth, /sessionBusinessAllowed\(sessionRow, principal, platformUser\.id\)/);
  // Both the route guard and the page guard resolve the same way.
  for (const guard of [/export async function getCurrentUser/, /export async function requireUser/]) {
    assert.match(auth, guard);
  }
  assert.equal((auth.match(/return resolveWorkspaceUser\(principal, platformUser/g) || []).length, 2);
});

test("WATI recovery sync remains operator-only", async () => {
  const route = await source("app/api/wati/messages/sync/route.js");
  const component = await source("services/messaging/whatsapp/src/components/WatiMessageAutoSync.jsx");
  assert.match(route, /getCurrentUser\("operate"\)/);
  assert.match(component, /SYNC_INTERVAL_MS = 60_000/);
  assert.match(component, /running\.current/);
});
