import { chromium, type BrowserContext, type Page } from "playwright-core";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { PlatformUpload } from "../../shared/schema.js";
import {
  automationInput,
  createAutomationRun,
  createAutomationRunPost,
  finishAutomationRun,
  finishAutomationRunPost,
  getPublishingAccount,
  listPlatformAccounts,
  listUploads,
  updatePlatformAccountCredentialState,
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
import { publishingBrowserDataDirectory } from "../runtime-paths.js";

const accountProfilesDir = path.join(publishingBrowserDataDirectory(), "accounts");
const X_LOGIN_URL = "https://x.com/i/flow/login";

const disabledChromeFeatures = [
  "IsolateOrigins",
  "site-per-process",
  "ChromeWhatsNewUI",
  "ChromeSignin",
  "SigninInterception",
  "DiceWebSigninInterception",
  "SignInProfileCreation",
  "IdentityDiscAccountMenu",
  "AccountConsistency",
  "PasswordManagerOnboarding"
].join(",");

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
  return path.join(accountProfilePath(account), "automation-session-state.json");
}

export async function removeSavedAccountProfile(account: PublishingAccount) {
  const profilesRoot = path.resolve(accountProfilesDir);
  const profilePath = path.resolve(accountProfilePath(account));
  if (!profilePath.startsWith(`${profilesRoot}${path.sep}`)) {
    throw new Error("The saved account profile path is invalid.");
  }
  await fs.promises.rm(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}

export function hasSavedAccountSession(account: PublishingAccount) {
  try {
    const sessionPath = accountSessionStatePath(account);
    return fs.existsSync(sessionPath) && fs.statSync(sessionPath).size > 2;
  } catch {
    return false;
  }
}

function clearSavedAccountSession(account: PublishingAccount) {
  try {
    fs.rmSync(accountSessionStatePath(account), { force: true });
  } catch {
    // A locked profile file should not hide the original login failure.
  }
}

export async function reconcileSavedAccountSessions() {
  const accounts = await listPlatformAccounts();
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
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome-stable" : undefined,
  ].filter(Boolean) as string[];

  return candidates.find(candidate => path.isAbsolute(candidate) && fs.existsSync(candidate)) ?? null;
}

function chromeExecutablePath() {
  const executablePath = detectedChromeExecutablePath();
  if (!executablePath) {
    throw new Error("Google Chrome is required for publishing. Install Chrome, then restart AgenticThat Publishing Companion.");
  }
  return executablePath;
}

export function publishingBrowserRuntimeHealth() {
  const executablePath = detectedChromeExecutablePath();
  return {
    chromeInstalled: Boolean(executablePath),
    chromeExecutablePath: executablePath,
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
      server.close(() => port ? resolve(port) : reject(new Error("Could not allocate a Chrome debugging port.")));
    });
  });
}

