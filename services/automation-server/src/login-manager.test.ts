import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";
import { createAutomationDatabase } from "./database.ts";
import { AutomationJobStore } from "./job-store.ts";
import { LoginBrowserExpiredError, type LoginBrowserLauncher } from "./login-browser.ts";
import { AutomationLoginManager } from "./login-manager.ts";
import { AutomationLoginStore } from "./login-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { migrateAutomationSchema } from "./schema.ts";

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
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
  let browserClosed = false;
  let verifiedAfterClose = false;
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
        async close() { browserClosed = true; },
      };
    },
    async verifySavedSession() { verifiedAfterClose = browserClosed; },
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
    }, "LIVE", "LOCAL", true);
    const started = await manager.start("login-workspace", account.id, "website");
    await until(async () => (await manager.get("login-workspace", started.id))?.state === "AWAITING_USER");
    assert.equal((await manager.captureFrame("login-workspace", started.id)).toString(), "frame");
    await manager.dispatchInput("login-workspace", started.id, { type: "text", text: "safe test" });
    assert.deepEqual(receivedInput, { type: "text", text: "safe test" });
    assert.equal(accounts.claimDuePublishingJob("worker-during-login", 60), null);
    const duplicate = await manager.start("login-workspace", account.id);
    assert.equal(duplicate.id, started.id);
    assert.equal(launchCount, 1);

    confirmLogin();
    await until(async () => (await manager.get("login-workspace", started.id))?.state === "CONNECTED");
    assert.equal(accounts.listAccounts("login-workspace")[0]?.status, "CONNECTED");
    assert.equal(verifiedAfterClose, true);
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

test("interactive login browsers respect the configured concurrency limit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-login-limit-"));
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
        surface: "website",
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
  const manager = new AutomationLoginManager(sessions, files, launcher, 1);

  try {
    const firstAccount = await accounts.createAccount({
      workspaceId: "limit-workspace",
      platform: "instagram",
      displayName: "First login",
    });
    const secondAccount = await accounts.createAccount({
      workspaceId: "limit-workspace",
      platform: "facebook",
      displayName: "Second login",
    });
    const first = await manager.start("limit-workspace", firstAccount.id, "website");
    await until(async () => (await manager.get("limit-workspace", first.id))?.state === "AWAITING_USER");
    await assert.rejects(
      manager.start("limit-workspace", secondAccount.id, "website"),
      /login browser limit is reached/,
    );
    await manager.cancel("limit-workspace", first.id);
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
    const started = await manager.start("login-workspace", account.id);
    await until(async () => (await manager.get("login-workspace", started.id))?.state === "AWAITING_USER");
    const cancelled = await manager.cancel("login-workspace", started.id);
    assert.equal(cancelled?.state, "CANCELLED");
    assert.equal(accounts.listAccounts("login-workspace")[0]?.status, "PENDING_LOGIN");
  } finally {
    await manager.shutdown();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an expired interactive login is terminal and never connects the account", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-login-expired-"));
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
        surface: "website",
        async waitForAuthenticated() { throw new LoginBrowserExpiredError("Login window expired."); },
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
      displayName: "Expiry test",
    });
    const started = await manager.start("login-workspace", account.id, "website");
    await until(async () => (await manager.get("login-workspace", started.id))?.state === "EXPIRED");
    const expired = await manager.get("login-workspace", started.id);
    assert.equal(expired?.errorCode, "LOGIN_TIMEOUT");
    assert.equal(accounts.listAccounts("login-workspace")[0]?.status, "LOGIN_REQUIRED");
  } finally {
    await manager.shutdown();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("server restart recovery fails interrupted login sessions and requires reconnect", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-login-restart-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();
  const database = createAutomationDatabase(config);
  migrateAutomationSchema(database);
  const accounts = new AutomationJobStore(database, files);
  const beforeRestart = new AutomationLoginStore(database);

  try {
    const account = await accounts.createAccount({
      workspaceId: "restart-workspace",
      platform: "instagram",
      displayName: "Restart test",
    });
    const { session } = beforeRestart.createOrGetSession("restart-workspace", account.id, "website");
    beforeRestart.markAwaitingUser(session.id);

    const afterRestart = new AutomationLoginStore(database);
    assert.equal(afterRestart.recoverInterruptedSessions(), 1);
    const recovered = afterRestart.getSession("restart-workspace", session.id);
    assert.equal(recovered?.state, "FAILED");
    assert.equal(recovered?.errorCode, "SERVER_RESTARTED");
    assert.equal(accounts.listAccounts("restart-workspace")[0]?.status, "LOGIN_REQUIRED");
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
