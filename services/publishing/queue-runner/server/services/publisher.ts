import { chromium, type BrowserContext, type Page } from "playwright-core";
import { spawn, type ChildProcess } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { PlatformUpload } from "../../shared/schema.js";
import {
  automationInput,
  createAutomationRun,
  createAutomationRunPost,
  deferUploadForSafety,
  finishAutomationRun,
  finishAutomationRunPost,
  getPublishingAccount,
  listPlatformAccounts,
  listUploads,
  pausePlatformAccountForSafety,
  updatePlatformAccountCredentialState,
  updateUploadPublishActionState,
  updateUploadStatus,
  type AutomationInputMode,
  type AutomationRunTrigger,
  type PublishingAccount
} from "../local-storage.js";
import { loginToFacebook, postToFacebook } from "./publishers/facebook.js";
import { loginToInstagram, postToInstagram } from "./publishers/instagram.js";
import { loginToLinkedIn, postToLinkedIn } from "./publishers/linkedin.js";
import type { AccountLogin } from "./publishers/manual-login.js";
import { loginToYouTube, postToYouTube } from "./publishers/youtube.js";
import { loginToX, postToX } from "./publishers/x.js";
import {
  publishingDesktopHost,
  type DesktopBrowserActivity,
  type DesktopBrowserPurpose,
} from "./desktop-host.js";
import { publishingBrowserDataDirectory } from "../runtime-paths.js";
import { assessPublishingSafety, type PublishingSafetyAssessment } from "./safety-governor.js";
import { classifyPublishingRisk } from "./risk-classifier.js";

const accountProfilesDir = path.join(publishingBrowserDataDirectory(), "accounts");
const SESSION_STATE_ALGORITHM = "aes-256-gcm";
const platformLoginUrls: Record<PublishingAccount["platform"], string> = {
  instagram: "https://www.instagram.com/accounts/login/",
  x: "https://x.com/i/flow/login",
  linkedin: "https://www.linkedin.com/login/",
  facebook: "https://www.facebook.com/login/",
  youtube: "https://www.youtube.com/upload",
};

type BrowserStorageState = {
  cookies?: Parameters<BrowserContext["addCookies"]>[0];
  origins?: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
};

type EncryptedSessionState = {
  version: 1;
  algorithm: typeof SESSION_STATE_ALGORITHM;
  iv: string;
  authTag: string;
  ciphertext: string;
};

function readJsonFile(filePath: string) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, any>;
  } catch {
    return {};
  }
}

