// Group Manager's database code against a real PostgreSQL (PGlite, in memory):
// the migration, every store function, the Companion's paired report, and
// workspace isolation. Never touches a real database.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { executeCompanionRpc, validateCompanionRpc } from "./companion-database-api.js";
import * as store from "./group-manager-store.js";

const PAIRING_TOKEN = "pairing-token-for-w1-xxxxxxxxxxxxxxxx";
const actor = { workspaceId: "w1", userId: "u1" };
const other = { workspaceId: "w2", userId: "u1" };

async function database() {
  const db = await PGlite.create();
  // Just the existing tables and helper the migration and the paired report rely on.
  await db.exec(`
    create role anon; create role authenticated;
    create table public.platform_workspaces (id text primary key);
    create table public.platform_users (id text primary key);
    create schema private;
    create function private.companion_token_hash(p text) returns text language sql as 'select md5(p)';
    create table public.companion_devices (workspace_id text, companion_instance_id text, token_hash text, revoked_at timestamptz);
    insert into public.platform_workspaces values ('w1'), ('w2');
    insert into public.platform_users values ('u1');
    insert into public.companion_devices values ('w1', 'instance-123456', md5('${PAIRING_TOKEN}'), null);
  `);
  await db.exec(fs.readFileSync(new URL("../../../supabase/migrations/202611140001_group_manager.sql", import.meta.url), "utf8"));
  const port = 20000 + Math.floor(Math.random() * 30000);
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();
  const sql = postgres(`postgres://postgres@127.0.0.1:${port}/postgres`, { max: 1, ssl: false, onnotice: () => {} });
  store.useGroupManagerSql(sql);
  return {
    sql,
    async close() {
      store.useGroupManagerSql(null);
      await sql.end();
      await server.stop();
      await db.close();
    },
  };
}

const at = () => new Date().toISOString();
const groupOf = async (id) => (await store.groupManagerState(actor)).groups.find((group) => group.id === id);

