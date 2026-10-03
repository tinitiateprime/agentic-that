import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { AccountAlreadyLinkedError, getTelegramDatabaseClient, MultiUserStore, WorkspaceRecordConflictError } from "./store.ts";
import { TelegramPostScheduler } from "./post-scheduler.ts";

// Opt in with a database containing the Telegram migrations. Every row is
// isolated under newly created test owners and removed in finally.
const databaseUrl = process.env.TELEGRAM_TEST_DATABASE_URL?.trim();
test("PostgreSQL Telegram dashboard writes, backups, sessions and delivery checkpoints stay isolated", {skip: !databaseUrl, timeout: 240_000}, async () => {
  const saved = {...process.env};
  process.env.DATABASE_URL = databaseUrl;
  process.env.TELEGRAM_DATA_STORE = "postgres";
  process.env.DATA_STORE = "postgres";
  process.env.PG_POOL_MAX = "3";
  const marker = "Telegram database regression " + randomUUID();
  const store = new MultiUserStore("unused-postgres-test-directory", randomBytes(32).toString("base64url"));
  const client = getTelegramDatabaseClient()!;
  const ownerIds: string[] = [];
  try {
    await store.initialize();
    const first = await store.createUser(marker);
    ownerIds.push(first.user.id);
    const second = await store.createUser(marker);
    ownerIds.push(second.user.id);
    assert.equal((await store.findUserByAccessToken(first.accessToken))?.id, first.user.id);
    const session = await store.createBrowserSessionForUser(first.user, 1);
    assert.equal((await store.findUserByBrowserSession(session.sessionToken))?.id, first.user.id);
    await store.deleteBrowserSession(session.sessionToken);
    assert.equal(await store.findUserByBrowserSession(session.sessionToken), null);

    const input = {name: "Private test contact", handle: "@synthetic_contact", countryCode: "+91", phone: "0000000000", group: "Synthetic", notes: "Sensitive contact test note"};
    const contact = await store.createContact(first.user.id, input);
    assert.equal((await store.listWorkspaceData(first.user.id)).contacts[0].phone, input.phone);
    assert.equal(await store.updateContact(second.user.id, contact.id, {...input, name: "Foreign edit"}), null);
    assert.equal(await store.deleteContact(second.user.id, contact.id), false);
    const edited = await store.updateContact(first.user.id, contact.id, {...input, name: "Edited private test contact"});
    assert.equal(edited?.name, "Edited private test contact");
    assert.deepEqual(await store.listWorkspaceData(second.user.id), {contacts: [], groups: [], channels: [], profiles: []});
    const groupInput = {name: "Private test group", type: "Private", status: "Created", members: "@synthetic_contact", notes: "Sensitive group test note"};
    const group = await store.createGroup(first.user.id, groupInput);
    assert.equal(await store.updateGroup(second.user.id, group.id, groupInput), null);
    assert.equal(await store.deleteGroup(second.user.id, group.id), false);
    assert.equal((await store.updateGroup(first.user.id, group.id, {...groupInput, name: "Edited group"}))?.name, "Edited group");
    const channelInput = {name: "Private test channel", privacy: "Private", invites: "@synthetic_contact", notes: "Sensitive channel test note"};
    const channel = await store.createChannel(first.user.id, channelInput);
    assert.equal(await store.updateChannel(second.user.id, channel.id, channelInput), null);
    assert.equal(await store.deleteChannel(second.user.id, channel.id), false);
    assert.equal((await store.updateChannel(first.user.id, channel.id, {...channelInput, name: "Edited channel"}))?.name, "Edited channel");

    const accountInput = {telegramApiId: 123456, telegramApiHash: "synthetic-api-hash", telegramUserId: "synthetic_" + randomUUID(), displayName: "Synthetic account", username: "synthetic_user", sessionString: "synthetic-session"};
    const account = (await store.saveTelegramAccount(first.user.id, accountInput)).account;
    await assert.rejects(store.saveTelegramAccount(second.user.id, accountInput), AccountAlreadyLinkedError);
    const profileInput = {profileName: "Private profile", displayName: "Synthetic", username: "synthetic_user", phone: "0000000000", status: "Active", avatar: "", configNumbers: "", description: "Sensitive profile test note"};
    assert.equal((await store.saveProfile(first.user.id, account.id, profileInput)).profileName, profileInput.profileName);
    await assert.rejects(store.saveProfile(second.user.id, account.id, profileInput), /not found/);
    const raw = await client`SELECT record FROM agentic_that.telegram_contacts WHERE id=${contact.id}`;
    assert(!JSON.stringify(raw).includes(input.notes));
    assert(!JSON.stringify(raw).includes(input.phone));

    const timestamp = new Date().toISOString();
    const backup = {contacts: Array.from({length: 100}, (_, index) => ({...input, name: "Bulk contact " + index, id: "contact_" + randomUUID().replaceAll("-", ""), createdAt: timestamp, updatedAt: timestamp})), groups: [], channels: [], profiles: []};
    const restored = await store.importWorkspaceData(first.user.id, backup);
    assert.equal(restored.contacts.length, 101);
    const stale = {...contact, name: "Stale backup contact"};
    await store.importWorkspaceData(first.user.id, {contacts: [stale], groups: [], channels: [], profiles: []});
    assert.equal((await store.listWorkspaceData(first.user.id)).contacts.find(item => item.id === contact.id)?.name, edited?.name);
    await store.importWorkspaceData(first.user.id, {contacts: [stale], groups: [], channels: [], profiles: []}, true);
    assert.equal((await store.listWorkspaceData(first.user.id)).contacts.find(item => item.id === contact.id)?.name, stale.name);
    const original = await store.listWorkspaceData(first.user.id);
    await assert.rejects(store.importWorkspaceData(second.user.id, {contacts: [backup.contacts[0], {...backup.contacts[1], id: "contact_" + randomUUID().replaceAll("-", "")}], groups: [], channels: [], profiles: []}, true), WorkspaceRecordConflictError);
    assert.deepEqual(await store.listWorkspaceData(first.user.id), original);
    assert.deepEqual(await store.listWorkspaceData(second.user.id), {contacts: [], groups: [], channels: [], profiles: []});

    const messageInput = {accountId: account.id, direction: "outbound" as const, recipient: "@synthetic_peer", text: "Synthetic history row", telegramMessageId: "synthetic-concurrent-id"};
    const concurrent = await Promise.all([store.recordMessage(messageInput), store.recordMessage(messageInput)]);
    assert.equal(concurrent[0].id, concurrent[1].id);
    const alias = await store.recordMessage({...messageInput, recipient: "@synthetic_peer +10000000000"});
    assert.equal(alias.id, concurrent[0].id);
    const history = Array.from({length: 100}, (_, index) => ({...messageInput, telegramMessageId: "synthetic-history-" + index}));
    await store.recordMessages(history);
    await store.recordMessages(history);
    assert.equal((await store.listMessages(first.user.id, account.id, 500)).length, 101);

    const post = await store.createPost(first.user.id, {accountId: account.id, title: "Synthetic delivery", type: "text", category: "Test", tags: [], scheduledAt: "", body: "Synthetic delivery checkpoint", mediaUrl: "", mediaUploadId: "", mediaName: "", mediaMimeType: "", mediaSize: 0, recipient: "me", contacts: [], groups: [], targets: [{recipient: "me", source: "Self", firstName: "", kind: "manual"}]});
    await store.queuePost(first.user.id, post.id, timestamp);
    const scheduler = new TelegramPostScheduler(store, async (_post, delivery) => ({recipient: delivery.recipient, messageId: "synthetic_message_" + randomUUID(), sentAt: new Date().toISOString()}));
    const delivered = await scheduler.runPostNow(first.user.id, post.id);
    assert.equal(delivered?.status, "Posted");
    assert.equal(delivered?.deliveries[0].status, "Sent");
    assert.equal((await store.listMessages(first.user.id, account.id, 500)).length, 102);
    await assert.rejects(scheduler.runPostNow(first.user.id, post.id), /scheduled|sending|sent|queue/i);
    await scheduler.stop();
    assert.equal(await store.deletePost(first.user.id, post.id), true);
    assert.equal(await store.deleteContact(first.user.id, contact.id), true);
    assert.equal(await store.deleteGroup(first.user.id, group.id), true);
    assert.equal(await store.deleteChannel(first.user.id, channel.id), true);
  } finally {
    await store.close();
    await client.begin(async tx => {
      for (const id of ownerIds) {
        const [row] = await tx`SELECT display_name,workspace_id,platform_user_id FROM agentic_that.telegram_users WHERE id=${id} FOR UPDATE`;
        assert.equal(row.display_name, marker);
        assert.equal(row.workspace_id, null);
        assert.equal(row.platform_user_id, null);
        await tx`DELETE FROM agentic_that.telegram_users WHERE id=${id}`;
      }
    });
    await client.end({timeout: 5});
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
