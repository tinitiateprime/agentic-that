import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TelegramPostScheduler } from "./post-scheduler.ts";
import { MultiUserStore } from "./store.ts";

test("the server scheduler sends due posts and stores confirmed delivery history", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "agentic-that-telegram-scheduler-"));
  const store = new MultiUserStore(dataDir, randomBytes(32).toString("base64url"));
  try {
    await store.initialize();
    const user = (await store.createUser("Scheduler user")).user;
    const account = (await store.saveTelegramAccount(user.id, {
      telegramApiId: 123456,
      telegramApiHash: "test-api-hash",
      telegramUserId: "scheduler-telegram-user",
      displayName: "Scheduler sender",
      username: "scheduler_sender",
      sessionString: "encrypted-session",
    })).account;
    const post = await store.createPost(user.id, {
      accountId: account.id,
      title: "Server post",
      type: "text",
      category: "",
      tags: [],
      scheduledAt: "",
      body: "Hello from Ubuntu",
      mediaUrl: "",
      mediaUploadId: "",
      mediaName: "",
      mediaMimeType: "",
      mediaSize: 0,
      recipient: "@recipient",
      contacts: [],
      groups: [],
      targets: [{ recipient: "@recipient", source: "Manual", firstName: "Recipient", kind: "manual" }],
    });
    await store.queuePost(user.id, post.id, new Date(Date.now() - 1_000).toISOString());

    const calls: string[] = [];
    const scheduler = new TelegramPostScheduler(store, async (claimed, delivery) => {
      calls.push(`${claimed.id}:${delivery.recipient}`);
      return { recipient: delivery.recipient, messageId: "telegram-message-1", sentAt: new Date().toISOString() };
    }, 60_000, 1);
    const finished = await scheduler.runOnce();
    assert.equal(finished?.status, "Posted");
    assert.deepEqual(calls, [`${post.id}:@recipient`]);
    const messages = await store.listMessages(user.id, account.id);
    assert.equal(messages[0]?.telegramMessageId, "telegram-message-1");
    assert.equal(messages[0]?.text, "Hello from Ubuntu");
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