function waitForProcessExit(processHandle: ChildProcess, timeoutMs: number) {
  if (processHandle.exitCode !== null || processHandle.killed) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    processHandle.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForChromeDebugEndpoint(port: number, processHandle: ChildProcess, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const endpoint = `http://127.0.0.1:${port}`;

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Chrome closed before the manual login window was ready. Exit code: ${processHandle.exitCode}`);
    }

    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return endpoint;
    } catch {
      // Chrome is still starting.
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error("Chrome did not expose its local debugging endpoint in time.");
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

async function launchAccountBrowser(account: PublishingAccount): Promise<BrowserContext> {
  const profileDir = accountProfilePath(account);
  prepareChromeProfile(profileDir);
  const slowMoMs = Number(process.env.AUTOMATION_SLOW_MO_MS ?? 120);
  const commonArgs = ["--no-first-run", "--no-default-browser-check", "--disable-notifications", "--deny-permission-prompts"];
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath: chromeExecutablePath(),
    slowMo: slowMoMs,
    viewport: null,
    args: account.platform === "facebook"
      ? commonArgs
      : [...commonArgs, "--disable-blink-features=AutomationControlled", "--disable-site-isolation-trials", "--disable-sync", "--disable-signin-promo", `--disable-features=${disabledChromeFeatures}`],
  });
  await restoreAccountSessionState(account, context);
  return context;
}

async function saveAccountSessionState(account: PublishingAccount, context: BrowserContext) {
  try {
    const statePath = accountSessionStatePath(account);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    await context.storageState({ path: statePath });
    console.log(`Saved browser session state for ${account.platform} account ${account.handle}.`);
  } catch (error) {
    console.warn(
      `Could not save browser session state for ${account.platform} account ${account.handle}:`,
      errorMessage(error),
    );
  }
}

async function restoreAccountSessionState(account: PublishingAccount, context: BrowserContext) {
  const statePath = accountSessionStatePath(account);
  if (!fs.existsSync(statePath)) return;

  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as { cookies?: Parameters<BrowserContext["addCookies"]>[0] };
    if (Array.isArray(state.cookies) && state.cookies.length > 0) {
      await context.addCookies(state.cookies);
    }
  } catch (error) {
    console.warn(
      `Could not restore saved session state for ${account.platform} account ${account.handle}:`,
      errorMessage(error),
    );
  }
}

async function launchNormalChromeForManualXLogin(account: PublishingAccount) {
  const profileDir = accountProfilePath(account);
  fs.mkdirSync(profileDir, { recursive: true });
  prepareChromeProfile(profileDir);

  const port = await getFreePort();
  const chromePath = chromeExecutablePath();
  const chromeArgs = [
    `--user-data-dir=${profileDir}`,
    "--profile-directory=Default",
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-notifications",
    "--new-window",
    X_LOGIN_URL,
  ];

  console.log(`Opening normal Chrome for manual X login for ${account.handle}.`);
  const chromeProcess = spawn(chromePath, chromeArgs, {
    stdio: "ignore",
    windowsHide: false,
  });

  let spawnError: Error | null = null;
  chromeProcess.once("error", error => { spawnError = error; });

  await new Promise(resolve => setTimeout(resolve, 100));
  if (spawnError) throw spawnError;

  return { chromeProcess, debugEndpoint: await waitForChromeDebugEndpoint(port, chromeProcess) };
}

async function prepareXSessionInNormalChrome(account: PublishingAccount) {
  const { chromeProcess, debugEndpoint } = await launchNormalChromeForManualXLogin(account);
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;

  try {
    browser = await chromium.connectOverCDP(debugEndpoint);
    const context = browser.contexts()[0];
    const page = context.pages().find(item => item.url().includes("x.com")) ?? context.pages()[0] ?? await context.newPage();
    await page.bringToFront().catch(() => undefined);
    await loginToX(page, undefined, false, accountLogin({
      ignoreLoginErrors: true,
    }));
    await saveAccountSessionState(account, context);
    console.log(`Normal Chrome manual X session saved for ${account.handle}. Closing Chrome.`);
  } finally {
    await browser?.close().catch(() => undefined);
    await waitForProcessExit(chromeProcess, 15000);
    if (chromeProcess.exitCode === null && !chromeProcess.killed) chromeProcess.kill();
  }
}

type AccountLoginOptions = {
  useSavedSessionOnly?: boolean;
  ignoreLoginErrors?: boolean;
};

function accountLogin(options: AccountLoginOptions = {}): AccountLogin {
  return {
    useSavedSessionOnly: options.useSavedSessionOnly,
    ignoreLoginErrors: options.ignoreLoginErrors
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

async function runAccountQueue(
  automationRunId: string,
  trigger: AutomationRunTrigger,
  account: PublishingAccount,
  uploads: PlatformUpload[],
  options: AccountLoginOptions = {},
) {
  console.log(`Publishing ${uploads.length} post(s) through ${account.platform} account ${account.handle} (${account.id}).`);
  const runPostIds = new Map<string, string>();
  for (const upload of uploads) {
    runPostIds.set(upload.id, await createAutomationRunPost(automationRunId, upload));
  }

  let browser: BrowserContext | null = null;
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

  try {
    browser = await launchAccountBrowser(account);
    const page = browser.pages()[0] ?? await browser.newPage();

    for (const upload of uploads) {
      const runPostId = runPostIds.get(upload.id);
      await updateUploadStatus(upload.id, "processing", `Automation ${trigger} run ${automationRunId} started publishing`);

      try {
        await publishOne(page, upload, options);
      } catch (error) {
        hadFailure = true;
        const message = errorMessage(error);
        if (isSessionFailure(message)) {
          sessionInvalidated = true;
          clearSavedAccountSession(account);
          await updatePlatformAccountCredentialState(account.id, false).catch(() => undefined);
        }
        await updateUploadStatus(upload.id, "failed", `Automation ${trigger} run ${automationRunId} failed: ${message}`);
        if (runPostId) await finishAutomationRunPost(runPostId, "failed", message);
        console.error(`Failed ${upload.id} through ${account.handle}:`, message);
        continue;
      }

      await updateUploadStatus(upload.id, "posted", `Automation ${trigger} run ${automationRunId} posted successfully`);
      if (runPostId) await finishAutomationRunPost(runPostId, "posted");
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
    const message = errorMessage(error);
    if (isSessionFailure(message)) {
      sessionInvalidated = true;
      clearSavedAccountSession(account);
      await updatePlatformAccountCredentialState(account.id, false).catch(() => undefined);
    }
    await failUnfinishedPosts(message);
    throw error;
  } finally {
    if (browser) {
      if (!sessionInvalidated) await saveAccountSessionState(account, browser);
      await browser.close().catch(() => undefined);
    }
  }
}

async function prepareManualAccountSession(account: PublishingAccount) {
  if (account.platform === "x") {
    await prepareXSessionInNormalChrome(account);
    return;
  }

  console.log(`Opening ${account.platform} login page for ${account.handle} (${account.id}).`);
  const browser = await launchAccountBrowser(account);
  try {
    const page = browser.pages()[0] ?? await browser.newPage();
    await loginOnly(page, account, { ignoreLoginErrors: true });
    await saveAccountSessionState(account, browser);
    console.log(`Manual session saved for ${account.platform} account ${account.handle}.`);
  } finally {
    await browser.close().catch(() => undefined);
  }
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
const pendingAutomationRuns: Array<{
  options: RunAutomationOptions;
  resolve: () => void;
  reject: (error: unknown) => void;
}> = [];

export function isAutomationRunning() {
  return activeAutomationRun !== null || pendingAutomationRuns.length > 0;
}

function maxConcurrentAccounts() {
  const configured = Number(process.env.PUBLISH_QUEUE_MAX_CONCURRENT_ACCOUNTS ?? 2);
  return Number.isInteger(configured) ? Math.min(5, Math.max(1, configured)) : 2;
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

async function runAutomationOnce({ mode = "ready", trigger = "manual", startedByUserId, uploadIds, workspaceId }: RunAutomationOptions) {
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

  const automationRunId = await createAutomationRun(trigger, startedByUserId);
  let hadRunFailure = false;
  let runErrorMessage: string | undefined;
  const queues = new Map<string, PlatformUpload[]>();
  for (const upload of uploads) queues.set(upload.accountId, [...(queues.get(upload.accountId) ?? []), upload]);

  try {
    const accountQueues = [...queues.entries()];
    await runWithConcurrency(accountQueues, maxConcurrentAccounts(), async ([accountId, accountUploads]) => {
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
        const accountHadFailure = await runAccountQueue(automationRunId, trigger, account, accountUploads, {
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
  } finally {
    await finishAutomationRun(
      automationRunId,
      hadRunFailure ? "failed" : "completed",
      hadRunFailure ? runErrorMessage : undefined,
    );
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

  activeAutomationRun = runAutomationOnce(next.options);
  activeAutomationRun
    .then(next.resolve, next.reject)
    .finally(() => {
      activeAutomationRun = null;
      startNextAutomationRun();
    });
}