function writeJsonFile(filePath: string, data: Record<string, any>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

function accountProfilePath(account: PublishingAccount) {
  return path.join(accountProfilesDir, account.platform, account.id.replace(/[^a-z0-9-_]/gi, "-"));
}

function accountSessionStatePath(account: PublishingAccount) {
  return path.join(accountProfilePath(account), "automation-session-state.enc.json");
}

function legacyAccountSessionStatePath(account: PublishingAccount) {
  return path.join(accountProfilePath(account), "automation-session-state.json");
}

function sessionEncryptionKey() {
  const configured = process.env.PUBLISH_QUEUE_SESSION_ENCRYPTION_KEY?.trim();
  return configured ? createHash("sha256").update(configured, "utf8").digest() : null;
}

export function writeEncryptedSessionState(filePath: string, state: unknown, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(SESSION_STATE_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(state), "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedSessionState = {
    version: 1,
    algorithm: SESSION_STATE_ALGORITHM,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(envelope)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

export function readEncryptedSessionState(filePath: string, key: Buffer) {
  const envelope = JSON.parse(fs.readFileSync(filePath, "utf8")) as EncryptedSessionState;
  if (
    envelope.version !== 1
    || envelope.algorithm !== SESSION_STATE_ALGORITHM
    || !envelope.iv
    || !envelope.authTag
    || !envelope.ciphertext
  ) {
    throw new Error("The saved publishing session has an unsupported encrypted format.");
  }
  const decipher = createDecipheriv(SESSION_STATE_ALGORITHM, key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as BrowserStorageState;
}

function migrateLegacyAccountSessionState(account: PublishingAccount) {
  const legacyPath = legacyAccountSessionStatePath(account);
  if (!fs.existsSync(legacyPath)) return;

  try {
    const key = sessionEncryptionKey();
    if (key) {
      const legacyState = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
      writeEncryptedSessionState(accountSessionStatePath(account), legacyState, key);
    }
  } catch (error) {
    console.warn(
      `Could not migrate the legacy session export for ${account.platform} account ${account.handle}:`,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    // Persistent Chromium profiles retain the actual browser session. Remove
    // the old plaintext export even when OS-backed encryption is unavailable.
    fs.rmSync(legacyPath, { force: true });
  }
}

export async function removeSavedAccountProfile(account: PublishingAccount) {
  await Promise.resolve(publishingDesktopHost()?.clearAccountBrowserData(account.id)).catch(() => undefined);
  const profilesRoot = path.resolve(accountProfilesDir);
  const profilePath = path.resolve(accountProfilePath(account));
  if (!profilePath.startsWith(`${profilesRoot}${path.sep}`)) {
    throw new Error("The saved account profile path is invalid.");
  }
  await fs.promises.rm(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}

export function hasSavedAccountSession(account: PublishingAccount) {
  try {
    migrateLegacyAccountSessionState(account);
    const sessionPath = accountSessionStatePath(account);
    return fs.existsSync(sessionPath) && fs.statSync(sessionPath).size > 2;
  } catch {
    return false;
  }
}

function clearSavedAccountSession(account: PublishingAccount) {
  try {
    fs.rmSync(accountSessionStatePath(account), { force: true });
    fs.rmSync(legacyAccountSessionStatePath(account), { force: true });
  } catch {
    // A locked profile file should not hide the original login failure.
  }
}

export async function reconcileSavedAccountSessions() {
  const accounts = await listPlatformAccounts();
  accounts.forEach(migrateLegacyAccountSessionState);
  await Promise.all(accounts
    .filter(account => !account.credentialConfigured && hasSavedAccountSession(account))
    .map(account => updatePlatformAccountCredentialState(account.id, true)));
}

function detectedChromeExecutablePath() {
  const configured = process.env.PUBLISH_QUEUE_CHROME_PATH?.trim()
    || process.env.CHROME_PATH?.trim()
    || process.env.GOOGLE_CHROME_PATH?.trim();
  const candidates = [
    configured,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env.LocalAppData ? path.join(process.env.LocalAppData, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env.LocalAppData ? path.join(process.env.LocalAppData, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome-stable" : undefined,
  ].filter(Boolean) as string[];

  return candidates.find(candidate => path.isAbsolute(candidate) && fs.existsSync(candidate)) ?? null;
}

function chromeExecutablePath() {
  const executablePath = detectedChromeExecutablePath();
  if (!executablePath) {
    throw new Error("Google Chrome or Microsoft Edge is required for secure social-account login. Install one, restart Companion, and try again.");
  }
  return executablePath;
}

export function publishingBrowserRuntimeHealth() {
  const executablePath = detectedChromeExecutablePath();
  const embeddedBrowser = Boolean(publishingDesktopHost());
  return {
    chromeInstalled: Boolean(executablePath),
    chromeExecutablePath: executablePath,
    embeddedBrowser,
    automationAvailable: Boolean(executablePath),
  };
}

function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error("Could not allocate a secure browser connection port.")));
    });
  });
}

function waitForProcessExit(processHandle: ChildProcess, timeoutMs: number) {
  if (processHandle.exitCode !== null || processHandle.killed) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    processHandle.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function waitForChromeDebugEndpoint(port: number, processHandle: ChildProcess, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const endpoint = `http://127.0.0.1:${port}`;

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`The secure login browser closed before it was ready. Exit code: ${processHandle.exitCode}`);
    }

    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return endpoint;
    } catch {
      // The dedicated browser profile is still starting.
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error("The secure Chrome/Edge login window did not become ready. Close any older login window for this account and try again.");
}

function prepareChromeProfile(profileDir: string) {
  const preferencesPath = path.join(profileDir, "Default", "Preferences");
  const preferences = readJsonFile(preferencesPath);
  preferences.browser = { ...(preferences.browser ?? {}), has_seen_welcome_page: true };
  preferences.credentials_enable_service = false;
  preferences.profile = { ...(preferences.profile ?? {}), exit_type: "Normal", password_manager_enabled: false };
  preferences.signin = { ...(preferences.signin ?? {}), allowed: false, allowed_on_next_startup: false };
  preferences.sync = { ...(preferences.sync ?? {}), suppress_start: true };
  writeJsonFile(preferencesPath, preferences);
}

