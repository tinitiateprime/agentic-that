import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AccountAlreadyLinkedError, MultiUserStore } from "./store.ts";

const accountInput = (sessionString: string) => ({
  telegramApiId: 123456,
  telegramApiHash: "test-api-hash",
  telegramUserId: "telegram-user-42",
  displayName: "Verified Telegram User",
  username: "verified_user",
  sessionString
});

test("Telegram inbox batches keep provider IDs distinct by peer and merge aliases without duplicate messages", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agentic-that-telegram-history-"));
  const store = new MultiUserStore(dataDir, randomBytes(32).toString("base64url"));
  try {
    await store.initialize();
    const owner = (await store.createUser("Inbox batch owner")).user;
    const account = (await store.saveTelegramAccount(owner.id, accountInput("inbox-session"))).account;
    const first = {accountId: account.id, direction: "outbound" as const, recipient: "@first_user", text: "Private first message", telegramMessageId: "101"};
    const other = {...first, recipient: "@other_user", text: "Private other message"};
    const rows = await store.recordMessages([first, other, first]);
    assert.equal(rows[0].id, rows[2].id);
    assert.notEqual(rows[0].id, rows[1].id);
    const alias = await store.recordMessage({...first, recipient: "@first_user +10000000000 12345"});
    assert.equal(alias.id, rows[0].id);
    assert(alias.recipient.includes("+10000000000"));
    const replay = await Promise.all([store.recordMessage(first), store.recordMessage({...first, recipient: "first_user"})]);
    assert(replay.every(row => row.id === rows[0].id));
    assert.equal((await store.listMessages(owner.id, account.id)).length, 2);
    const batch = Array.from({length: 100}, (_, index) => ({...first, telegramMessageId: String(index + 200)}));
    await store.recordMessages(batch);
    await store.recordMessages(batch);
    assert.equal((await store.listMessages(owner.id, account.id, 500)).length, 102);
    const raw = await readFile(path.join(dataDir, "store.json"), "utf8");
    assert(!raw.includes(first.text));
    assert(!raw.includes(other.text));
  } finally {
    await store.close();
    const absolute = path.resolve(dataDir);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert(path.basename(absolute).startsWith("agentic-that-telegram-history-"));
    await rm(absolute, {recursive: true, force: true});
  }
});

test("login challenges replace only their owner's code, enforce expiry, and retain the encrypted two-factor session", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agentic-that-telegram-login-"));
  const store = new MultiUserStore(dataDir, randomBytes(32).toString("base64url"));
  try {
    await store.initialize();
    const first = (await store.createUser("First login workspace")).user;
    const second = (await store.createUser("Second login workspace")).user;
    const challenge = await store.createLoginChallenge(first.id, 123456, "private-api-hash", "+10000000000", "private-code-hash", "private-session", 10);
    const other = await store.createLoginChallenge(second.id, 234567, "other-api-hash", "+10000000001", "other-code-hash", "other-session", 10);
    assert.equal(await store.getLoginChallenge(second.id, challenge.id), null);
    await store.markPasswordRequired(second.id, challenge.id, "unauthorized-session");
    assert.equal((await store.getLoginChallenge(first.id, challenge.id))?.status, "code_sent");
    await store.markPasswordRequired(first.id, challenge.id, "private-two-factor-session");
    const passwordChallenge = await store.getLoginChallenge(first.id, challenge.id);
    assert.equal(passwordChallenge?.status, "password_required");
    assert.equal(passwordChallenge?.sessionString, "private-two-factor-session");
    const raw = await readFile(path.join(dataDir, "store.json"), "utf8");
    for (const secret of ["private-api-hash", "private-code-hash", "private-two-factor-session", "+10000000000"]) assert(!raw.includes(secret));
    const replacement = await store.createLoginChallenge(first.id, 123456, "private-api-hash", "+10000000000", "new-code-hash", "new-session", 10);
    assert.equal(await store.getLoginChallenge(first.id, challenge.id), null);
    assert((await store.getLoginChallenge(second.id, other.id)));
    await store.deleteLoginChallenge(second.id, replacement.id);
    assert((await store.getLoginChallenge(first.id, replacement.id)));
    await store.deleteLoginChallenge(first.id, replacement.id);
    assert.equal(await store.getLoginChallenge(first.id, replacement.id), null);
    const expired = await store.createLoginChallenge(first.id, 123456, "private-api-hash", "+10000000000", "expired-code", "expired-session", -1);
    assert.equal(await store.getLoginChallenge(first.id, expired.id), null);
  } finally {
    await store.close();
    const absolute = path.resolve(dataDir);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert(path.basename(absolute).startsWith("agentic-that-telegram-login-"));
    await rm(absolute, {recursive: true, force: true});
  }
});

