import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { LoginBrowserInput, LoginSurface } from "./contracts.ts";
import type { LoginAccount } from "./login-store.ts";

export class LoginBrowserClosedError extends Error {}
export class LoginBrowserExpiredError extends Error {}

export type PersistentLoginBrowser = {
  readonly surface: LoginSurface;
  waitForAuthenticated(signal: AbortSignal): Promise<void>;
  captureFrame(): Promise<Buffer>;
  dispatchInput(input: LoginBrowserInput): Promise<void>;
  close(): Promise<void>;
};

export interface LoginBrowserLauncher {
  launch(account: LoginAccount, profileDirectory: string, surface: LoginSurface): Promise<PersistentLoginBrowser>;
}

function browserCandidates() {
  return [
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : null,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe") : null,
    process.env.LocalAppData ? path.join(process.env.LocalAppData, "Google", "Chrome", "Application", "chrome.exe") : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : null,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") : null,
    process.env.LocalAppData ? path.join(process.env.LocalAppData, "Microsoft", "Edge", "Application", "msedge.exe") : null,
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : null,
    process.platform === "linux" ? "/usr/bin/google-chrome" : null,
    process.platform === "linux" ? "/usr/bin/google-chrome-stable" : null,
    process.platform === "linux" ? "/usr/bin/chromium" : null,
    process.platform === "linux" ? "/usr/bin/chromium-browser" : null,
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function detectServerBrowserExecutable(configuredPath = "") {
  if (configuredPath) {
    const resolved = path.resolve(configuredPath);
    if (!fs.existsSync(resolved)) {
      throw new Error("SERVER_BROWSER_EXECUTABLE_PATH does not point to an installed browser.");
    }
    return resolved;
  }
  return browserCandidates().find(candidate => fs.existsSync(candidate)) || null;
}

function prepareProfile(profileDirectory: string) {
  fs.mkdirSync(profileDirectory, { recursive: true });
  const preferencesPath = path.join(profileDirectory, "Default", "Preferences");
  let preferences: Record<string, any> = {};
  try {
    preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8")) as Record<string, any>;
  } catch {
    // Chrome creates the rest of the profile on first launch.
  }
  preferences.browser = { ...(preferences.browser || {}), has_seen_welcome_page: true };
  preferences.credentials_enable_service = false;
  preferences.profile = {
    ...(preferences.profile || {}),
    exit_type: "Normal",
    password_manager_enabled: false,
  };
  preferences.signin = { ...(preferences.signin || {}), allowed: false, allowed_on_next_startup: false };
  preferences.sync = { ...(preferences.sync || {}), suppress_start: true };
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.writeFileSync(preferencesPath, JSON.stringify(preferences), { encoding: "utf8", mode: 0o600 });
}

async function instagramSessionPresent(context: BrowserContext) {
  const cookies = await context.cookies("https://www.instagram.com/");
  return cookies.some(cookie => cookie.name === "sessionid" && Boolean(cookie.value));
}

async function facebookSessionPresent(context: BrowserContext) {
  const cookies = await context.cookies("https://www.facebook.com/");
  return cookies.some(cookie => cookie.name === "c_user" && Boolean(cookie.value));
}

async function xSessionPresent(context: BrowserContext) {
  const cookies = await context.cookies(["https://x.com/", "https://twitter.com/"]);
  if (!cookies.some(cookie => cookie.name === "auth_token" && Boolean(cookie.value))) return false;
  const page = context.pages().find(candidate => candidate.url().includes("x.com/"));
  if (!page || /\/i\/flow\/login|\/login(?:\?|$)|account\/access/i.test(page.url())) return false;
  const authenticatedUi = page.locator([
    '[data-testid="SideNav_AccountSwitcher_Button"]',
    '[data-testid="AppTabBar_Home_Link"]',
    '[data-testid="SideNav_NewTweet_Button"]',
    'a[href="/compose/post"]',
    'a[href="/home"][role="link"]',
  ].join(", "));
  return await authenticatedUi.first().isVisible().catch(() => false);
}

async function linkedinSessionPresent(context: BrowserContext) {
  const cookies = await context.cookies("https://www.linkedin.com/");
  if (!cookies.some(cookie => cookie.name === "li_at" && Boolean(cookie.value))) return false;
  const page = context.pages().find(candidate => candidate.url().includes("linkedin.com/"));
  if (!page || /\/login|\/checkpoint|\/uas\//i.test(page.url())) return false;
  return await page.locator("#global-nav, .global-nav, [data-test-global-nav-link='feed']")
    .first().isVisible().catch(() => false);
}

async function youtubeSessionPresent(context: BrowserContext) {
  const cookies = await context.cookies(["https://www.youtube.com/", "https://accounts.google.com/"]);
  const cookieReady = cookies.some(cookie => ["SAPISID", "__Secure-3PAPISID", "SID"].includes(cookie.name) && Boolean(cookie.value));
  if (!cookieReady) return false;
  const page = context.pages().find(candidate => candidate.url().includes("youtube.com/"));
  if (!page || page.url().includes("accounts.google.com")) return false;
  return await page.locator("button#avatar-btn, ytd-topbar-menu-button-renderer #avatar-btn, #end #avatar-btn")
    .first().isVisible().catch(() => false);
}

async function wait(page: Page, milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason || new Error("Login was cancelled.");
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason || new Error("Login was cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([page.waitForTimeout(milliseconds), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function getFreeLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error("Could not allocate a local browser connection port.")));
    });
  });
}

