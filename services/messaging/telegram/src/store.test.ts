import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
