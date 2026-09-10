import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { centralPublishingTestHelpers } from "../src/platform/server/publishing-central-store.js";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("Publishing ownership checks conceal another workspace's records", () => {
  const document = {
    accounts: [{ id: "account-b", workspaceId: "workspace-b" }],
  };
  assert.throws(
    () => centralPublishingTestHelpers.findOwned(document, "accounts", "workspace-a", "account-b", "Account"),
    /Account was not found/,
  );
});

test("Publishing normalized persistence is workspace scoped", async () => {
  const store = await source("src/platform/server/publishing-normalized-store.js");
  assert.match(store, /WHERE workspace_id = \$1/);
  assert.match(store, /publishing:\$\{lockScope\}/);
  assert.doesNotMatch(store, /app_document_store.*UPDATE/s);
});

test("Telegram, Instagram, and Facebook reject records owned by a different workspace", async () => {
  const [telegramTests, instagramStore, facebookStore] = await Promise.all([
    source("services/messaging/telegram/src/store.test.ts"),
    source("services/scraping/instagram/src/store.ts"),
    source("services/scraping/facebook/src/store.ts"),
  ]);
  assert.match(telegramTests, /outsider/);
  assert.match(telegramTests, /workspace scoped/);
  for (const store of [instagramStore, facebookStore]) {
    assert.match(store, /belongsToWorkspace/);
    assert.match(store, /value\.workspaceId === this\.workspaceId/);
  }
});

test("WhatsApp resources remain business scoped and production webhooks fail closed", async () => {
  const [messaging, meta, wati] = await Promise.all([
    source("services/messaging/whatsapp/src/lib/wa/messaging.js"),
    source("app/api/webhooks/meta/route.js"),
    source("app/api/webhooks/wati/route.js"),
  ]);
  assert.match(messaging, /business_id = \$\{business\.id\}/);
  assert.match(messaging, /messages_provider_delivery_unique_idx|ON CONFLICT DO NOTHING/);
  assert.match(meta, /process\.env\.NODE_ENV !== "production"/);
  assert.match(wati, /production && \(!token \|\| !tenant\)/);
});

test("every Admin Center API handler requires global-admin authorization", async () => {
  const routes = [
    "app/api/admin-center/route.js",
    "app/api/admin-center/workspaces/route.js",
    "app/api/admin-center/users/[id]/route.js",
    "app/api/admin-center/roles/route.js",
    "app/api/admin-center/roles/[id]/route.js",
    "app/api/admin-center/identity-reviews/[id]/route.js",
    "app/api/admin-center/communications/route.js",
    "app/api/admin-center/email-templates/route.js",
    "app/api/admin-center/email-templates/[id]/route.js",
    "app/api/admin-center/email-templates/test/route.js",
    "app/api/admin-center/invitations/route.js",
    "app/api/admin-center/invitations/[id]/route.js",
    "app/api/admin-center/product-invitations/route.js",
    "app/api/admin-center/product-invitations/[id]/route.js",
  ];
  for (const route of routes) {
    assert.match(await source(route), /authorizeGlobalAdminApi\(\)/, route);
  }
});

test("notification tables remain server-only after the final security migration", async () => {
  const migration = await source("supabase/migrations/202609100001_admin_invitation_email_studio.sql");
  for (const table of ["notification_templates", "notification_deliveries"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from authenticated`));
  }
});

test("client product invitations are separated from secure workspace invitations", async () => {
  const migration = await source("supabase/migrations/202609100002_client_product_invitations.sql");
  assert.match(migration, /purpose in \('workspace_invitation', 'product_invitation'\)/);
  assert.match(migration, /alter column invitation_id drop not null/);
  assert.match(migration, /notification_deliveries_purpose_fields_check/);
  assert.match(migration, /purpose = 'workspace_invitation' and invitation_id is not null/);
  assert.match(migration, /purpose = 'product_invitation'/);
});

test("the final Supabase migration locks every public table and restores only token-scoped RPCs", async () => {
  const migration = await source("supabase/migrations/202609060004_public_schema_lockdown.sql");
  assert.match(migration, /alter table %I\.%I enable row level security/);
  assert.match(migration, /revoke all on table %I\.%I from public/);
  assert.match(migration, /revoke all on table %I\.%I from anon/);
  assert.match(migration, /revoke all on table %I\.%I from authenticated/);
  assert.match(migration, /revoke execute on all functions in schema public from public/);
  assert.match(migration, /grant execute on function public\.companion_claim_jobs/);
});