async function waitForChromeDevTools(port: number, process: ChildProcess) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error("The standard X login browser exited while starting.");
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return endpoint;
    } catch {
      // The dedicated browser profile is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("The standard X login browser did not become ready.");
}

function waitForProcessExit(process: ChildProcess, timeoutMs: number) {
  if (process.exitCode !== null) return Promise.resolve(true);
  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    process.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
}

export async function launchStandardXChrome(
  executablePath: string,
  profileDirectory: string,
  targetUrl = "https://x.com/i/flow/login",
  visible = true,
) {
  const port = await getFreeLoopbackPort();
  const process = spawn(executablePath, [
    `--user-data-dir=${profileDirectory}`,
    "--profile-directory=Default",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection",
    `--window-position=${visible ? "0,0" : "-10000,-10000"}`,
    "--window-size=1280,800",
    "--new-window",
    targetUrl,
  ], { stdio: "ignore", windowsHide: false });
  try {
    const endpoint = await waitForChromeDevTools(port, process);
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error("The standard X login browser did not expose its profile.");
    const pages = context.pages();
    const targetHost = new URL(targetUrl).hostname.replace(/^www\./, "");
    const page = pages.filter(candidate => candidate.url().includes(targetHost)).at(-1)
      || pages.at(-1)
      || await context.newPage();
    let closed = false;
    return {
      browser, context, page, process,
      close: async () => {
        if (closed) return;
        closed = true;
        await Promise.race([
          browser.close().catch(() => undefined),
          new Promise(resolve => setTimeout(resolve, 1_500)),
        ]);
        const exited = await waitForProcessExit(process, 3_000);
        if (!exited && process.exitCode === null) {
          process.kill("SIGTERM");
          await waitForProcessExit(process, 2_000);
        }
      },
    };
  } catch (error) {
    process.kill("SIGTERM");
    throw error;
  }
}

export class PlaywrightLoginBrowserLauncher implements LoginBrowserLauncher {
  constructor(
    private readonly configuredExecutablePath: string,
    private readonly timeoutMs: number,
  ) {}