test("Group Manager data in PostgreSQL: contacts, groups, results, removal and the paired report", async () => {
  const { sql, close } = await database();
  try {
    // Contact Master, per workspace.
    const asha = await store.addGroupContact(actor, { name: "Asha Reddy", whatsapp: "+91 98765 43210", telegram: "@asha_r" });
    assert.equal(asha.whatsapp, "+919876543210");
    const ravi = await store.addGroupContact(actor, { name: "Ravi", whatsapp: "+919812345678" });
    await assert.rejects(store.addGroupContact(actor, { name: "Bad", whatsapp: "123" }), /country code/);
    const updated = await store.updateGroupContact(actor, ravi.id, { name: "Ravi Kumar", whatsapp: "+919812345678", discord: "123456789012345678" });
    assert.equal(updated.discord, "123456789012345678");
    await assert.rejects(store.updateGroupContact(other, ravi.id, { name: "x" }), /no longer exists/, "another workspace can't see it");

    // A group: pending work saved for the Companion.
    const group = await store.createManagedGroup(actor, { name: "Batch 5", apps: ["whatsapp", "telegram"], contactIds: [asha.id, ravi.id, "11111111-1111-4111-8111-111111111111"] });
    assert.equal(group.apps.whatsapp.state, "creating");
    assert.equal(group.members.length, 2, "unknown contacts are ignored");
    assert.equal(group.members[0].apps.telegram.state, "pending");
    await assert.rejects(store.createManagedGroup(actor, { name: "batch 5", apps: ["whatsapp"] }), /already have a group/);
    await assert.rejects(store.createManagedGroup(actor, { name: "D", apps: ["discord"] }), /Discord server/);
    assert.ok((await store.createManagedGroup(other, { name: "Batch 5", apps: ["whatsapp"] })).id, "the same name is fine in another workspace");

    // Results from the Companion.
    await store.applyGroupSync("w1", { groups: [{
      id: group.id,
      apps: { whatsapp: { state: "ready", ref: { jid: "123@g.us" }, link: "https://chat.whatsapp.com/abc", at: at() } },
      members: [
        { contactId: asha.id, apps: { whatsapp: { state: "added", at: at() }, telegram: { state: "added", at: at() } } },
        { contactId: ravi.id, apps: { whatsapp: { state: "invited", link: "https://chat.whatsapp.com/abc", at: at() }, telegram: { state: "missing-id", at: at() } } },
      ],
    }] });
    let saved = await groupOf(group.id);
    assert.equal(saved.apps.whatsapp.ref.jid, "123@g.us");
    assert.equal(saved.apps.telegram.state, "creating", "apps not reported are kept");
    assert.equal(saved.members.find((member) => member.contactId === asha.id).apps.whatsapp.state, "added");
    assert.equal((await store.applyGroupSync("w2", { groups: [{ id: group.id, apps: { whatsapp: { state: "failed", at: at() } } }] })).updated, 0, "another workspace can't change it");

    // Messages go only to apps where the group is live.
    const withMessage = await store.addManagedGroupMessage(actor, group.id, { text: "Hello batch" });
    assert.deepEqual(withMessage.messages[0].results, { whatsapp: { state: "sending" } });
    await store.applyGroupSync("w1", { groups: [{ id: group.id, messages: [{ id: withMessage.messages[0].id, results: { whatsapp: { state: "sent" } } }] }] });

    // Removal: marked for the Companion, gone once it's removed everywhere.
    const removing = await store.removeManagedGroupMember(actor, group.id, asha.id);
    assert.equal(removing.needsCompanion, true);
    assert.equal(removing.group.members.find((member) => member.contactId === asha.id).apps.whatsapp.detail, "Removing…");
    const removedAt = at();
    await store.applyGroupSync("w1", { groups: [{ id: group.id, members: [{ contactId: asha.id, apps: { whatsapp: { state: "removed", at: removedAt }, telegram: { state: "removed", at: removedAt } } }] }] });
    saved = await groupOf(group.id);
    assert.equal(saved.members.some((member) => member.contactId === asha.id), false);
    assert.equal(saved.messages[0].results.whatsapp.state, "sent");

    // Added again: a late "removed" report must not undo the newer request.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await store.addManagedGroupMembers(actor, group.id, { contactIds: [asha.id] });
    await store.applyGroupSync("w1", { groups: [{ id: group.id, members: [{ contactId: asha.id, apps: { whatsapp: { state: "removed", at: removedAt } } }] }] });
    assert.equal((await groupOf(group.id)).members.find((member) => member.contactId === asha.id)?.apps.whatsapp.state, "pending");

    // The Companion's own report, over its workspace pairing.
    const input = validateCompanionRpc("companion_group_sync", { p_token: PAIRING_TOKEN, p_instance_id: "instance-123456", p_groups: [{ id: group.id, apps: { telegram: { state: "ready", at: at() } } }] });
    assert.equal((await executeCompanionRpc(sql, "companion_group_sync", input)).updated, 1);
    assert.equal((await groupOf(group.id)).apps.telegram.state, "ready");
    await assert.rejects(executeCompanionRpc(sql, "companion_group_sync", { ...input, p_token: "wrong-token-xxxxxxxxxxxxxxxxxxxxxxxxxxx" }), (error) => error.code === "28000");
    await assert.rejects(executeCompanionRpc(sql, "companion_group_sync", { ...input, p_instance_id: "another-instance" }), (error) => error.code === "28000");
    assert.throws(() => validateCompanionRpc("companion_group_sync", { p_token: PAIRING_TOKEN, p_instance_id: "instance-123456", p_groups: "nope" }), /Invalid Group Manager results/);

    // Deleting a group takes its members and messages with it.
    await store.deleteManagedGroup(actor, group.id);
    const [{ count }] = await sql`select count(*)::int as count from public.group_manager_members where group_id = ${group.id}`;
    assert.equal(count, 0);
    await store.deleteGroupContact(actor, ravi.id);
    await assert.rejects(store.deleteGroupContact(actor, ravi.id), /no longer exists/);
  } finally {
    await close();
  }
});

test("Group Manager needs a workspace", async () => {
  await assert.rejects(store.groupManagerState({ userId: "u1" }), /needs a workspace/);
});
