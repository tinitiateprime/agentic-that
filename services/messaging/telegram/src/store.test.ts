import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
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