type AccountBrowserSession = {
  context: BrowserContext;
  page: Page;
  desktopSessionId?: string;
  update(activity: DesktopBrowserActivity): Promise<void>;
  close(): Promise<void>;
};

const activeAccountBrowserOperations = new Map<string, { purpose: DesktopBrowserPurpose; token: symbol }>();

function reserveAccountBrowser(account: PublishingAccount, purpose: DesktopBrowserPurpose) {
  const existing = activeAccountBrowserOperations.get(account.id);
  if (existing) {
    throw new Error(
      `${account.displayName} is already busy with a ${existing.purpose} session. Wait for it to finish before starting another account job.`,
    );
  }
  const token = Symbol(account.id);
  activeAccountBrowserOperations.set(account.id, { purpose, token });
  return () => {
    if (activeAccountBrowserOperations.get(account.id)?.token === token) {
      activeAccountBrowserOperations.delete(account.id);
    }
  };
}

async function waitForDesktopPage(
  browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>,
  targetUrl: string,
) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap(context => context.pages());
    const page = pages.find(candidate => candidate.url() === targetUrl);
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The Companion live browser view did not become available.");
}

async function launchAccountBrowser(
  account: PublishingAccount,
  purpose: DesktopBrowserPurpose,
): Promise<AccountBrowserSession> {
  const releaseAccount = reserveAccountBrowser(account, purpose);
  const desktopHost = publishingDesktopHost();
  if (desktopHost) {
    let managed: Awaited<ReturnType<typeof desktopHost.openBrowser>>;
    try {
      managed = await desktopHost.openBrowser({
        accountId: account.id,
        platform: account.platform,
        displayName: account.displayName,
        handle: account.handle,
        purpose,
      });
    } catch (error) {
      releaseAccount();
      throw error;
    }
    let connection: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;

    try {
      connection = await chromium.connectOverCDP(managed.debugEndpoint);
      const page = await waitForDesktopPage(connection, managed.targetUrl);
      const context = page.context();
      await restoreAccountSessionState(account, context);
      return {
        context,
        page,
        desktopSessionId: managed.id,
        update: activity => Promise.resolve(desktopHost.updateBrowser(managed.id, activity)),
        close: async () => {
          try {
            // Remove the completed pane first so the remaining live browsers
            // expand immediately. Closing the CDP transport is best-effort and
            // must not keep a finished account visible for several seconds.
            await Promise.resolve(desktopHost.closeBrowser(managed.id)).catch(() => undefined);
            await Promise.race([
              connection?.close().catch(() => undefined),
              new Promise(resolve => setTimeout(resolve, 1000)),
            ]);
          } finally {
            releaseAccount();
          }
        },
      };
    } catch (error) {
      await Promise.resolve(desktopHost.updateBrowser(managed.id, {
        state: "failed",
        detail: "The Companion browser could not start. Restart Companion and try again.",
      })).catch(() => undefined);
      await Promise.resolve(desktopHost.closeBrowser(managed.id)).catch(() => undefined);
      await Promise.race([
        connection?.close().catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, 1000)),
      ]);
      releaseAccount();
      throw error;
    }
  }

  const profileDir = accountProfilePath(account);
  prepareChromeProfile(profileDir);
  const slowMoMs = Number(process.env.AUTOMATION_SLOW_MO_MS ?? 120);
  const commonArgs = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    "--disable-notifications",
    "--deny-permission-prompts",
    "--disable-sync",
    "--disable-signin-promo",
  ];
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      executablePath: chromeExecutablePath(),
      slowMo: slowMoMs,
      viewport: null,
      args: commonArgs,
    });
    await restoreAccountSessionState(account, context);
    const launchedContext = context;
    const page = launchedContext.pages()[0] ?? await launchedContext.newPage();
    return {
      context: launchedContext,
      page,
      update: async () => undefined,
      close: async () => {
        try {
          await launchedContext.close();
        } finally {
          releaseAccount();
        }
      },
    };
  } catch (error) {
    await context?.close().catch(() => undefined);
    releaseAccount();
    throw error;
  }
}

