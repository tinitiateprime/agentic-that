// Messenger and Instagram have no API for group chats, so they run in the
// user's own logged-in browser: a dedicated Chrome or Edge profile for each
// workspace and app (the same real-browser engine as Social SEO and
// publishing). The user logs in once in a visible window; after that the
// window works off screen, one action at a time, and closes when idle. If the
// app asks the user to confirm it's them, the window comes back on screen.

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import {
  externalBrowserExecutablePath,
  getFreePort,
  prepareExternalBrowserProfile,
  waitForDebugEndpoint,
  waitForProcessExit,
} from "../../engines/external-browser/index.js";
import { setWindowPresence } from "../chat-ai/native-window.js";
import type { ConnectionState } from "./engine.js";
import { APP_LABELS, type GroupApp } from "./model.js";
import { readSecureFile, removeSecureFile, writeSecureFile } from "./secure-file.js";

export type BrowserApp = Extract<GroupApp, "messenger" | "instagram">;

export type BrowserAppSpec = {
  app: BrowserApp;
  loginUrl: string;
  homeUrl: string;
  /** Cookies that exist only while logged in. */
  sessionCookies: string[];
  /** The logged-in account's name, for "Connected as …". */
  accountName(page: Page, cookies: Record<string, string>): Promise<string>;
  /** A page where the app wants the user (security check, captcha, two-factor code). */
  needsUser(url: string): boolean;
};

/** The app wants the user to do something in its window (shown on screen). */
export class NeedsUserError extends Error {}

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_CLOSE_MS = 2 * 60 * 1000;
const VISIBLE_BOUNDS = { left: 80, top: 50, width: 1200, height: 860 };
const HIDDEN_BOUNDS = { left: -10_000, top: -10_000, width: 1280, height: 900 };
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Window = { process: ChildProcess; browser: Browser; context: BrowserContext; page: Page; cdp: CDPSession; windowId?: number; closed: boolean };
type Saved = { account: string; connectedAt: string };

export class BrowserAppSession {
  readonly label: string;
  private readonly profileDir: string;
  private readonly file: string;
  private window: Window | null = null;
  private opening: Promise<Window> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;
  private state: ConnectionState["state"] = "disconnected";
  private detail = "";
  private account = "";
  private loginRun = 0;

  constructor(directory: string, private readonly spec: BrowserAppSpec) {
    this.label = APP_LABELS[spec.app];
    this.profileDir = path.join(directory, `browser-${spec.app}`);
    this.file = path.join(directory, `${spec.app}.json`);
    const saved = readSecureFile<Saved | null>(this.file, null);
    if (saved && fs.existsSync(this.profileDir)) {
      this.state = "connected";
      this.account = saved.account;
    }
  }

  connection(): ConnectionState {
    return { app: this.spec.app, state: this.state, account: this.account || undefined, detail: this.detail || undefined };
  }

  // ---- The browser window ------------------------------------------------------------------

