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

test("the Store exposes the saved WhatsApp login without exposing credentials", async () => {
  const statusRoute = await source("app/api/apps/status/route.js");
  const sessionRoute = await source("app/api/whatsapp/auth/session/route.js");
  const registerRoute = await source("app/api/whatsapp/auth/register/route.js");
  const statusHook = await source("src/platform/use-product-status.js");
  const store = await source("src/platform/AppsExplorer.jsx");
  const detail = await source("src/platform/WhatsAppServiceDetail.jsx");
  const modal = await source("src/platform/WhatsAppLoginModal.jsx");

  // A cookie only counts when it belongs to the workspace selected by the
  // AgenticThat principal; a stale cross-workspace cookie must prompt login.
  assert.match(statusRoute, /Number\(workspaceSession\.business_id\) === Number\(workspaceUser\.business_id\)/);
  assert.match(statusRoute, /workspaceAuthenticated/);
  assert.match(sessionRoute, /Number\(sessionUser\.business_id\) === Number\(workspaceUser\.business_id\)/);

  // Members with view access can sign in, while creating/replacing shared
  // credentials remains an administrator action.
  assert.equal((sessionRoute.match(/getCurrentUser\("view"\)/g) || []).length, 2);
  assert.match(registerRoute, /getCurrentUser\("configure"\)/);
  assert.match(sessionRoute, /enforceAuthRateLimit\("whatsapp-login-username"/);

  // The app page, rather than only Connections, owns the login prompt and the
  // Store status makes that requirement visible before dashboard launch.
  assert.match(statusHook, /state: !service\.workspaceAuthenticated\s*\? "login"/);
  assert.match(store, /opensWhatsAppWorkspace/);
  assert.match(store, /opensWhatsAppWorkspace\s*\? service\.dashboardHref/);
  assert.match(detail, /<WhatsAppLoginModal/);
  assert.match(detail, /data\.whatsapp\?\.connected && data\.whatsapp\?\.onboarded/);
  assert.match(detail, /window\.location\.assign\(destination\)/);

  // The browser persists only the HTTP-only cookie set by the server. The
  // modal sends credentials directly and never writes them into web storage.
  assert.match(modal, /credentials: "include"/);
  assert.doesNotMatch(modal, /localStorage|sessionStorage/);
});

test("WATI recovery sync remains operator-only", async () => {
  const route = await source("app/api/wati/messages/sync/route.js");
  const component = await source("services/messaging/whatsapp/src/components/WatiMessageAutoSync.jsx");
  assert.match(route, /getCurrentUser\("operate"\)/);
  assert.match(component, /SYNC_INTERVAL_MS = 60_000/);
  assert.match(component, /running\.current/);
});