async function saveAccountSessionState(account: PublishingAccount, context: BrowserContext) {
  try {
    // Electron's per-account persistent partition already saves cookies with
    // Chromium/OS encryption. Asking CDP for cookies after a large media post
    // can block the embedded service, so no duplicate export is needed here.
    if (publishingDesktopHost()) {
      fs.rmSync(legacyAccountSessionStatePath(account), { force: true });
      console.log(`Retained protected Companion session for ${account.platform} account ${account.handle}.`);
      return;
    }
    const key = sessionEncryptionKey();
    fs.rmSync(legacyAccountSessionStatePath(account), { force: true });
    if (!key) return;
    const statePath = accountSessionStatePath(account);
    const state = await context.storageState();
    writeEncryptedSessionState(statePath, state, key);
    console.log(`Saved encrypted browser session state for ${account.platform} account ${account.handle}.`);
  } catch (error) {
    console.warn(
      `Could not save browser session state for ${account.platform} account ${account.handle}:`,
      errorMessage(error),
    );
  }
}

async function exportStandardBrowserSession(account: PublishingAccount, context: BrowserContext) {
  const key = sessionEncryptionKey();
  if (!key) {
    if (publishingDesktopHost()) {
      throw new Error("Companion could not protect the connected account session. Restart Companion and try login again.");
    }
    console.log(`The ${account.platform} login remains in its dedicated local browser profile.`);
    return;
  }

  fs.rmSync(legacyAccountSessionStatePath(account), { force: true });
  writeEncryptedSessionState(accountSessionStatePath(account), await context.storageState(), key);
  console.log(`Saved protected ${account.platform} login session for ${account.handle}.`);
}

async function restoreAccountSessionState(account: PublishingAccount, context: BrowserContext) {
  migrateLegacyAccountSessionState(account);
  const statePath = accountSessionStatePath(account);
  if (!fs.existsSync(statePath)) return;

  try {
    const key = sessionEncryptionKey();
    if (!key) return;
    const state = readEncryptedSessionState(statePath, key);
    if (publishingDesktopHost()) await context.clearCookies();
    if (Array.isArray(state.cookies) && state.cookies.length > 0) {
      await context.addCookies(state.cookies);
    }
    if (Array.isArray(state.origins) && state.origins.length > 0) {
      const localStorageByOrigin = Object.fromEntries(
        state.origins.map(entry => [entry.origin, entry.localStorage]),
      );
      await context.addInitScript((storageByOrigin: Record<string, Array<{ name: string; value: string }>>) => {
        for (const entry of storageByOrigin[window.location.origin] ?? []) {
          window.localStorage.setItem(entry.name, entry.value);
        }
      }, localStorageByOrigin);
    }
    if (publishingDesktopHost()) {
      fs.rmSync(statePath, { force: true });
      console.log(`Imported protected ${account.platform} login into Companion for ${account.handle}.`);
    }
  } catch (error) {
    console.warn(
      `Could not restore saved session state for ${account.platform} account ${account.handle}:`,
      errorMessage(error),
    );
  }
}

async function launchStandardBrowserForLogin(account: PublishingAccount) {
  const profileDir = accountProfilePath(account);
  fs.mkdirSync(profileDir, { recursive: true });
  prepareChromeProfile(profileDir);

  const port = await getFreePort();
  const executablePath = chromeExecutablePath();
  const browserName = /msedge/i.test(path.basename(executablePath)) ? "Microsoft Edge" : "Google Chrome";
  const browserArgs = [
    `--user-data-dir=${profileDir}`,
    "--profile-directory=Default",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    "--new-window",
    platformLoginUrls[account.platform],
  ];

  console.log(`Opening ${browserName} for secure ${account.platform} login for ${account.handle}.`);
  const browserProcess = spawn(executablePath, browserArgs, {
    stdio: "ignore",
    windowsHide: false,
  });
  let spawnError: Error | null = null;
  browserProcess.once("error", error => { spawnError = error; });

  await new Promise(resolve => setTimeout(resolve, 150));
  if (spawnError) throw spawnError;

  const debugEndpoint = await waitForChromeDebugEndpoint(port, browserProcess);
  console.log(`${browserName} secure login window is ready on local port ${port}.`);
  return { browserProcess, debugEndpoint, browserName };
}

