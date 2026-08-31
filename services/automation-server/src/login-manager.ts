import type { AutomationFileStore } from "./profile-store.ts";
import type { LoginBrowserInput, LoginSurface } from "./contracts.ts";
import {
  LoginBrowserClosedError,
  LoginBrowserExpiredError,
  type LoginBrowserLauncher,
  type PersistentLoginBrowser,
} from "./login-browser.ts";
import type { AutomationLoginStoreContract } from "./store-contracts.ts";

type ActiveLogin = {
  workspaceId: string;
  accountId: string;
  controller: AbortController;
  browser: PersistentLoginBrowser | null;
  task: Promise<void>;
};

export class AutomationLoginManager {
  private readonly active = new Map<string, ActiveLogin>();
  private starting = 0;

  constructor(
    private readonly store: AutomationLoginStoreContract,
    private readonly files: AutomationFileStore,
    private readonly launcher: LoginBrowserLauncher,
    private readonly maxConcurrent = 1,
  ) {}

  recoverInterruptedSessions() {
    return this.store.recoverInterruptedSessions();
  }

  async start(workspaceId: string, accountId: string, surface: LoginSurface = "visible") {
    for (const [sessionId, current] of this.active) {
      if (current.workspaceId === workspaceId && current.accountId === accountId) {
        const session = await this.store.getSession(workspaceId, sessionId);
        if (session) return session;
      }
    }
    if (this.active.size + this.starting >= this.maxConcurrent) {
      throw new Error("The server login browser limit is reached. Finish or cancel an active login before starting another one.");
    }
    this.starting += 1;
    try {
      const result = await this.store.createOrGetSession(workspaceId, accountId, surface);
      if (!result.created || this.active.has(result.session.id)) return result.session;

      const controller = new AbortController();
      const active: ActiveLogin = {
        workspaceId,
        accountId,
        controller,
        browser: null,
        task: Promise.resolve(),
      };
      this.active.set(result.session.id, active);
      active.task = this.run(result.session.id, result.account, active);
      return result.session;
    } finally {
      this.starting -= 1;
    }
  }

  async captureFrame(workspaceId: string, sessionId: string) {
    await this.requireWebsiteSession(workspaceId, sessionId);
    const browser = this.active.get(sessionId)?.browser;
    if (!browser) throw new Error("The website login browser is still starting.");
    return browser.captureFrame();
  }

  async dispatchInput(workspaceId: string, sessionId: string, input: LoginBrowserInput) {
    await this.requireWebsiteSession(workspaceId, sessionId);
    const browser = this.active.get(sessionId)?.browser;
    if (!browser) throw new Error("The website login browser is still starting.");
    await browser.dispatchInput(input);
  }

  async get(workspaceId: string, sessionId: string) {
    return await this.store.getSession(workspaceId, sessionId);
  }

  async cancel(workspaceId: string, sessionId: string) {
    const session = await this.store.cancel(sessionId, workspaceId);
    if (!session) return null;
    const active = this.active.get(sessionId);
    active?.controller.abort(new Error("Login was cancelled."));
    await active?.browser?.close();
    return await this.store.getSession(workspaceId, sessionId);
  }

  async shutdown() {
    const sessions = [...this.active.entries()];
    for (const [sessionId, active] of sessions) {
      const current = await this.store.getSessionForShutdown(sessionId);
      if (current && ["STARTING", "AWAITING_USER"].includes(current.state)) {
        await this.store.markFailed(
          sessionId,
          "FAILED",
          "SERVER_SHUTDOWN",
          "The local automation server stopped during login. Start login again.",
        );
      }
      active.controller.abort(new Error("The automation server is stopping."));
      await active.browser?.close();
    }
    await Promise.allSettled(sessions.map(([, active]) => active.task));
  }

  private async run(
    sessionId: string,
    account: Parameters<LoginBrowserLauncher["launch"]>[0],
    active: ActiveLogin,
  ) {
    try {
      const expectedProfileVersion = await this.store.getProfileVersion(account.workspaceId, account.id);
      const profileDirectory = await this.files.prepareProfile(account.workspaceId, account.id, expectedProfileVersion);
      if (active.controller.signal.aborted) return;
      const session = await this.store.getSessionForShutdown(sessionId);
      if (!session) throw new Error("The login session was not found.");
      active.browser = await this.launcher.launch(account, profileDirectory, session.surface);
      if (active.controller.signal.aborted) return;
      await this.store.markAwaitingUser(sessionId);
      await active.browser.waitForAuthenticated(active.controller.signal);
      if (active.controller.signal.aborted) return;
      // Close Chrome first so its cookie database is flushed, then prove a
      // fresh worker process can read the same saved session. An account must
      // never be shown as connected based only on the still-open login window.
      await active.browser.close();
      active.browser = null;
      await this.launcher.verifySavedSession?.(account, profileDirectory);
      if (active.controller.signal.aborted) return;
      const savedProfile = await this.files.persistProfile(account.workspaceId, account.id);
      await this.store.markConnected(sessionId, savedProfile);
    } catch (error) {
      const current = await this.store.getSessionForShutdown(sessionId);
      if (!current || !["STARTING", "AWAITING_USER"].includes(current.state)) return;
      const message = error instanceof Error ? error.message : "The Instagram login session failed.";
      if (error instanceof LoginBrowserExpiredError) {
        await this.store.markFailed(sessionId, "EXPIRED", "LOGIN_TIMEOUT", message);
      } else if (error instanceof LoginBrowserClosedError) {
        await this.store.markFailed(sessionId, "FAILED", "BROWSER_CLOSED", message);
      } else if (!active.controller.signal.aborted) {
        await this.store.markFailed(sessionId, "FAILED", "BROWSER_START_FAILED", message);
      }
    } finally {
      await active.browser?.close();
      await this.files.discardPreparedProfile(account.id).catch(() => undefined);
      this.active.delete(sessionId);
    }
  }

  private async requireWebsiteSession(workspaceId: string, sessionId: string) {
    const session = await this.store.getSession(workspaceId, sessionId);
    if (!session) throw new Error("Login session not found.");
    if (session.surface !== "website") throw new Error("This login session does not use the website browser.");
    if (!["STARTING", "AWAITING_USER"].includes(session.state)) {
      throw new Error("The website login browser is no longer active.");
    }
    return session;
  }
}
