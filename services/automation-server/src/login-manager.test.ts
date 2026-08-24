import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";
import { createAutomationDatabase } from "./database.ts";
import { AutomationJobStore } from "./job-store.ts";
import type { LoginBrowserLauncher } from "./login-browser.ts";
import { AutomationLoginManager } from "./login-manager.ts";
import { AutomationLoginStore } from "./login-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { migrateAutomationSchema } from "./schema.ts";

async function until(check: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the login test state.");
}

test("Instagram login uses one persistent account session and marks the profile connected", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-login-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();
  const database = createAutomationDatabase(config);
  migrateAutomationSchema(database);
  const accounts = new AutomationJobStore(database, files);
  const sessions = new AutomationLoginStore(database);
  let launchCount = 0;
  let receivedInput: unknown = null;
  let confirmLogin = () => {};
  const authenticated = new Promise<void>(resolve => { confirmLogin = resolve; });
  const launcher: LoginBrowserLauncher = {
    async launch(_account, _profileDirectory, surface) {
      launchCount += 1;
      return {
        surface,
        waitForAuthenticated() {
          return authenticated;
        },
        async captureFrame() { return Buffer.from("frame"); },
        async dispatchInput(input) { receivedInput = input; },
        async close() {},
      };
    },
  };
  const manager = new AutomationLoginManager(sessions, files, launcher);

  try {
    const account = await accounts.createAccount({
      workspaceId: "login-workspace",
      platform: "instagram",
      displayName: "Instagram test",
    });
    database.prepare("UPDATE social_accounts SET status = 'CONNECTED' WHERE id = ?").run(account.id);
    accounts.createPublishingJob({
      workspaceId: "login-workspace",
      accountId: account.id,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      originalTimezone: "UTC",
      caption: "Must wait for login",
      media: [],
      idempotencyKey: "login-lock-test",
    });
    const started = manager.start("login-workspace", account.id, "website");
    await until(() => manager.get("login-workspace", started.id)?.state === "AWAITING_USER");
    assert.equal((await manager.captureFrame("login-workspace", started.id)).toString(), "frame");
    await manager.dispatchInput("login-workspace", started.id, { type: "text", text: "safe test" });
    assert.deepEqual(receivedInput, { type: "text", text: "safe test" });
    assert.equal(accounts.claimDuePublishingJob("worker-during-login", 60), null);
    const duplicate = manager.start("login-workspace", account.id);
    assert.equal(duplicate.id, started.id);
    assert.equal(launchCount, 1);

    confirmLogin();
    await until(() => manager.get("login-workspace", started.id)?.state === "CONNECTED");
    assert.equal(accounts.listAccounts("login-workspace")[0]?.status, "CONNECTED");
    const profile = database.prepare(`
      SELECT version, last_saved_at FROM browser_profiles WHERE account_id = ?
    `).get(account.id) as { version: number; last_saved_at: string | null };
    assert.equal(profile.version, 1);
    assert.ok(profile.last_saved_at);
  } finally {
    await manager.shutdown();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a user can cancel an active login without connecting the account", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-login-cancel-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();
  const database = createAutomationDatabase(config);
  migrateAutomationSchema(database);
  const accounts = new AutomationJobStore(database, files);
  const sessions = new AutomationLoginStore(database);
  const launcher: LoginBrowserLauncher = {
    async launch() {
      return {
        surface: "visible",
        waitForAuthenticated(signal) {
          return new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
        async captureFrame() { return Buffer.from("frame"); },
        async dispatchInput() {},
        async close() {},
      };
    },
  };
  const manager = new AutomationLoginManager(sessions, files, launcher);

  try {
    const account = await accounts.createAccount({
      workspaceId: "login-workspace",
      platform: "instagram",
      displayName: "Cancel test",
    });
    const started = manager.start("login-workspace", account.id);
    await until(() => manager.get("login-workspace", started.id)?.state === "AWAITING_USER");
    const cancelled = await manager.cancel("login-workspace", started.id);
    assert.equal(cancelled?.state, "CANCELLED");
    assert.equal(accounts.listAccounts("login-workspace")[0]?.status, "PENDING_LOGIN");
  } finally {
    await manager.shutdown();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