async function prepareStandardBrowserSession(account: PublishingAccount) {
  const releaseAccount = reserveAccountBrowser(account, "login");
  let browserProcess: ChildProcess | null = null;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;

  try {
    const launched = await launchStandardBrowserForLogin(account);
    browserProcess = launched.browserProcess;
    browser = await chromium.connectOverCDP(launched.debugEndpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error(`${launched.browserName} did not create the secure account profile.`);
    const page = context.pages().find(candidate => candidate.url().includes(new URL(platformLoginUrls[account.platform]).hostname))
      ?? context.pages()[0]
      ?? await context.newPage();
    await page.bringToFront().catch(() => undefined);
    console.log(`Complete ${account.platform} login in the visible ${launched.browserName} window. Companion will detect success automatically.`);
    await loginOnly(page, account, { ignoreLoginErrors: true });
    await Promise.resolve(publishingDesktopHost()?.clearAccountBrowserData(account.id)).catch(() => undefined);
    await exportStandardBrowserSession(account, context);
    console.log(`${account.platform} login confirmed for ${account.handle}. Closing the dedicated login window.`);
  } finally {
    await browser?.close().catch(() => undefined);
    if (browserProcess) {
      const exited = await waitForProcessExit(browserProcess, 5000);
      if (!exited && browserProcess.exitCode === null && !browserProcess.killed) browserProcess.kill();
    }
    releaseAccount();
  }
}

type AccountLoginOptions = {
  useSavedSessionOnly?: boolean;
  ignoreLoginErrors?: boolean;
  onFinalActionSubmitted?: () => Promise<void> | void;
};

function accountLogin(options: AccountLoginOptions = {}): AccountLogin {
  return {
    useSavedSessionOnly: options.useSavedSessionOnly,
    ignoreLoginErrors: options.ignoreLoginErrors,
    onFinalActionSubmitted: options.onFinalActionSubmitted,
  };
}

async function publishOne(page: Page, upload: PlatformUpload, options: AccountLoginOptions = {}) {
  const login = accountLogin(options);
  switch (upload.platform) {
    case "youtube": return postToYouTube(page, upload, login);
    case "linkedin": return postToLinkedIn(page, upload, login);
    case "instagram": return postToInstagram(page, upload, login);
    case "facebook": return postToFacebook(page, upload, login);
    case "x": return postToX(page, upload, login);
  }
}

async function loginOnly(page: Page, account: PublishingAccount, options: AccountLoginOptions = {}) {
  const login = accountLogin(options);
  switch (account.platform) {
    case "youtube": return loginToYouTube(page, login);
    case "linkedin": return loginToLinkedIn(page, undefined, login);
    case "instagram": return loginToInstagram(page, undefined, false, login);
    case "facebook": return loginToFacebook(page, undefined, false, login);
    case "x": return loginToX(page, undefined, false, login);
  }
}

function getFailureHoldMs() {
  const configured = Number(process.env.AUTOMATION_FAILURE_HOLD_MS ?? 0);
  return Number.isFinite(configured) ? Math.max(0, configured) : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isSessionFailure(message: string) {
  return /saved browser session is not active|sign in|log in|login|session (?:expired|invalid)|authentication/i.test(message);
}

async function visiblePublishingRiskSignal(page: Page) {
  const candidates = [
    page.locator('iframe[title*="captcha" i], iframe[src*="captcha" i], iframe[src*="arkoselabs" i]').first(),
    page.getByText(/captcha|checkpoint|security verification|verify your identity|temporarily limited|too many requests|account (?:is |has been )?(?:restricted|suspended|disabled|locked)/i).first(),
    page.locator('[role="alert"]').filter({
      hasText: /rate.?limit|try again later|action blocked|verification|restricted|suspended|disabled|locked/i,
    }).first(),
  ];
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      return (await candidate.textContent().catch(() => ""))?.replace(/\s+/g, " ").trim() || "CAPTCHA verification";
    }
  }
  return "";
}

