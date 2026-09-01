import type { BrowserContext, Page } from "playwright-core";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PlatformUpload, PublishingEngine } from "../../shared/schema.js";
import {
  automationInput,
  bindPublishingAccountsToCompanion,
  createAutomationRun,
  createAutomationRunPost,
  deferUploadForSafety,
  finishAutomationRun,
  finishAutomationRunPost,
  getPublishingAccount,
  listPlatformAccounts,
  listUploads,
  pausePlatformAccountForSafety,
  requeueAccountSessionFailures,
  updatePlatformAccountCredentialState,
  updateUploadPublishActionState,
  updateUploadStatus,
  type AutomationInputMode,
  type AutomationRunTrigger,
  type PublishingAccount
} from "../local-storage.js";
import { ensurePublishingMediaLocal } from "../media-storage.js";
import { claimPublishingExecution, releasePublishingExecution, type PublishingExecutionLease } from "../execution-lease.js";
import { publishingCompanionId } from "../companion-identity.js";
import { loginToFacebook, postToFacebook } from "./publishers/facebook.js";
import { loginToInstagram, postToInstagram } from "./publishers/instagram.js";
import { loginToLinkedIn, postToLinkedIn } from "./publishers/linkedin.js";
import type { AccountLogin } from "./publishers/manual-login.js";
import { loginToYouTube, postToYouTube } from "./publishers/youtube.js";
import { loginToX, postToX } from "./publishers/x.js";
import {
  publishingDesktopHost,
  type DesktopBrowserPurpose,
} from "./desktop-host.js";
import { assessPublishingSafety, type PublishingSafetyAssessment } from "./safety-governor.js";
import { classifyPublishingRisk } from "./risk-classifier.js";
import { launchCompanionEngineBrowser } from "../engines/companion/index.js";
import {
  detectedExternalBrowserExecutablePath,
  externalBrowserExecutablePath,
  externalBrowserProfilePath,
  externalBrowserProfilesRoot,
  launchExternalBrowserEngine,
  stopExternalPublishingBrowsers,
} from "../engines/external-browser/index.js";
import type { PublishingBrowserSession } from "../engines/types.js";
import {
  selectManualLoginSurface,
  type ManualLoginRequest,
  type ManualLoginSurface,
} from "./login-surface.js";

const SESSION_STATE_ALGORITHM = "aes-256-gcm";
const platformLoginUrls: Record<PublishingAccount["platform"], string> = {
  instagram: "https://www.instagram.com/accounts/login/",
  x: "https://x.com/i/flow/login",
  linkedin: "https://www.linkedin.com/login/",
  facebook: "https://www.facebook.com/login/",
  youtube: "https://www.youtube.com/upload",
};

type BrowserStorageOrigin = {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
  indexedDB?: unknown[];
  sessionStorage?: Array<{ name: string; value: string }>;
};

type BrowserUserAgentMetadata = {
  brands?: Array<{ brand: string; version: string }>;
  fullVersionList?: Array<{ brand: string; version: string }>;
  fullVersion?: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness?: string;
  wow64?: boolean;
};

type BrowserStorageState = {
  cookies?: Parameters<BrowserContext["addCookies"]>[0];
  origins?: BrowserStorageOrigin[];
  userAgent?: string;
  navigatorPlatform?: string;
  userAgentMetadata?: BrowserUserAgentMetadata;
};

type EncryptedSessionState = {
  version: 1;
  algorithm: typeof SESSION_STATE_ALGORITHM;
  iv: string;
  authTag: string;
  ciphertext: string;
};

function managedChromeSessionPath(account: PublishingAccount) {
  return path.join(externalBrowserProfilePath(account), "companion-managed-session.json");
}

function hasManagedChromeSession(account: PublishingAccount) {
  try {
    return fs.existsSync(managedChromeSessionPath(account));
  } catch {
    return false;
  }
}