  async launch(
    account: LoginAccount,
    profileDirectory: string,
    surface: LoginSurface,
  ): Promise<PersistentLoginBrowser> {
    if (!["instagram", "facebook", "x", "linkedin", "youtube"].includes(account.platform)) throw new Error("This login browser does not support the selected platform yet.");
    const executablePath = detectServerBrowserExecutable(this.configuredExecutablePath);
    if (!executablePath) {
      throw new Error("Google Chrome or Microsoft Edge is required for local server login testing.");
    }
    prepareProfile(profileDirectory);
    // X login runs in a standard server-owned Chrome process. Playwright only
    // attaches to its loopback DevTools endpoint to stream frames and input;
    // it does not launch X with its automation command-line switches.
    let attachedBrowser: Browser | null = null;
    let closeStandardChrome: (() => Promise<void>) | null = null;
    let context: BrowserContext;
    let page: Page;
    const platformName = account.platform === "facebook" ? "Facebook"
      : account.platform === "x" ? "X"
      : account.platform === "linkedin" ? "LinkedIn"
      : account.platform === "youtube" ? "YouTube"
      : "Instagram";
    const loginUrl = account.platform === "facebook" ? "https://www.facebook.com/login/"
      : account.platform === "x" ? "https://x.com/i/flow/login"
      : account.platform === "linkedin" ? "https://www.linkedin.com/login"
      : account.platform === "youtube" ? "https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/"
      : "https://www.instagram.com/accounts/login/";
    if (["x", "linkedin", "youtube"].includes(account.platform)) {
      const launched = await launchStandardXChrome(executablePath, profileDirectory, loginUrl);
      attachedBrowser = launched.browser;
      closeStandardChrome = launched.close;
      context = launched.context;
      page = launched.page;
    } else {
      context = await chromium.launchPersistentContext(profileDirectory, {
        executablePath,
        headless: surface === "website",
        viewport: surface === "website" ? { width: 1280, height: 800 } : null,
        acceptDownloads: false,
        args: [
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-mode",
          "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection",
        ],
      });
      page = context.pages()[0] || await context.newPage();
    }
    if (!page.url().startsWith(loginUrl)) await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    let closed = false;
    context.once("close", () => { closed = true; });

    return {
      surface,
      waitForAuthenticated: async signal => {
        const deadline = Date.now() + this.timeoutMs;
        while (Date.now() < deadline) {
          if (closed || page.isClosed()) {
            throw new LoginBrowserClosedError(`The ${platformName} login browser was closed before connection finished.`);
          }
          const authenticated = account.platform === "facebook" ? await facebookSessionPresent(context)
            : account.platform === "x" ? await xSessionPresent(context)
            : account.platform === "linkedin" ? await linkedinSessionPresent(context)
            : account.platform === "youtube" ? await youtubeSessionPresent(context)
            : await instagramSessionPresent(context);
          if (authenticated) {
            if (["x", "linkedin", "youtube"].includes(account.platform)) {
              const defaultHold = account.platform === "x" ? 15_000 : 5_000;
              const holdMs = Number(process.env[`${account.platform.toUpperCase()}_LOGIN_HOLD_MS`] ?? defaultHold);
              await wait(page, Number.isFinite(holdMs) && holdMs >= 0 ? holdMs : defaultHold, signal);
              const stable = account.platform === "x" ? await xSessionPresent(context)
                : account.platform === "linkedin" ? await linkedinSessionPresent(context)
                : await youtubeSessionPresent(context);
              if (!stable) throw new Error(`${platformName} authentication did not remain active during session stabilization.`);
            }
            return;
          }
          await wait(page, 750, signal);
        }
        throw new LoginBrowserExpiredError(`${platformName} login did not finish before the local login window expired.`);
      },
      captureFrame: async () => {
        if (closed || page.isClosed()) throw new LoginBrowserClosedError(`The ${platformName} login browser is closed.`);
        return page.screenshot({ type: "jpeg", quality: 68, animations: "disabled", timeout: 8_000 });
      },
      dispatchInput: async input => {
        if (closed || page.isClosed()) throw new LoginBrowserClosedError(`The ${platformName} login browser is closed.`);
        await page.bringToFront();
        if (input.type === "click") {
          await page.mouse.click(input.x, input.y, { button: input.button });
        } else if (input.type === "key") {
          await page.keyboard.press(input.key);
        } else if (input.type === "text") {
          await page.keyboard.insertText(input.text);
        } else {
          await page.mouse.wheel(input.deltaX, input.deltaY);
        }
      },
      close: async () => {
        if (!closed) {
          if (closeStandardChrome) await closeStandardChrome().catch(() => undefined);
          else if (attachedBrowser) await attachedBrowser.close().catch(() => undefined);
          else await context.close().catch(() => undefined);
        }
        closed = true;
      },
    };
  }
}