async function runAccountQueue(
  automationRunId: string,
  trigger: AutomationRunTrigger,
  account: PublishingAccount,
  uploads: PlatformUpload[],
  signal: AbortSignal,
  options: AccountLoginOptions = {},
) {
  console.log(`Publishing ${uploads.length} post(s) through ${account.platform} account ${account.handle} (${account.id}).`);
  const runPostIds = new Map<string, string>();
  for (const upload of uploads) {
    runPostIds.set(upload.id, await createAutomationRunPost(automationRunId, upload));
  }

  let browser: AccountBrowserSession | null = null;
  let hadFailure = false;
  let sessionInvalidated = false;

  async function failUnfinishedPosts(message: string) {
    const currentUploads = await listUploads(account.platform, account.id);
    const currentById = new Map(currentUploads.map(upload => [upload.id, upload]));

    for (const upload of uploads) {
      const currentUpload = currentById.get(upload.id) ?? upload;
      if (currentUpload.status === "posted") continue;

      await updateUploadStatus(upload.id, "failed", `Automation ${trigger} run ${automationRunId} failed: ${message}`);
      const runPostId = runPostIds.get(upload.id);
      if (runPostId) await finishAutomationRunPost(runPostId, "failed", message);
    }
  }

  async function deferRemainingPosts(startIndex: number, assessment: PublishingSafetyAssessment) {
    if (!assessment.retryAt) throw new Error("The publishing safety governor did not provide a retry time.");
    const message = `${assessment.reason ?? "Publishing safety spacing is active"} Next safe attempt: ${assessment.retryAt}`;
    for (const upload of uploads.slice(startIndex)) {
      await deferUploadForSafety(upload.id, assessment.retryAt, message);
      const runPostId = runPostIds.get(upload.id);
      if (runPostId) await finishAutomationRunPost(runPostId, "deferred", message);
    }
    console.log(`Deferred ${uploads.length - startIndex} post(s) for ${account.handle}: ${message}`);
  }

  async function holdRemainingPostsForManualResume(startIndex: number, message: string) {
    for (const upload of uploads.slice(startIndex)) {
      const runPostId = runPostIds.get(upload.id);
      if (runPostId) await finishAutomationRunPost(runPostId, "deferred", message);
    }
  }

  try {
    signal.throwIfAborted();
    const initialHistory = await listUploads(account.platform, account.id);
    const initialAssessment = assessPublishingSafety(uploads[0], initialHistory, Date.now(), account.safetyMode ?? "standard");
    if (!initialAssessment.allowed) {
      await deferRemainingPosts(0, initialAssessment);
      return false;
    }
    browser = await launchAccountBrowser(account, "publish");
    const page = browser.page;

    for (const [uploadIndex, upload] of uploads.entries()) {
      signal.throwIfAborted();
      if (uploadIndex > 0) {
        const accountHistory = await listUploads(account.platform, account.id);
        const assessment = assessPublishingSafety(upload, accountHistory, Date.now(), account.safetyMode ?? "standard");
        if (!assessment.allowed) {
          await deferRemainingPosts(uploadIndex, assessment);
          await browser.update({
            state: "waiting",
            detail: `Remaining posts were safely deferred until ${assessment.retryAt}.`,
            currentItem: upload.title || upload.originalName || "Post",
            currentIndex: uploadIndex + 1,
            totalItems: uploads.length,
          });
          break;
        }
      }
      const runPostId = runPostIds.get(upload.id);
      await updateUploadStatus(upload.id, "processing", `Automation ${trigger} run ${automationRunId} started publishing`);
      await browser.update({
        state: "publishing",
        detail: `Publishing ${uploadIndex + 1} of ${uploads.length}`,
        currentItem: upload.title || upload.originalName || "Post",
        currentIndex: uploadIndex + 1,
        totalItems: uploads.length,
      });

      let finalActionSubmitted = false;
      try {
        await updateUploadPublishActionState(upload.id, "prepared");
        await publishOne(page, upload, {
          ...options,
          onFinalActionSubmitted: async () => {
            finalActionSubmitted = true;
            await updateUploadPublishActionState(upload.id, "submitted");
          },
        });
        signal.throwIfAborted();
      } catch (error) {
        hadFailure = true;
        const message = signal.aborted ? "Publishing was stopped by the user." : errorMessage(error);
        const visibleRisk = signal.aborted ? "" : await visiblePublishingRiskSignal(page).catch(() => "");
        const risk = signal.aborted
          ? null
          : classifyPublishingRisk(
            `${message} ${visibleRisk}${finalActionSubmitted ? " final publish result is uncertain" : ""}`,
            page.url(),
          );
        if (risk) {
          const safetyMessage = `${risk.reason} Original platform message: ${message}`;
          await pausePlatformAccountForSafety(account.id, risk.accountStatus, safetyMessage);
          if (risk.requiresLogin) {
            await updatePlatformAccountCredentialState(account.id, false).catch(() => undefined);
          }
          if (risk.kind === "uncertain_publish") {
            await updateUploadPublishActionState(upload.id, "uncertain");
          }
        } else if (isSessionFailure(message)) {
          sessionInvalidated = true;
          clearSavedAccountSession(account);
          await updatePlatformAccountCredentialState(account.id, false).catch(() => undefined);
        }
        await updateUploadStatus(upload.id, "failed", `Automation ${trigger} run ${automationRunId} failed: ${message}`);
        if (runPostId) await finishAutomationRunPost(runPostId, "failed", message);
        await browser.update({
          state: signal.aborted ? "stopped" : "failed",
          detail: message,
          currentItem: upload.title || upload.originalName || "Post",
          currentIndex: uploadIndex + 1,
          totalItems: uploads.length,
        });
        console.error(`Failed ${upload.id} through ${account.handle}:`, message);
        if (signal.aborted) throw new Error(message);
        if (risk) {
          await holdRemainingPostsForManualResume(
            uploadIndex + 1,
            `Account paused for manual review: ${risk.reason}`,
          );
          break;
        }
        continue;
      }

      await updateUploadStatus(upload.id, "posted", `Automation ${trigger} run ${automationRunId} posted successfully`);
      if (runPostId) await finishAutomationRunPost(runPostId, "posted");
      await browser.update({
        state: "posted",
        detail: `Published ${uploadIndex + 1} of ${uploads.length}`,
        currentItem: upload.title || upload.originalName || "Post",
        currentIndex: uploadIndex + 1,
        totalItems: uploads.length,
      });
      console.log(`Posted ${upload.id} through ${account.handle}.`);
    }

    if (!hadFailure) {
      await updatePlatformAccountCredentialState(account.id, true);
    }

    const holdMs = getFailureHoldMs();
    if (hadFailure && holdMs > 0) await new Promise(resolve => setTimeout(resolve, holdMs));
    return hadFailure;
  } catch (error) {
    hadFailure = true;
    const message = signal.aborted ? "Publishing was stopped by the user." : errorMessage(error);
    if (isSessionFailure(message)) {
      sessionInvalidated = true;
      clearSavedAccountSession(account);
      await updatePlatformAccountCredentialState(account.id, false).catch(() => undefined);
    }
    await failUnfinishedPosts(message);
    throw error;
  } finally {
    if (browser) {
      if (!sessionInvalidated) await saveAccountSessionState(account, browser.context);
      await browser.close().catch(() => undefined);
    }
  }
}

