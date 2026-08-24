import type { AutomationFileStore } from "./profile-store.ts";
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

  start(workspaceId: string, accountId: string) {
    const result = this.store.createOrGetSession(workspaceId, accountId);
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
      active.browser = await this.launcher.launch(account, profileDirectory);
      if (active.controller.signal.aborted) return;
      this.store.markAwaitingUser(sessionId);
      await active.browser.waitForAuthenticated(active.controller.signal);
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
}