  private async launch(url: string, visible: boolean): Promise<Window> {
    fs.mkdirSync(this.profileDir, { recursive: true });
    prepareExternalBrowserProfile(this.profileDir);
    const port = await getFreePort();
    const bounds = visible ? VISIBLE_BOUNDS : HIDDEN_BOUNDS;
    const child = spawn(externalBrowserExecutablePath(), [
      `--user-data-dir=${this.profileDir}`,
      "--profile-directory=Default",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      // Keep working at full speed while the window is off screen.
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      `--window-position=${bounds.left},${bounds.top}`,
      `--window-size=${bounds.width},${bounds.height}`,
      "--new-window",
      url,
    ], { stdio: "ignore", windowsHide: false });
    try {
      const browser = await chromium.connectOverCDP(await waitForDebugEndpoint(port, child));
      const context = browser.contexts()[0];
      if (!context) throw new Error("The browser did not open its profile.");
      const host = new URL(url).hostname;
      const page = context.pages().find((candidate) => candidate.url().includes(host)) ?? context.pages()[0] ?? (await context.newPage());
      const cdp = await context.newCDPSession(page);
      const target = (await cdp.send("Browser.getWindowForTarget").catch(() => ({}))) as { windowId?: number };
      const window: Window = { process: child, browser, context, page, cdp, windowId: target.windowId, closed: false };
      const gone = () => {
        window.closed = true;
        if (this.window === window) this.window = null;
      };
      browser.on("disconnected", gone);
      child.once("exit", gone);
      if (visible) await this.showWindow(window);
      else void setWindowPresence(child.pid, "background").then(() => sleep(2500)).then(() => (window.closed ? 0 : setWindowPresence(child.pid, "background")));
      this.window = window;
      return window;
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  /** The app's window: the open one, or a new one at `url`. */
  private async open(url: string, visible: boolean) {
    if (this.window && !this.window.closed && !this.window.page.isClosed()) {
      if (visible) await this.showWindow(this.window);
      return this.window;
    }
    if (!this.opening) this.opening = this.launch(url, visible).finally(() => (this.opening = null));
    const window = await this.opening;
    if (visible) await this.showWindow(window);
    return window;
  }

  private async setBounds(window: Window, bounds: typeof VISIBLE_BOUNDS) {
    if (typeof window.windowId !== "number") return;
    await window.cdp.send("Browser.setWindowBounds", { windowId: window.windowId, bounds: { windowState: "normal" } }).catch(() => undefined);
    await window.cdp.send("Browser.setWindowBounds", { windowId: window.windowId, bounds }).catch(() => undefined);
  }

  private async showWindow(window: Window) {
    await this.setBounds(window, VISIBLE_BOUNDS);
    await setWindowPresence(window.process.pid, "foreground");
    await window.page.bringToFront().catch(() => undefined);
  }

  private async hideWindow(window: Window) {
    await this.setBounds(window, HIDDEN_BOUNDS);
    await setWindowPresence(window.process.pid, "background");
  }

  async close() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const window = this.window;
    this.window = null;
    if (!window) return;
    window.closed = true;
    // Ask Chrome itself to quit, so it writes the login to disk first. (Disconnecting
    // Playwright leaves Chrome running, and killing it can lose a login made moments ago.)
    await Promise.race([window.cdp.send("Browser.close").catch(() => undefined), sleep(3000)]);
    if (!(await waitForProcessExit(window.process, 15_000))) window.process.kill();
    await window.browser.close().catch(() => undefined);
  }

  private closeWhenIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  private async cookies(context: BrowserContext) {
    const list = await context.cookies(this.spec.homeUrl).catch(() => []);
    return Object.fromEntries(list.map((cookie) => [cookie.name, cookie.value]));
  }

  private async loggedIn(context: BrowserContext) {
    const cookies = await this.cookies(context);
    return this.spec.sessionCookies.every((name) => Boolean(cookies[name]));
  }

  // ---- Connecting -------------------------------------------------------------------------

  /** Opens the app's login page in a visible window; connected once the user has logged in. */
  async connect(): Promise<ConnectionState> {
    if (this.state === "connecting" && this.window) {
      await this.showWindow(this.window);
      return this.connection();
    }
    const run = ++this.loginRun;
    this.state = "connecting";
    this.detail = `Log in to ${this.label} in the window that opened. You stay logged in on this computer.`;
    let window: Window;
    try {
      window = await this.open(this.spec.loginUrl, true);
      await window.page.goto(this.spec.loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    } catch (error) {
      this.state = "disconnected";
      this.detail = error instanceof Error ? error.message : String(error);
      throw error;
    }
    void this.waitForLogin(window, run);
    return this.connection();
  }

  private async waitForLogin(window: Window, run: number) {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline && !window.closed && run === this.loginRun) {
      if (await this.loggedIn(window.context) && !this.spec.needsUser(window.page.url())) {
        // Let the app finish saving the login, then read who logged in.
        await sleep(2500);
        const cookies = await this.cookies(window.context);
        this.account = await this.spec.accountName(window.page, cookies).catch(() => "");
        writeSecureFile(this.file, { account: this.account, connectedAt: new Date().toISOString() } satisfies Saved);
        this.state = "connected";
        this.detail = "";
        await this.close();
        return;
      }
      await sleep(1500);
    }
    if (run !== this.loginRun || this.state !== "connecting") return;
    this.state = "disconnected";
    this.detail = window.closed ? "The login window was closed before logging in. Try again." : "Logging in took too long. Try again.";
    await this.close();
  }

  async disconnect(): Promise<ConnectionState> {
    this.loginRun += 1;
    await this.close();
    removeSecureFile(this.file);
    await fsp.rm(this.profileDir, { recursive: true, force: true }).catch(() => undefined);
    this.state = "disconnected";
    this.detail = "";
    this.account = "";
    return this.connection();
  }

  /** Brings the window on screen (for example to finish a security check). */
  async show() {
    const window = await this.open(this.spec.homeUrl, true);
    return window.page;
  }

  // ---- Work -------------------------------------------------------------------------------

  /** Runs one piece of work in the logged-in app, one at a time. */
  run<T>(task: (page: Page) => Promise<T>): Promise<T> {
    const job = this.queue.then(() => this.runNow(task));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async runNow<T>(task: (page: Page) => Promise<T>): Promise<T> {
    if (this.state === "connecting") throw new Error(`Finish logging in to ${this.label} first.`);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const window = await this.open(this.spec.homeUrl, false);
    try {
      if (!(await this.loggedIn(window.context))) {
        removeSecureFile(this.file);
        this.state = "disconnected";
        this.detail = `${this.label} logged this computer out. Connect ${this.label} again.`;
        throw new Error(this.detail);
      }
      if (this.detail && this.state === "connected") this.detail = "";
      return await task(window.page);
    } catch (error) {
      if (error instanceof NeedsUserError || this.spec.needsUser(window.page.url())) {
        await this.showWindow(window);
        this.detail = error instanceof NeedsUserError
          ? `${error.message} Do it in the ${this.label} window that opened, then press Try again.`
          : `${this.label} wants to confirm it's you. Finish it in the ${this.label} window that opened, then press Try again.`;
        throw new Error(this.detail);
      }
      throw error;
    } finally {
      if (!window.closed && !this.detail) await this.hideWindow(window).catch(() => undefined);
      this.closeWhenIdle();
    }
  }
}
