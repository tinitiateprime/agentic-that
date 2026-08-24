import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
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
    if (account.platform !== "instagram") throw new Error("This login browser currently supports only Instagram.");
    const executablePath = detectServerBrowserExecutable(this.configuredExecutablePath);
    if (!executablePath) {
      throw new Error("Google Chrome or Microsoft Edge is required for local server login testing.");
    }
    prepareProfile(profileDirectory);
    const context = await chromium.launchPersistentContext(profileDirectory, {
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
    const page = context.pages()[0] || await context.newPage();
    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    let closed = false;
    context.once("close", () => { closed = true; });

    return {
      surface,
      waitForAuthenticated: async signal => {
        const deadline = Date.now() + this.timeoutMs;
        while (Date.now() < deadline) {
          if (closed || page.isClosed()) {
            throw new LoginBrowserClosedError("The Instagram login browser was closed before connection finished.");
          }
          if (await instagramSessionPresent(context)) return;
          await wait(page, 750, signal);
        }
        throw new LoginBrowserExpiredError("Instagram login did not finish before the local login window expired.");
      },
      captureFrame: async () => {
        if (closed || page.isClosed()) throw new LoginBrowserClosedError("The Instagram login browser is closed.");
        return page.screenshot({ type: "jpeg", quality: 68, animations: "disabled", timeout: 8_000 });
      },
      dispatchInput: async input => {
        if (closed || page.isClosed()) throw new LoginBrowserClosedError("The Instagram login browser is closed.");
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
        if (!closed) await context.close().catch(() => undefined);
        closed = true;
      },
    };
  }
}