async function prepareManualAccountSession(account: PublishingAccount) {
  console.log(`Opening ${account.platform} login page for ${account.handle} (${account.id}).`);
  await prepareStandardBrowserSession(account);
  console.log(`Manual session saved for ${account.platform} account ${account.handle}.`);
}

const activeSessionPreparations = new Map<string, Promise<void>>();

export async function startManualAccountSession(accountId: string) {
  const existing = activeSessionPreparations.get(accountId);
  const account = await getPublishingAccount(accountId);
  if (!account) throw new Error("Publishing account not found.");
  if (!account.enabled) throw new Error("Publishing account is disabled.");

  if (existing) return { account, started: false };

  const operation = prepareManualAccountSession(account)
    .then(async () => {
      await updatePlatformAccountCredentialState(account.id, true);
    })
    .catch(error => {
      clearSavedAccountSession(account);
      void updatePlatformAccountCredentialState(account.id, false).catch(() => undefined);
      console.error(
        `Manual session preparation failed for ${account.platform} account ${account.handle}:`,
        errorMessage(error),
      );
    })
    .finally(() => {
      activeSessionPreparations.delete(account.id);
    });

  activeSessionPreparations.set(account.id, operation);
  return { account, started: true };
}

type RunAutomationOptions = {
  mode?: AutomationInputMode;
  trigger?: AutomationRunTrigger;
  startedByUserId?: string;
  uploadIds?: string[];
  workspaceId?: string;
};

let activeAutomationRun: Promise<void> | null = null;
let activeAutomationController: AbortController | null = null;
const pendingAutomationRuns: Array<{
  options: RunAutomationOptions;
  resolve: () => void;
  reject: (error: unknown) => void;
}> = [];

export function isAutomationRunning() {
  return activeAutomationRun !== null || pendingAutomationRuns.length > 0;
}