test("a freshly verified Telegram login can securely move an existing account", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agentic-that-telegram-store-"));
  const encryptionKey = randomBytes(32).toString("base64url");
  const store = new MultiUserStore(dataDir, encryptionKey);

  try {
    await store.initialize();
    const firstUser = (await store.createUser("First workspace")).user;
    const currentUser = (await store.createUser("Current workspace")).user;
    const firstSave = await store.saveTelegramAccount(firstUser.id, accountInput("old-encrypted-session"));

    assert.equal(firstSave.transferred, false);
    await assert.rejects(
      store.saveTelegramAccount(currentUser.id, accountInput("unverified-session")),
      AccountAlreadyLinkedError
    );

    const verifiedSave = await store.saveTelegramAccount(
      currentUser.id,
      accountInput("new-verified-session"),
      { allowVerifiedTransfer: true }
    );

    assert.equal(verifiedSave.transferred, true);
    assert.equal(verifiedSave.account.id, firstSave.account.id);
    assert.deepEqual(await store.listAccounts(firstUser.id), []);
    assert.deepEqual(await store.listAccounts(currentUser.id), [verifiedSave.account]);
    assert.equal(
      (await store.getAccountWithSession(currentUser.id, verifiedSave.account.id))?.sessionString,
      "new-verified-session"
    );

    const refreshedSave = await store.saveTelegramAccount(
      currentUser.id,
      accountInput("refreshed-session"),
      { allowVerifiedTransfer: true }
    );
    assert.equal(refreshedSave.transferred, false);
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("repeated platform authentication reuses the workspace identity", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agentic-that-telegram-store-"));
  const encryptionKey = randomBytes(32).toString("base64url");
  const store = new MultiUserStore(dataDir, encryptionKey);

  try {
    await store.initialize();
    const first = await store.findOrCreatePlatformWorkspaceUser(
      "workspace-one",
      "platform-user-one",
      "First user",
      "configure"
    );
    const repeated = await store.findOrCreatePlatformWorkspaceUser(
      "workspace-one",
      "platform-user-two",
      "Second user",
      "view"
    );
    const otherWorkspace = await store.findOrCreatePlatformWorkspaceUser(
      "workspace-two",
      "platform-user-one",
      "First user",
      "configure"
    );

    assert.equal(repeated.id, first.id);
    assert.equal(repeated.platformUserId, "platform-user-two");
    assert.equal(repeated.displayName, "Second user");
    assert.equal(repeated.accessLevel, "view");
    assert.notEqual(otherWorkspace.id, first.id);
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("local Telegram persistence is private on Linux", { skip: process.platform === "win32" }, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agentic-that-telegram-store-"));
  const store = new MultiUserStore(dataDir, randomBytes(32).toString("base64url"));

  try {
    await store.initialize();
    await store.createUser("Private workspace");
    assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(dataDir, "store.json"))).mode & 0o777, 0o600);
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("scheduled Telegram posts are durable, workspace scoped, and checkpoint each recipient", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agentic-that-telegram-scheduler-store-"));
  const encryptionKey = randomBytes(32).toString("base64url");
  const store = new MultiUserStore(dataDir, encryptionKey);
  try {
    await store.initialize();
    const owner = (await store.createUser("Scheduling workspace")).user;
    const outsider = (await store.createUser("Other workspace")).user;
    const account = (await store.saveTelegramAccount(owner.id, accountInput("scheduled-session"))).account;
    const post = await store.createPost(owner.id, {
      accountId: account.id,
      title: "Durable announcement",
      type: "text",
      category: "Operations",
      tags: ["scheduled"],
      scheduledAt: "",
      body: "Server-side Telegram post",
      mediaUrl: "",
      mediaUploadId: "",
      mediaName: "",
      mediaMimeType: "",
      mediaSize: 0,
      recipient: "@first",
      contacts: [],
      groups: [],
      targets: [
        { recipient: "@first", source: "First", firstName: "First", kind: "contact" },
        { recipient: "@second", source: "Second", firstName: "Second", kind: "contact" },
      ],
    });
    await store.queuePost(owner.id, post.id, new Date(Date.now() - 1_000).toISOString());
    assert.deepEqual(await store.listPosts(outsider.id), []);

    const claim = await store.claimDuePost("worker-one");
    assert.equal(claim?.id, post.id);
    const first = await store.claimNextPostDelivery(post.id, "worker-one");
    assert.equal(first?.recipient, "@first");
    await store.completePostDelivery(post.id, "worker-one", first!.id, {
      status: "Sent",
      sentAt: new Date().toISOString(),
      telegramMessageId: "1001",
    });
    const second = await store.claimNextPostDelivery(post.id, "worker-one");
    await store.completePostDelivery(post.id, "worker-one", second!.id, {
      status: "Failed",
      error: "recipient unavailable",
    });
    const finished = await store.finishClaimedPost(post.id, "worker-one");
    assert.equal(finished?.status, "Partially failed");
    assert.deepEqual(finished?.deliveries.map((delivery) => delivery.status), ["Sent", "Failed"]);
    await store.close();

    const reopened = new MultiUserStore(dataDir, encryptionKey);
    await reopened.initialize();
    const persisted = await reopened.listPosts(owner.id);
    assert.equal(persisted[0]?.status, "Partially failed");
    assert.equal(persisted[0]?.body, "Server-side Telegram post");
    await reopened.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an interrupted Telegram delivery is not retried after its server lease expires", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agentic-that-telegram-recovery-"));
  const store = new MultiUserStore(dataDir, randomBytes(32).toString("base64url"));
  try {
    await store.initialize();
    const owner = (await store.createUser("Recovery workspace")).user;
    const account = (await store.saveTelegramAccount(owner.id, accountInput("recovery-session"))).account;
    const post = await store.createPost(owner.id, {
      accountId: account.id,
      title: "Safe recovery",
      type: "text",
      category: "",
      tags: [],
      scheduledAt: "",
      body: "Do not duplicate this message",
      mediaUrl: "",
      mediaUploadId: "",
      mediaName: "",
      mediaMimeType: "",
      mediaSize: 0,
      recipient: "",
      contacts: [],
      groups: [],
      targets: [
        { recipient: "@first", source: "First", firstName: "First", kind: "contact" },
        { recipient: "@second", source: "Second", firstName: "Second", kind: "contact" },
      ],
    });
    const claimedAt = new Date();
    await store.queuePost(owner.id, post.id, new Date(claimedAt.getTime() - 1_000).toISOString());
    await store.claimDuePost("stopped-worker", claimedAt, 60_000);
    const interrupted = await store.claimNextPostDelivery(post.id, "stopped-worker");
    assert.equal(interrupted?.recipient, "@first");

    const recovered = await store.claimDuePost("replacement-worker", new Date(claimedAt.getTime() + 61_000));
    assert.equal(recovered?.deliveries[0]?.status, "Failed");
    assert.match(recovered?.deliveries[0]?.error || "", /not retried to prevent a duplicate/);
    const next = await store.claimNextPostDelivery(post.id, "replacement-worker");
    assert.equal(next?.recipient, "@second");
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Telegram workspace contacts, groups, channels, and profiles are encrypted and workspace scoped", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agentic-that-telegram-workspace-"));
  const encryptionKey = randomBytes(32).toString("base64url");
  const store = new MultiUserStore(dataDir, encryptionKey);
  try {
    await store.initialize();
    const owner = (await store.createUser("Workspace owner")).user;
    const outsider = (await store.createUser("Other workspace")).user;
    const account = (await store.saveTelegramAccount(owner.id, accountInput("workspace-session"))).account;
    const contact = await store.createContact(owner.id, {
      name: "Private contact",
      handle: "@private_contact",
      countryCode: "+91",
      phone: "+919999999999",
      group: "Customers",
      notes: "Sensitive contact note",
    });
    const group = await store.createGroup(owner.id, {
      name: "Launch list",
      type: "Broadcast",
      status: "Created",
      members: "@private_contact\n+918888888888",
      notes: "Sensitive group note",
    });
    const channel = await store.createChannel(owner.id, {
      name: "Announcements",
      privacy: "Private",
      invites: "https://t.me/example",
      notes: "Sensitive channel note",
    });
    const profile = await store.saveProfile(owner.id, account.id, {
      profileName: "Support sender",
      displayName: "Support",
      username: "support_sender",
      phone: "+917777777777",
      status: "Active",
      avatar: "",
      configNumbers: "primary",
      description: "Sensitive profile note",
    });

    assert.match(contact.id, /^contact_/);
    assert.match(group.id, /^group_/);
    assert.match(channel.id, /^channel_/);
    assert.equal(profile.accountId, account.id);
    assert.deepEqual(await store.listWorkspaceData(outsider.id), { contacts: [], groups: [], channels: [], profiles: [] });
    assert.equal(await store.updateContact(outsider.id, contact.id, { ...contact, name: "Wrong workspace" }), null);
    await assert.rejects(store.saveProfile(outsider.id, account.id, profile), /not found/);

    const raw = await readFile(path.join(dataDir, "store.json"), "utf8");
    assert.doesNotMatch(raw, /Sensitive contact note|Sensitive group note|Sensitive channel note|Sensitive profile note/);
    await store.close();

    const reopened = new MultiUserStore(dataDir, encryptionKey);
    await reopened.initialize();
    const workspace = await reopened.listWorkspaceData(owner.id);
    assert.equal(workspace.contacts[0]?.phone, "+919999999999");
    assert.equal(workspace.groups[0]?.members, "@private_contact\n+918888888888");
    assert.equal(workspace.channels[0]?.name, "Announcements");
    assert.equal(workspace.profiles[0]?.profileName, "Support sender");
    await reopened.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("legacy Telegram workspace import preserves IDs and does not overwrite server edits unless requested", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agentic-that-telegram-import-"));
  const store = new MultiUserStore(dataDir, randomBytes(32).toString("base64url"));
  try {
    await store.initialize();
    const owner = (await store.createUser("Import owner")).user;
    const account = (await store.saveTelegramAccount(owner.id, accountInput("import-session"))).account;
    const importedAt = new Date().toISOString();
    const backup = {
      contacts: [{ id: "contact_legacy-one", name: "Legacy", handle: "@legacy", countryCode: "+91", phone: "", group: "", notes: "first", createdAt: importedAt, updatedAt: importedAt }],
      groups: [{ id: "group_legacy-one", name: "Legacy group", type: "Broadcast", status: "Created", members: "@legacy", notes: "", createdAt: importedAt, updatedAt: importedAt }],
      channels: [{ id: "channel_legacy-one", name: "Legacy channel", privacy: "Private", invites: "", notes: "", createdAt: importedAt, updatedAt: importedAt }],
      profiles: [{ accountId: account.id, profileName: "Legacy profile", displayName: "", username: "", phone: "", status: "Active", avatar: "", configNumbers: "", description: "", updatedAt: importedAt }],
    };
    await store.importWorkspaceData(owner.id, backup);
    await store.importWorkspaceData(owner.id, { ...backup, contacts: [{ ...backup.contacts[0], name: "Stale local copy" }] });
    assert.equal((await store.listWorkspaceData(owner.id)).contacts[0]?.name, "Legacy");
    await store.importWorkspaceData(owner.id, { ...backup, contacts: [{ ...backup.contacts[0], name: "Restored backup" }] }, true);
    const restored = await store.listWorkspaceData(owner.id);
    assert.equal(restored.contacts[0]?.id, "contact_legacy-one");
    assert.equal(restored.contacts[0]?.name, "Restored backup");
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
