import type { AutomationFileStore } from "./profile-store.ts";
import type { LoginBrowserInput, LoginSurface } from "./contracts.ts";
import {
  LoginBrowserClosedError,
  LoginBrowserExpiredError,
  type LoginBrowserLauncher,
  type PersistentLoginBrowser,
} from "./login-browser.ts";
import { AutomationLoginStore } from "./login-store.ts";

type ActiveLogin = {
  controller: AbortController;
  browser: PersistentLoginBrowser | null;
  task: Promise<void>;
};

export class AutomationLoginManager {
  private readonly active = new Map<string, ActiveLogin>();

  constructor(
    private readonly store: AutomationLoginStore,
    private readonly files: AutomationFileStore,
    private readonly launcher: LoginBrowserLauncher,
  ) {}

  recoverInterruptedSessions() {
    return this.store.recoverInterruptedSessions();
  }

  start(workspaceId: string, accountId: string, surface: LoginSurface = "visible") {
    const result = this.store.createOrGetSession(workspaceId, accountId, surface);
    if (!result.created || this.active.has(result.session.id)) return result.session;

    const controller = new AbortController();
    const active: ActiveLogin = {
      controller,
      browser: null,
      task: Promise.resolve(),
    };
    this.active.set(result.session.id, active);
    active.task = this.run(result.session.id, result.account, active);
    return result.session;
  }

  async captureFrame(workspaceId: string, sessionId: string) {
    this.requireWebsiteSession(workspaceId, sessionId);
    const browser = this.active.get(sessionId)?.browser;
    if (!browser) throw new Error("The website login browser is still starting.");
    return browser.captureFrame();
  }

  async dispatchInput(workspaceId: string, sessionId: string, input: LoginBrowserInput) {
    this.requireWebsiteSession(workspaceId, sessionId);
    const browser = this.active.get(sessionId)?.browser;
    if (!browser) throw new Error("The website login browser is still starting.");
    await browser.dispatchInput(input);
  }

  get(workspaceId: string, sessionId: string) {
    return this.store.getSession(workspaceId, sessionId);
  }

  async cancel(workspaceId: string, sessionId: string) {
    const session = this.store.cancel(sessionId, workspaceId);
    if (!session) return null;
    const active = this.active.get(sessionId);
    active?.controller.abort(new Error("Login was cancelled."));
    await active?.browser?.close();
    return this.store.getSession(workspaceId, sessionId);
  }

  async shutdown() {
    const sessions = [...this.active.entries()];
    for (const [sessionId, active] of sessions) {
      const current = this.store.getSessionForShutdown(sessionId);
      if (current && ["STARTING", "AWAITING_USER"].includes(current.state)) {
        this.store.markFailed(
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
      const profileDirectory = await this.files.ensureDevelopmentProfile(account.id);
      if (active.controller.signal.aborted) return;
      const session = this.store.getSessionForShutdown(sessionId);
      if (!session) throw new Error("The login session was not found.");
      active.browser = await this.launcher.launch(account, profileDirectory, session.surface);
      if (active.controller.signal.aborted) return;
      this.store.markAwaitingUser(sessionId);
      await active.browser.waitForAuthenticated(active.controller.signal);
      if (active.controller.signal.aborted) return;
      // Close Chrome first so its cookie database is flushed, then prove a
      // fresh worker process can read the same saved session. An account must
      // never be shown as connected based only on the still-open login window.
      await active.browser.close();
      active.browser = null;
      await this.launcher.verifySavedSession?.(account, profileDirectory);
      if (active.controller.signal.aborted) return;
      this.store.markConnected(sessionId);
    } catch (error) {
      const current = this.store.getSessionForShutdown(sessionId);
      if (!current || !["STARTING", "AWAITING_USER"].includes(current.state)) return;
      const message = error instanceof Error ? error.message : "The Instagram login session failed.";
      if (error instanceof LoginBrowserExpiredError) {
        this.store.markFailed(sessionId, "EXPIRED", "LOGIN_TIMEOUT", message);
      } else if (error instanceof LoginBrowserClosedError) {
        this.store.markFailed(sessionId, "FAILED", "BROWSER_CLOSED", message);
      } else if (!active.controller.signal.aborted) {
        this.store.markFailed(sessionId, "FAILED", "BROWSER_START_FAILED", message);
      }
    } finally {
      await active.browser?.close();
      this.active.delete(sessionId);
    }
  }

  private requireWebsiteSession(workspaceId: string, sessionId: string) {
    const session = this.store.getSession(workspaceId, sessionId);
    if (!session) throw new Error("Login session not found.");
    if (session.surface !== "website") throw new Error("This login session does not use the website browser.");
    if (!["STARTING", "AWAITING_USER"].includes(session.state)) {
      throw new Error("The website login browser is no longer active.");
    }
    return session;
  }
}