function markManagedChromeSession(account: PublishingAccount) {
  const markerPath = managedChromeSessionPath(account);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify({
    version: 1,
    platform: account.platform,
    savedAt: new Date().toISOString(),
  })}\n`, { encoding: "utf8", mode: 0o600 });
}

function accountEngine(account: PublishingAccount): PublishingEngine {
  // Some providers bind a successful login to the Chrome profile that created
  // it. Companion first tries its embedded partition; this protected profile is
  // the reliable local fallback when the provider rejects a state transfer.
  return hasManagedChromeSession(account) ? "external_browser" : "companion";
}

function accountSessionStatePath(account: PublishingAccount) {
  return path.join(externalBrowserProfilePath(account), "automation-session-state.enc.json");
}

function legacyAccountSessionStatePath(account: PublishingAccount) {
  return path.join(externalBrowserProfilePath(account), "automation-session-state.json");
}

function hasExternalAccountProfile(account: PublishingAccount) {
  try {
    return fs.existsSync(externalBrowserProfilePath(account));
  } catch {
    return false;
  }
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

async function removeExternalAccountProfile(account: PublishingAccount) {
  const profilesRoot = path.resolve(externalBrowserProfilesRoot());
  const profilePath = path.resolve(externalBrowserProfilePath(account));
  if (!profilePath.startsWith(`${profilesRoot}${path.sep}`)) {
    throw new Error("The saved account profile path is invalid.");
  }
  await fs.promises.rm(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}

export async function removeSavedAccountProfile(account: PublishingAccount) {
  await Promise.resolve(publishingDesktopHost()?.clearAccountBrowserData(account.id)).catch(() => undefined);
  await removeExternalAccountProfile(account);
}

export function hasSavedAccountSession(account: PublishingAccount) {
  try {
    migrateLegacyAccountSessionState(account);
    const sessionPath = accountSessionStatePath(account);
    return hasManagedChromeSession(account) || (fs.existsSync(sessionPath) && fs.statSync(sessionPath).size > 2);
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
  const binding = await bindPublishingAccountsToCompanion(publishingCompanionId());
  if (binding.rebound > 0) {
    console.log(`Bound ${binding.rebound} publishing account(s) to this Companion instance.`);
  }
  const accounts = await listPlatformAccounts();
  accounts.forEach(migrateLegacyAccountSessionState);
}

export function publishingBrowserRuntimeHealth() {
  const executablePath = detectedExternalBrowserExecutablePath();
  const embeddedBrowser = Boolean(publishingDesktopHost());
  return {
    chromeInstalled: Boolean(executablePath),
    chromeExecutablePath: executablePath,
    embeddedBrowser,
    automationAvailable: embeddedBrowser || Boolean(executablePath),
    engines: {
      companion: { available: embeddedBrowser },
      external_browser: { available: Boolean(executablePath) },
    },
  };
}

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

async function launchAccountBrowser(
  account: PublishingAccount,
  purpose: DesktopBrowserPurpose,
  selectedEngine: PublishingEngine = accountEngine(account),
): Promise<PublishingBrowserSession> {
  const releaseAccount = reserveAccountBrowser(account, purpose);
  const desktopHost = publishingDesktopHost();
  if (selectedEngine === "companion") {
    if (!desktopHost) {
      releaseAccount();
      throw new Error("Publishing requires the Publishing Companion desktop app. Open Companion and try again; Chrome or Edge is available only as a login fallback.");
    }
    return launchCompanionEngineBrowser({
      account,
      purpose,
      desktopHost,
      restoreSessionState: context => restoreAccountSessionState(account, context, "companion"),
      releaseAccount,
    });
  }

  try {
    return await launchExternalBrowserEngine({
      account,
      purpose,
      targetUrl: purpose === "login" ? platformLoginUrls[account.platform] : "about:blank",
      desktopHost,
      restoreSessionState: context => restoreAccountSessionState(account, context, "external_browser"),
      releaseAccount,
    });
  } catch (error) {
    // Launchers release the account after they take ownership. Errors thrown
    // before that point still need to free the per-account operation lock.
    releaseAccount();
    throw error;
  }
}

async function saveAccountSessionState(
  account: PublishingAccount,
  context: BrowserContext,
  engine: PublishingEngine,
) {
  try {
    // Electron's per-account persistent partition already saves cookies with
    // Chromium/OS encryption. Asking CDP for cookies after a large media post
    // can block the embedded service, so no duplicate export is needed here.
    if (engine === "companion") {
      fs.rmSync(legacyAccountSessionStatePath(account), { force: true });
      console.log(`Retained protected Companion session for ${account.platform} account ${account.handle}.`);
      return;
    }
    // Refresh the encrypted recovery copy after every successful external
    // browser run. Some providers issue or rotate cookies while a post is
    // being published, and Chrome may not persist session-only cookies when
    // the managed window closes.
    await exportStandardBrowserSession(account, context);
    fs.rmSync(legacyAccountSessionStatePath(account), { force: true });
    console.log(`Retained dedicated external browser profile for ${account.platform} account ${account.handle}.`);
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
  const nativeState = await context.storageState({ indexedDB: true }) as BrowserStorageState;
  const originByName = new Map((nativeState.origins ?? []).map(origin => [origin.origin, origin]));
  for (const page of context.pages()) {
    const pageStorage = await page.evaluate(() => ({
      origin: window.location.origin,
      sessionStorage: Object.keys(window.sessionStorage).map(name => ({ name, value: window.sessionStorage.getItem(name) ?? "" })),
    })).catch(() => null);
    if (!pageStorage || !/^https?:\/\//i.test(pageStorage.origin)) continue;
    const existing = originByName.get(pageStorage.origin) ?? {
      origin: pageStorage.origin,
      localStorage: [],
    };
    existing.sessionStorage = pageStorage.sessionStorage;
    originByName.set(pageStorage.origin, existing);
  }
  nativeState.origins = [...originByName.values()];

  const identityPage = context.pages().find(page => /^https?:\/\//i.test(page.url())) ?? context.pages()[0];
  if (identityPage) {
    const identity = await identityPage.evaluate(async () => {
      const navigatorWithData = navigator as Navigator & {
        userAgentData?: {
          brands?: Array<{ brand: string; version: string }>;
          mobile?: boolean;
          platform?: string;
          getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
        };
      };
      const data = navigatorWithData.userAgentData;
      const highEntropy: Record<string, unknown> = data?.getHighEntropyValues
        ? await data.getHighEntropyValues(["architecture", "bitness", "fullVersionList", "model", "platformVersion", "uaFullVersion", "wow64"]).catch(() => ({}))
        : {};
      return {
        userAgent: navigator.userAgent,
        navigatorPlatform: navigator.platform,
        userAgentMetadata: data ? {
          brands: data.brands,
          fullVersionList: Array.isArray(highEntropy.fullVersionList) ? highEntropy.fullVersionList as Array<{ brand: string; version: string }> : undefined,
          fullVersion: typeof highEntropy.uaFullVersion === "string" ? highEntropy.uaFullVersion : undefined,
          platform: data.platform ?? "",
          platformVersion: typeof highEntropy.platformVersion === "string" ? highEntropy.platformVersion : "",
          architecture: typeof highEntropy.architecture === "string" ? highEntropy.architecture : "",
          model: typeof highEntropy.model === "string" ? highEntropy.model : "",
          mobile: Boolean(data.mobile),
          bitness: typeof highEntropy.bitness === "string" ? highEntropy.bitness : undefined,
          wow64: typeof highEntropy.wow64 === "boolean" ? highEntropy.wow64 : undefined,
        } : undefined,
      };
    }).catch(() => null);
    if (identity?.userAgent) nativeState.userAgent = identity.userAgent;
    if (identity?.navigatorPlatform) nativeState.navigatorPlatform = identity.navigatorPlatform;
    if (identity?.userAgentMetadata) nativeState.userAgentMetadata = identity.userAgentMetadata;
  }

  writeEncryptedSessionState(accountSessionStatePath(account), nativeState, key);
  console.log(`Saved protected ${account.platform} login session for ${account.handle}.`);
}

export async function installBrowserStorageState(context: BrowserContext, state: BrowserStorageState) {
  const origins = Array.isArray(state.origins) ? state.origins : [];
  const cookies = Array.isArray(state.cookies) ? state.cookies : [];
  if (cookies.length > 0) await context.addCookies(cookies);

  // Electron exposes its persistent partition over CDP. Playwright's
  // setStorageState() tries to create a temporary target, which Electron does
  // not support. Installing storage before provider navigation restores the
  // same data without clearing device-bound managed-Chrome data.
  const storageByOrigin = Object.fromEntries(origins.map(entry => [entry.origin, {
    localStorage: Array.isArray(entry.localStorage) ? entry.localStorage : [],
    sessionStorage: Array.isArray(entry.sessionStorage) ? entry.sessionStorage : [],
  }]));
  await context.addInitScript((entriesByOrigin: Record<string, {
    localStorage: Array<{ name: string; value: string }>;
    sessionStorage: Array<{ name: string; value: string }>;
  }>) => {
    const storage = entriesByOrigin[window.location.origin];
    if (!storage) return;
    for (const entry of storage.localStorage) {
      window.localStorage.setItem(entry.name, entry.value);
    }
    for (const entry of storage.sessionStorage) {
      window.sessionStorage.setItem(entry.name, entry.value);
    }
  }, storageByOrigin);
}

async function restoreAccountSessionState(
  account: PublishingAccount,
  context: BrowserContext,
  engine: PublishingEngine,
) {
  migrateLegacyAccountSessionState(account);
  const statePath = accountSessionStatePath(account);
  if (!fs.existsSync(statePath)) return;

  try {
    const key = sessionEncryptionKey();
    if (!key) return;
    const state = readEncryptedSessionState(statePath, key);
    await installBrowserStorageState(context, state);

    const transferredUserAgent = state.userAgent;
    if (transferredUserAgent) {
      const applyBrowserIdentity = async (page: Page) => {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.setUserAgentOverride", {
          userAgent: transferredUserAgent,
          acceptLanguage: "en-US,en;q=0.9",
          platform: state.navigatorPlatform || "Win32",
          ...(state.userAgentMetadata ? { userAgentMetadata: state.userAgentMetadata } : {}),
        });
      };
      await Promise.all(context.pages().map(page => applyBrowserIdentity(page).catch(() => undefined)));
      context.on("page", page => { void applyBrowserIdentity(page).catch(() => undefined); });
    }
    console.log(`Imported protected ${account.platform} login into ${engine === "companion" ? "Companion" : "the external browser"} for ${account.handle}.`);
  } catch (error) {
    console.warn(
      `Could not restore saved session state for ${account.platform} account ${account.handle}:`,
      errorMessage(error),
    );
  }
}

async function verifyManagedExternalSession(account: PublishingAccount, fallbackReason?: unknown) {
  const browser = await launchAccountBrowser(account, "login", "external_browser");
  try {
    await browser.update({
      state: "opening",
      detail: `Restarting the protected ${account.platform} browser once to verify the saved login.`,
    });
    await loginOnly(browser.page, account, { useSavedSessionOnly: true });
    await exportStandardBrowserSession(account, browser.context);
    markManagedChromeSession(account);
    await browser.update({
      state: "posted",
      detail: "Login survived a fresh browser restart and is ready for publishing in Companion.",
    });
    if (fallbackReason) {
      console.warn(
        `${account.platform} kept the login in the protected managed Chrome profile for ${account.handle}:`,
        errorMessage(fallbackReason),
      );
    }
  } catch (error) {
    await browser.update({ state: "failed", detail: errorMessage(error) }).catch(() => undefined);
    throw error;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function prepareStandardBrowserSession(account: PublishingAccount) {
  const externalBrowser = await launchAccountBrowser(account, "login", "external_browser");
  let exportError: unknown = null;
  try {
    await externalBrowser.update({
      state: "waiting",
      detail: `Complete ${account.platform} login in Chrome or Edge. Companion will transfer and verify the session before saving it.`,
    });
    await loginOnly(externalBrowser.page, account, { ignoreLoginErrors: true });
    await Promise.resolve(publishingDesktopHost()?.clearAccountBrowserData(account.id)).catch(() => undefined);
    try {
      await exportStandardBrowserSession(account, externalBrowser.context);
    } catch (error) {
      exportError = error;
      console.warn(`Could not create a transferable session for ${account.handle}; verifying the protected managed Chrome profile:`, errorMessage(error));
    }
    await externalBrowser.update({
      state: "waiting",
      detail: "Login confirmed. Restart-checking the saved session before it is marked ready.",
    });
  } catch (error) {
    await externalBrowser.update({ state: "failed", detail: errorMessage(error) }).catch(() => undefined);
    throw error;
  } finally {
    await externalBrowser.close().catch(() => undefined);
  }

  if (exportError) {
    await verifyManagedExternalSession(account, exportError);
    return;
  }

  if (!publishingDesktopHost()) {
    await verifyManagedExternalSession(account, new Error("Companion embedded verification is unavailable."));
    return;
  }

  let companionBrowser: PublishingBrowserSession;
  try {
    companionBrowser = await launchAccountBrowser(account, "login", "companion");
  } catch (error) {
    await verifyManagedExternalSession(account, error);
    return;
  }

  let companionTransferError: unknown = null;
  try {
    await companionBrowser.update({
      state: "opening",
      detail: `Verifying the transferred ${account.platform} login inside Companion.`,
    });
    await loginOnly(companionBrowser.page, account, {
      useSavedSessionOnly: true,
      embeddedLogin: true,
    });
    await saveAccountSessionState(account, companionBrowser.context, "companion");
    clearSavedAccountSession(account);
    await companionBrowser.update({
      state: "posted",
      detail: "Login confirmed, transferred, and verified inside Companion. The account is ready to publish.",
    });
    await removeExternalAccountProfile(account).catch(error => {
      console.warn(`Could not remove the temporary external login profile for ${account.handle}:`, errorMessage(error));
    });
    console.log(`${account.platform} login transferred and verified in Companion for ${account.handle}.`);
  } catch (error) {
    companionTransferError = error;
    await Promise.resolve(publishingDesktopHost()?.clearAccountBrowserData(account.id)).catch(() => undefined);
    await companionBrowser.update({
      state: "opening",
      detail: "The provider kept this login bound to Chrome. Companion is restart-checking the protected profile before saving it.",
    }).catch(() => undefined);
  } finally {
    await companionBrowser.close().catch(() => undefined);
  }

  if (companionTransferError) {
    await verifyManagedExternalSession(account, companionTransferError);
  }
}

async function prepareEmbeddedCompanionSession(account: PublishingAccount) {
  const browser = await launchAccountBrowser(account, "login", "companion");

  try {
    await browser.update({
      state: "waiting",
      detail: `Sign in to ${account.platform} inside Companion. Passwords and verification codes stay on the provider page.`,
    });
    await loginOnly(browser.page, account, { ignoreLoginErrors: true, embeddedLogin: true });
    await saveAccountSessionState(account, browser.context, "companion");
    await removeExternalAccountProfile(account).catch(() => undefined);
    await browser.update({
      state: "posted",
      detail: "Login confirmed and the protected local session is ready.",
    });
  } catch (error) {
    const message = errorMessage(error);
    const fallbackHint = /Chrome fallback/i.test(message)
      ? ""
      : " Use the Chrome fallback if this provider blocks embedded sign-in.";
    await browser.update({
      state: "failed",
      detail: `${message}${fallbackHint}`,
    }).catch(() => undefined);
    throw error;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

type AccountLoginOptions = {
  useSavedSessionOnly?: boolean;
  ignoreLoginErrors?: boolean;
  embeddedLogin?: boolean;
  onFinalActionSubmitted?: () => Promise<void> | void;
};

function accountLogin(options: AccountLoginOptions = {}): AccountLogin {
  return {
    useSavedSessionOnly: options.useSavedSessionOnly,
    ignoreLoginErrors: options.ignoreLoginErrors,
    embeddedLogin: options.embeddedLogin,
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

  let browser: PublishingBrowserSession | null = null;
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
      if (!sessionInvalidated) await saveAccountSessionState(account, browser.context, browser.engine);
      await browser.close().catch(() => undefined);
    }
  }
}

async function prepareManualAccountSession(account: PublishingAccount, surface: ManualLoginSurface) {
  console.log(`Opening ${account.platform} login page for ${account.handle} (${account.id}) using the ${surface} login surface.`);
  if (surface === "embedded") {
    await prepareEmbeddedCompanionSession(account);
  } else {
    await prepareStandardBrowserSession(account);
  }
  console.log(`Manual session saved for ${account.platform} account ${account.handle}.`);
}

const activeSessionPreparations = new Map<string, {
  operation: Promise<void>;
  surface: ManualLoginSurface;
}>();

export function assertAccountEngineChangeAllowed(accountId: string) {
  if (activeAccountBrowserOperations.has(accountId) || activeSessionPreparations.has(accountId)) {
    throw new Error("This account is busy with login or publishing. Wait for it to finish before changing its engine.");
  }
}

export async function startManualAccountSession(
  accountId: string,
  requestedSurface: ManualLoginRequest = "engine",
) {
  const existing = activeSessionPreparations.get(accountId);
  const account = await getPublishingAccount(accountId);
  if (!account) throw new Error("Publishing account not found.");
  if (!account.enabled) throw new Error("Publishing account is disabled.");

  if (existing) return { account, started: false, surface: existing.surface };

  const surface = selectManualLoginSurface({
    platform: account.platform,
    requestedSurface,
    activeEngine: accountEngine(account),
    credentialConfigured: account.credentialConfigured,
    externalProfilePresent: hasExternalAccountProfile(account),
    embeddedBrowserAvailable: Boolean(publishingDesktopHost()),
  });
  if (!account.credentialConfigured) {
    if (surface === "external") {
      await Promise.resolve(publishingDesktopHost()?.clearAccountBrowserData(account.id)).catch(() => undefined);
      clearSavedAccountSession(account);
    } else {
      await removeSavedAccountProfile(account);
    }
  }
  if (surface === "external") externalBrowserExecutablePath();

  const operation = prepareManualAccountSession(account, surface)
    .then(async () => {
      await updatePlatformAccountCredentialState(account.id, true);
      const requeued = await requeueAccountSessionFailures(account.id);
      if (requeued.length > 0) {
        console.log(`Requeued ${requeued.length} post(s) after the Companion login was verified.`);
      }
    })
    .catch(async error => {
      if (surface === "external") {
        await removeSavedAccountProfile(account).catch(() => clearSavedAccountSession(account));
      } else {
        await Promise.resolve(publishingDesktopHost()?.clearAccountBrowserData(account.id)).catch(() => undefined);
        clearSavedAccountSession(account);
      }
      await updatePlatformAccountCredentialState(account.id, hasManagedChromeSession(account)).catch(() => undefined);
      console.error(
        `Manual session preparation failed for ${account.platform} account ${account.handle}:`,
        errorMessage(error),
      );
    })
    .finally(() => {
      activeSessionPreparations.delete(account.id);
    });

  activeSessionPreparations.set(account.id, { operation, surface });
  return { account, started: true, surface };
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
  await Promise.all([
    Promise.resolve(publishingDesktopHost()?.stopPublishingBrowsers(reason)).catch(() => undefined),
    stopExternalPublishingBrowsers(reason).catch(() => undefined),
  ]);
  return wasRunning;
}

function maxConcurrentAccounts() {
  // Different accounts can start together at the scheduled minute. Their
  // selected engines remain visible, while the per-account lock guarantees
  // that one account never receives overlapping jobs.
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
  const requestedUploads = Object.values(channels).flat().filter(upload => !requestedIds || requestedIds.has(upload.id));
  const companionId = publishingCompanionId();
  const accountAssignments = new Map(await Promise.all([...new Set(requestedUploads.map(upload => upload.accountId))]
    .map(async accountId => [accountId, await getPublishingAccount(accountId)] as const)));
  const candidateUploads = requestedUploads.filter(upload => {
    const account = accountAssignments.get(upload.accountId);
    return account && (!account.companionId || account.companionId === companionId);
  });
  if (candidateUploads.length === 0) {
    console.log(requestedIds
      ? "None of the requested posts are ready for publishing."
      : "No due uploads for enabled publishing accounts.");
    return;
  }

  const leaseOwnerId = process.env.PUBLISHING_COMPANION_ID?.trim() || `companion-${process.pid}`;
  const leaseResults = await Promise.all(candidateUploads.map(async upload => ({
    upload,
    lease: await claimPublishingExecution(upload.id, upload.workspaceId, leaseOwnerId),
  })));
  const claimed = leaseResults.filter((item): item is { upload: PlatformUpload; lease: PublishingExecutionLease } => Boolean(item.lease));
  if (claimed.length === 0) {
    console.log("All due publishing jobs are already claimed by another Companion.");
    return;
  }

  const executableClaims: typeof claimed = [];
  for (const item of claimed) {
    try {
      if (item.upload.postFormat !== "text" && item.upload.fileName) {
        await ensurePublishingMediaLocal(item.upload.fileName, item.upload.workspaceId);
      }
      executableClaims.push(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Publishing media is missing.";
      await updateUploadStatus(item.upload.id, "failed", `Publishing media is unavailable: ${message}`, startedByUserId, item.upload.workspaceId)
        .catch(() => undefined);
      await releasePublishingExecution(item.lease).catch(() => undefined);
    }
  }
  const uploads = executableClaims.map(item => item.upload);
  if (uploads.length === 0) {
    console.warn("No claimed publishing jobs had usable media.");
    return;
  }

  const desktopHost = publishingDesktopHost();
  if (desktopHost) await desktopHost.requestPublishingPermission();

  let automationRunId: string;
  try {
    automationRunId = await createAutomationRun(trigger, startedByUserId);
  } catch (error) {
    await Promise.allSettled([
      Promise.resolve(desktopHost?.finishPublishingRun()),
      ...executableClaims.map(item => releasePublishingExecution(item.lease)),
    ]);
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
      await Promise.allSettled([
        Promise.resolve(desktopHost?.finishPublishingRun()),
        ...executableClaims.map(item => releasePublishingExecution(item.lease)),
      ]);
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