export async function cancelAutomation(reason = "Publishing was stopped by the user.") {
  const cancellationError = new Error(reason);
  const wasRunning = Boolean(activeAutomationRun || pendingAutomationRuns.length);
  activeAutomationController?.abort(cancellationError);
  const pending = pendingAutomationRuns.splice(0);
  for (const run of pending) run.reject(cancellationError);
  await Promise.resolve(publishingDesktopHost()?.stopPublishingBrowsers(reason)).catch(() => undefined);
  return wasRunning;
}

function maxConcurrentAccounts() {
  // Different accounts can start together at the scheduled minute. Companion
  // keeps every browser visible in a scaled grid, while the per-account lock
  // still guarantees that one account never receives overlapping jobs.
  const configured = Number(process.env.PUBLISH_QUEUE_MAX_CONCURRENT_ACCOUNTS ?? 5);
  return Number.isInteger(configured) ? Math.min(5, Math.max(1, configured)) : 5;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function runAutomationOnce(
  { mode = "ready", trigger = "manual", startedByUserId, uploadIds, workspaceId }: RunAutomationOptions,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  console.log(`Starting publisher automation (${trigger})...`);
  const { channels } = await automationInput(undefined, mode, workspaceId);
  const requestedIds = uploadIds?.length ? new Set(uploadIds) : null;
  const uploads = Object.values(channels).flat().filter(upload => !requestedIds || requestedIds.has(upload.id));
  if (uploads.length === 0) {
    console.log(requestedIds
      ? "None of the requested posts are ready for publishing."
      : "No due uploads for enabled publishing accounts.");
    return;
  }

  const desktopHost = publishingDesktopHost();
  if (desktopHost) await desktopHost.requestPublishingPermission();

  let automationRunId: string;
  try {
    automationRunId = await createAutomationRun(trigger, startedByUserId);
  } catch (error) {
    await Promise.resolve(desktopHost?.finishPublishingRun()).catch(() => undefined);
    throw error;
  }
  let hadRunFailure = false;
  let runErrorMessage: string | undefined;
  const queues = new Map<string, PlatformUpload[]>();
  for (const upload of uploads) queues.set(upload.accountId, [...(queues.get(upload.accountId) ?? []), upload]);

  try {
    const accountQueues = [...queues.entries()];
    await runWithConcurrency(accountQueues, maxConcurrentAccounts(), async ([accountId, accountUploads]) => {
      signal.throwIfAborted();
      const account = await getPublishingAccount(accountId);
      if (!account || !account.enabled) {
        const message = `Publishing account ${accountId} is missing or disabled.`;
        hadRunFailure = true;
        runErrorMessage ??= message;
        for (const upload of accountUploads) {
          await updateUploadStatus(upload.id, "failed", `Automation ${trigger} run ${automationRunId} failed: ${message}`);
        }
        console.error(message);
        return;
      }

      try {
        const accountHadFailure = await runAccountQueue(automationRunId, trigger, account, accountUploads, signal, {
          useSavedSessionOnly: true,
        });
        if (accountHadFailure) {
          hadRunFailure = true;
          runErrorMessage ??= "One or more posts failed.";
        }
      } catch (error) {
        const message = errorMessage(error);
        hadRunFailure = true;
        runErrorMessage ??= message;
        console.error(`Could not run account ${account.handle}:`, message);
      }
    });
  } catch (error) {
    hadRunFailure = true;
    runErrorMessage ??= signal.aborted ? "Publishing was stopped by the user." : errorMessage(error);
    throw error;
  } finally {
    try {
      await finishAutomationRun(
        automationRunId,
        hadRunFailure ? "failed" : "completed",
        hadRunFailure ? runErrorMessage : undefined,
      );
    } finally {
      await Promise.resolve(desktopHost?.finishPublishingRun()).catch(() => undefined);
    }
  }
}

export function runAutomation(options: RunAutomationOptions = {}) {
  return new Promise<void>((resolve, reject) => {
    pendingAutomationRuns.push({ options, resolve, reject });
    startNextAutomationRun();
  });
}

function startNextAutomationRun() {
  if (activeAutomationRun) return;
  const next = pendingAutomationRuns.shift();
  if (!next) return;

  activeAutomationController = new AbortController();
  activeAutomationRun = runAutomationOnce(next.options, activeAutomationController.signal);
  activeAutomationRun
    .then(next.resolve, next.reject)
    .finally(() => {
      activeAutomationRun = null;
      activeAutomationController = null;
      startNextAutomationRun();
    });
}
