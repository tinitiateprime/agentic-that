// ChatGPT, Claude and Gemini through the user's own logins. Each app gets its
// own dedicated Chrome or Edge profile (the same real-browser engine the
// Companion uses for publishing), so Google sign-in works and the login is
// remembered. The user logs in and handles any "verify you are human" check
// themselves in a visible window; everything else runs in the background.

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type CDPSession, type Locator, type Page } from "playwright-core";
import {
  detectedExternalBrowserExecutablePath,
  externalBrowserExecutablePath,
  getFreePort,
  prepareExternalBrowserProfile,
  waitForDebugEndpoint,
  waitForProcessExit,
} from "../../engines/external-browser/index.js";
import { publishingBrowserDataDirectory } from "../../runtime-paths.js";
import { publishingDesktopHost } from "../desktop-host.js";
import { markerCount, splitPrompt } from "./master-prompt.js";
import { setWindowPresence } from "./native-window.js";
import { AI_PROVIDERS, PROVIDERS, looksLikeHumanCheck, onAppPage, type AiProviderId, type ProviderSpec, appErrorReply, uploadLimitNotice, usageLimitNotice } from "./providers.js";

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const NEEDS_YOU_TIMEOUT_MS = 10 * 60 * 1000;
const ANSWER_TIMEOUT_MS = 8 * 60 * 1000;
const VISIBLE_BOUNDS = { left: 80, top: 50, width: 1200, height: 860 };
const HIDDEN_BOUNDS = { left: -10_000, top: -10_000, width: 1280, height: 900 };

const accountsRoot = () => path.join(publishingBrowserDataDirectory(), "ai-accounts");
const profileDir = (provider: AiProviderId) => path.join(accountsRoot(), provider);
const accountsFile = () => path.join(accountsRoot(), "accounts.json");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A short step log (ai-accounts/ai.log) so a failure says exactly where it
 * stopped. It never contains prompts, answers or images.
 */
function log(provider: AiProviderId, message: string) {
  try {
    fs.mkdirSync(accountsRoot(), { recursive: true });
    const file = path.join(accountsRoot(), "ai.log");
    if (fs.existsSync(file) && fs.statSync(file).size > 256_000) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${provider} ${message}\n`);
  } catch {
    // Logging must never break the work.
  }
}

type AccountRecord = { connected: boolean; connectedAt?: string };

function readAccounts(): Partial<Record<AiProviderId, AccountRecord>> {
  try {
    return JSON.parse(fs.readFileSync(accountsFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeAccount(provider: AiProviderId, record: AccountRecord | null) {
  const accounts = readAccounts();
  if (record) accounts[provider] = record;
  else delete accounts[provider];
  fs.mkdirSync(accountsRoot(), { recursive: true });
  fs.writeFileSync(accountsFile(), JSON.stringify(accounts, null, 2));
}

// ---- One real browser window per AI app -------------------------------------------

type AiWindow = {
  provider: AiProviderId;
  process: ChildProcess;
  browser: Browser;
  page: Page;
  cdp: CDPSession;
  windowId?: number;
  closed: boolean;
  busy: number;
};

const windows = new Map<AiProviderId, AiWindow>();
const opening = new Map<AiProviderId, Promise<AiWindow>>();

// ---- What each AI is doing, for the website and the Companion's Social SEO view ----

export type AiStep = "opening" | "uploading" | "sending" | "writing";
type Activity = { state: "connecting" | "needs-you" | "working"; detail: string; step?: AiStep; startedAt: number };
type RecentRun = { provider: AiProviderId; label: string; ok: boolean; seconds: number; at: string; message?: string; limit?: boolean };

const activity = new Map<AiProviderId, Activity>();
const recentRuns: RecentRun[] = [];

/** Everything the Companion shows in its Social SEO view. */
export function aiActivitySnapshot() {
  const accounts = readAccounts();
  return {
    providers: AI_PROVIDERS.map((id) => {
      const now = activity.get(id);
      const connected = Boolean(accounts[id]?.connected);
      return { id, label: PROVIDERS[id].label, connected, state: now?.state || (connected ? "connected" : "not-connected"), step: now?.step || null, detail: now?.detail || "", startedAt: now?.startedAt || null };
    }),
    recent: recentRuns,
  };
}

function publishActivity() {
  try {
    publishingDesktopHost()?.updateAiActivity?.(aiActivitySnapshot());
  } catch {
    // The Companion window may be closed; the work goes on.
  }
}

function setActivity(provider: AiProviderId, next: Omit<Activity, "startedAt"> | null) {
  if (next) {
    const current = activity.get(provider);
    // A new kind of work starts its own clock; steps within it keep the clock.
    activity.set(provider, { ...next, startedAt: current && current.state === next.state ? current.startedAt : Date.now() });
  } else {
    activity.delete(provider);
  }
  publishActivity();
}

function rememberRun(run: RecentRun) {
  recentRuns.unshift(run);
  recentRuns.splice(12);
  publishActivity();
}

async function setBounds(window: AiWindow, bounds: typeof VISIBLE_BOUNDS) {
  if (typeof window.windowId !== "number") return;
  await window.cdp.send("Browser.setWindowBounds", { windowId: window.windowId, bounds: { windowState: "normal" } }).catch(() => undefined);
  await window.cdp.send("Browser.setWindowBounds", { windowId: window.windowId, bounds }).catch(() => undefined);
}

/** Brings the window on screen, back in the taskbar and to the front: the user is needed. */
async function showWindow(window: AiWindow) {
  await setBounds(window, VISIBLE_BOUNDS);
  await setWindowPresence(window.process.pid, "foreground");
  await window.page.bringToFront().catch(() => undefined);
}

/** Off screen and out of the taskbar and Alt+Tab, still working at full speed. */
async function hideWindow(window: AiWindow) {
  await setBounds(window, HIDDEN_BOUNDS);
  await setWindowPresence(window.process.pid, "background");
}

/** AI windows only live while they work: closed after each answer or login. */
async function closeWindow(provider: AiProviderId) {
  const window = windows.get(provider);
  if (!window) return;
  windows.delete(provider);
  window.closed = true;
  await Promise.race([window.browser.close().catch(() => undefined), sleep(1500)]);
  if (!(await waitForProcessExit(window.process, 3000))) window.process.kill();
}

async function launchWindow(provider: AiProviderId, url: string, visible: boolean): Promise<AiWindow> {
  const directory = profileDir(provider);
  fs.mkdirSync(directory, { recursive: true });
  prepareExternalBrowserProfile(directory);
  const port = await getFreePort();
  const bounds = visible ? VISIBLE_BOUNDS : HIDDEN_BOUNDS;
  const child = spawn(externalBrowserExecutablePath(), [
    `--user-data-dir=${directory}`,
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
    const page = context.pages().find((candidate) => candidate.url().includes(host)) ?? context.pages()[0] ?? await context.newPage();
    const cdp = await context.newCDPSession(page);
    const target = await cdp.send("Browser.getWindowForTarget").catch(() => ({})) as { windowId?: number };
    const window: AiWindow = { provider, process: child, browser, page, cdp, windowId: target.windowId, closed: false, busy: 0 };
    browser.on("disconnected", () => {
      window.closed = true;
      if (windows.get(provider) === window) windows.delete(provider);
    });
    child.once("exit", () => {
      window.closed = true;
      if (windows.get(provider) === window) windows.delete(provider);
    });
    if (visible) {
      await showWindow(window);
    } else {
      // The window title appears a moment after launch; apply again to be sure.
      void setWindowPresence(child.pid, "background").then(() => sleep(2500)).then(() => (window.closed ? 0 : setWindowPresence(child.pid, "background")));
    }
    windows.set(provider, window);
    return window;
  } catch (error) {
    child.kill();
    throw error;
  }
}

/** The app's window, opened at the address (or reused and sent there). */
async function aiWindow(provider: AiProviderId, url: string, visible: boolean) {
  const existing = windows.get(provider);
  if (existing && !existing.closed && !existing.page.isClosed()) {
    await existing.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    if (visible) await showWindow(existing);
    return existing;
  }
  const pending = opening.get(provider);
  if (pending) return pending;
  const launch = launchWindow(provider, url, visible).finally(() => opening.delete(provider));
  opening.set(provider, launch);
  return launch;
}

// ---- Reading the page --------------------------------------------------------------

async function firstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function waitVisible(page: Page, selectors: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await firstVisible(page, selectors);
    if (found) return found;
    await sleep(500);
  }
  return null;
}

async function signedIn(spec: ProviderSpec, page: Page) {
  if (page.isClosed() || !onAppPage(spec, page.url())) return false;
  if (await firstVisible(page, spec.signedOut)) return false;
  return Boolean(await firstVisible(page, spec.prompt));
}

/**
 * A "verify you are human" page or a visible check box. Sites also embed
 * invisible check widgets on normal pages, so a widget only counts when it is
 * actually shown to the user.
 */
async function humanCheck(page: Page) {
  if (page.isClosed()) return false;
  if (looksLikeHumanCheck(await page.title().catch(() => ""), page.url())) return true;
  const widgets = page.locator("iframe[src*='challenges.cloudflare.com'], iframe[src*='recaptcha'], iframe[src*='hcaptcha']");
  const count = await widgets.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const box = await widgets.nth(index).boundingBox().catch(() => null);
    if (box && box.width >= 40 && box.height >= 40 && await widgets.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

// ---- Connecting ----------------------------------------------------------------------

export function aiStatus() {
  const accounts = readAccounts();
  const browser = detectedExternalBrowserExecutablePath();
  return {
    browserAvailable: Boolean(browser),
    browserName: browser ? (/edge|msedge/i.test(browser) ? "Microsoft Edge" : /chromium/i.test(browser) ? "Chromium" : "Google Chrome") : "",
    providers: AI_PROVIDERS.map((id) => {
      const connected = Boolean(accounts[id]?.connected);
      const now = activity.get(id);
      return { id, label: PROVIDERS[id].label, connected, state: now?.state || (connected ? "connected" : "not-connected"), detail: now?.detail || "" };
    }),
  };
}

/** Opens the app's own login page in a visible window and waits for the user to finish. */
export async function connectAi(provider: AiProviderId) {
  const spec = PROVIDERS[provider];
  const current = activity.get(provider);
  if (current?.state === "connecting" || current?.state === "needs-you") {
    const window = windows.get(provider);
    if (window) await showWindow(window);
    return;
  }
  setActivity(provider, { state: "connecting", detail: `Log in to ${spec.label} in the window that opened (Google, Microsoft, Apple or email). It is saved for next time.` });
  let window: AiWindow;
  try {
    window = await aiWindow(provider, spec.loginUrl, true);
  } catch (error) {
    setActivity(provider, null);
    throw error;
  }
  window.busy += 1;
  void (async () => {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    try {
      while (Date.now() < deadline && !window.closed) {
        if (await signedIn(spec, window.page)) {
          writeAccount(provider, { connected: true, connectedAt: new Date().toISOString() });
          log(provider, "connected");
          // Let the app finish saving the login, then close its window.
          await sleep(2500);
          return;
        }
        await sleep(1500);
      }
    } catch (error) {
      log(provider, `login failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      window.busy -= 1;
      if (activity.get(provider)?.state === "connecting") setActivity(provider, null);
      if (window.busy === 0) await closeWindow(provider);
    }
  })();
}

export async function disconnectAi(provider: AiProviderId) {
  setActivity(provider, null);
  await closeWindow(provider);
  writeAccount(provider, null);
  await fsp.rm(profileDir(provider), { recursive: true, force: true }).catch(() => undefined);
}

export async function showAiWindow(provider: AiProviderId) {
  const window = windows.get(provider);
  if (window) await showWindow(window);
}

// ---- Asking ----------------------------------------------------------------------------

export type AskEvent =
  | { state: "working"; detail: string; step?: AiStep }
  | { state: "needs-you"; detail: string }
  | { state: "writing"; live: string };

/**
 * Waits until the app is signed in and not behind a human check. If the user is
 * needed (signed out, or a "verify you are human" page), the window is shown
 * and the work continues by itself once they are done.
 */
async function readyToChat(window: AiWindow, spec: ProviderSpec, onEvent: (event: AskEvent) => void) {
  const started = Date.now();
  let shown = false;
  while (true) {
    if (window.closed) throw new Error(`The ${spec.label} window was closed.`);
    const check = await humanCheck(window.page);
    if (!check && await signedIn(spec, window.page)) {
      if (shown) {
        await hideWindow(window);
        setActivity(spec.id, { state: "working", step: "opening", detail: `${spec.label} is back to work on your post.` });
        if (!onAppPage(spec, window.page.url()) || !window.page.url().startsWith(spec.newChatUrl)) {
          await window.page.goto(spec.newChatUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
        }
        writeAccount(spec.id, { connected: true, connectedAt: new Date().toISOString() });
      }
      return;
    }
    // Pages often need a few seconds to settle before deciding the user is needed.
    if (!shown && Date.now() - started > 8000) {
      shown = true;
      await showWindow(window);
      // On a sign-in page any check is part of logging in, so ask for the login.
      const loginNeeded = !onAppPage(spec, window.page.url()) || Boolean(await firstVisible(window.page, spec.signedOut));
      const detail = check && !loginNeeded
        ? `${spec.label} wants to check you are human. Complete it in the ${spec.label} window and it continues by itself.`
        : `Log in to ${spec.label} again in the window that opened, and it continues by itself.`;
      setActivity(spec.id, { state: "needs-you", detail });
      onEvent({ state: "needs-you", detail });
    }
    if (Date.now() - started > NEEDS_YOU_TIMEOUT_MS) throw new Error(`${spec.label} is still waiting for you in its window. Open it, finish there, and try again.`);
    await sleep(1500);
  }
}

async function pasteText(page: Page, box: Locator, text: string) {
  await focusBox(box);
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

async function typePrompt(page: Page, box: Locator, text: string) {
  const isTextarea = await box.evaluate((element) => element.tagName === "TEXTAREA", undefined, { timeout: 3000 }).catch(() => false);
  if (isTextarea) {
    await box.fill(text);
    return;
  }
  // Apps restore an unsent draft (ChatGPT does): start from an empty box so
  // nothing from an earlier post mixes into this one.
  await focusBox(box);
  await page.keyboard.press("ControlOrMeta+A").catch(() => undefined);
  await page.keyboard.press("Backspace").catch(() => undefined);
  await pasteText(page, box, text);
  await sleep(400);
  const probe = text.slice(0, 40).replace(/\s+/g, " ");
  const typed = (await box.innerText({ timeout: 3000 }).catch(() => "")).replace(/\s+/g, " ");
  // Some editors ignore synthetic paste: type it instead.
  if (!typed.includes(probe.slice(0, 20))) {
    await focusBox(box);
    await page.keyboard.insertText(text);
  }
}

async function pasteImages(page: Page, box: Locator, files: string[]) {
  const items = await Promise.all(files.map(async (file) => ({
    name: path.basename(file),
    type: file.endsWith(".png") ? "image/png" : "image/jpeg",
    data: (await fsp.readFile(file)).toString("base64"),
  })));
  await focusBox(box);
  await page.evaluate((entries) => {
    const data = new DataTransfer();
    for (const entry of entries) {
      const binary = atob(entry.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      data.items.add(new File([bytes], entry.name, { type: entry.type }));
    }
    (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, items);
}

/**
 * Clicks a button even when a cookie banner or tip covers it: the click goes to
 * the button itself. Banners are left for the user to answer.
 */
async function press(target: Locator) {
  try {
    await target.click({ timeout: 4000 });
  } catch {
    await target.evaluate((element) => (element as HTMLElement).click(), undefined, { timeout: 3000 });
  }
}

/**
 * The message box once the page has settled. Apps can show a placeholder first
 * and swap in the real editor seconds later (ChatGPT does, ~4 s after loading):
 * the box is used only after it has been the same element for 1.5 seconds.
 */
async function settledPromptBox(page: Page, spec: ProviderSpec, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  let stableChecks = 0;
  let box: Locator | null = null;
  while (Date.now() < deadline) {
    box = await firstVisible(page, spec.prompt);
    const signature = box
      ? await box.evaluate((element) => `${element.tagName}|${element.id}|${element.getAttribute("aria-label") || ""}|${element.className}`, undefined, { timeout: 2000 }).catch(() => "")
      : "";
    if (signature && signature === last) {
      stableChecks += 1;
      if (stableChecks >= 3) return box;
    } else {
      stableChecks = 0;
      last = signature;
    }
    await sleep(500);
  }
  return box;
}

/**
 * Picks the app's best answer setting (Gemini: thinking level "High"). It is
 * remembered by the app, so later posts usually find it already chosen. If the
 * menu has changed, the post is still written with the app's default.
 */
async function chooseBestQuality(page: Page, spec: ProviderSpec) {
  const menu = spec.qualityMenu;
  if (!menu) return;
  // The menu button is drawn a few seconds after the chat box.
  const button = await waitVisible(page, menu.button, 10_000);
  if (!button) {
    log(spec.id, "answer setting: menu button not found, using the app's default");
    return;
  }
  try {
    await button.click({ timeout: 5000 }).catch(() => press(button));
    await sleep(1000);
    if (menu.submenu) {
      const submenu = page.getByText(menu.submenu, { exact: true }).first();
      await submenu.waitFor({ state: "visible", timeout: 4000 });
      await submenu.click({ timeout: 4000 });
      await sleep(1000);
    }
    const option = page.getByText(menu.option, { exact: true }).first();
    await option.waitFor({ state: "visible", timeout: 4000 });
    await option.click({ timeout: 4000 });
    log(spec.id, `answer setting: ${menu.option}`);
  } catch (error) {
    log(spec.id, `answer setting not changed: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 100) : error}`);
  } finally {
    await sleep(500);
    await page.keyboard.press("Escape").catch(() => undefined);
    await sleep(200);
    await page.keyboard.press("Escape").catch(() => undefined);
  }
}

/** The message box as it is now (pages re-render it), or the last one found. */
async function freshBox(page: Page, spec: ProviderSpec, fallback: Locator) {
  return (await firstVisible(page, spec.prompt)) || fallback;
}

/** Puts the cursor in the message box, even under a banner. */
async function focusBox(box: Locator) {
  try {
    await box.click({ timeout: 4000 });
  } catch {
    await box.evaluate((element) => (element as HTMLElement).focus(), undefined, { timeout: 3000 }).catch(() => undefined);
  }
}

/** An app's own plan limit (uploads or messages): not something a retry now can fix. */
export class AiLimitError extends Error {
  readonly limit = true;
}

/** Throws a clear limit error when the app shows that its plan's messages are used up. */
async function throwIfUsageLimit(page: Page, spec: ProviderSpec) {
  const notice = usageLimitNotice(await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""));
  if (!notice) return;
  log(spec.id, `usage limit: ${notice}`);
  throw new AiLimitError(`${spec.label} has used up your plan's messages for now. It says: "${notice}" Try ${spec.label} again then, or upgrade your ${spec.label} plan.`);
}

async function uploadLimitReached(page: Page) {
  // The notice sits beside ChatGPT's menu items, not inside them: read the page
  // (a new, empty chat at this point).
  return uploadLimitNotice(await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""));
}

/** Picture thumbnails on the page: a new one proves an attachment worked. */
function thumbnails(page: Page): Promise<number> {
  return page.evaluate(`[...document.querySelectorAll("img")].filter((image) => {
    const box = image.getBoundingClientRect();
    return box.width >= 24 && box.width <= 600 && box.height >= 24 && /^(blob:|data:image|https?:)/.test(image.currentSrc || image.src) && !/avatar|profile|logo|icon|emoji/i.test(image.className + " " + image.alt + " " + image.src);
  }).length`).then(Number).catch(() => 0);
}

async function attached(page: Page, before: number) {
  for (let waited = 0; waited < 6000; waited += 500) {
    if (await thumbnails(page) > before) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Attaches the post images, proving each way worked (a thumbnail appears)
 * before moving on: the app's file inputs, then its upload menu, then a paste.
 */
async function attachImages(page: Page, spec: ProviderSpec, box: Locator, files: string[]) {
  if (!files.length) return;
  const before = await thumbnails(page);
  // Some apps add their upload inputs a few seconds after the chat box appears.
  const inputsReady = Date.now() + 10_000;
  let inputCount = 0;
  while (Date.now() < inputsReady) {
    inputCount = (await Promise.all(spec.fileInput.map((selector) => page.locator(selector).count().catch(() => 0)))).reduce((sum, count) => sum + count, 0);
    if (inputCount > 0) break;
    await sleep(500);
  }
  log(spec.id, `attaching: ${before} thumbnail(s) before, ${inputCount} upload input match(es)`);
  const tried = new Set<string>();
  for (const selector of spec.fileInput) {
    const inputs = page.locator(selector);
    const count = await inputs.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      // The same input can match several selectors: try each only once.
      const key = await inputs.nth(index).evaluate((element) => element.id || element.outerHTML.slice(0, 120), undefined, { timeout: 3000 }).catch(() => `${selector}-${index}`);
      if (tried.has(key)) continue;
      tried.add(key);
      try {
        await inputs.nth(index).setInputFiles(files);
        if (await attached(page, before)) {
          log(spec.id, `attached with file input ${selector} #${index}`);
          return;
        }
        log(spec.id, `file input ${key.slice(0, 40)}: no thumbnail (now ${await thumbnails(page)})`);
      } catch (error) {
        log(spec.id, `file input ${key.slice(0, 40)} failed: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
      }
    }
  }
  // The app's "+" button: it may open the file picker itself, add the upload
  // inputs, or open a menu whose "Upload files" item opens the picker (Gemini).
  const attach = await firstVisible(page, spec.attachButtons);
  if (attach) {
    const opensPicker = async (target: Locator, timeout = 5000) => {
      const chooser = page.waitForEvent("filechooser", { timeout }).catch(() => null);
      await press(target).catch(() => undefined);
      return chooser;
    };
    let picker = await opensPicker(attach, spec.attachMenuItems.length ? 2500 : 5000);
    const limit = picker ? null : await uploadLimitReached(page);
    if (limit) {
      await page.keyboard.press("Escape").catch(() => undefined);
      log(spec.id, `upload limit: ${limit}`);
      throw new AiLimitError(`${spec.label} won't take more images on your free plan right now. It says: "${limit[0].toUpperCase()}${limit.slice(1)}." Try ${spec.label} again then, or upgrade your ${spec.label} plan.`);
    }
    if (!picker) {
      // Inputs that appeared after the click.
      for (const selector of spec.fileInput) {
        const inputs = page.locator(selector);
        const count = await inputs.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
          try {
            await inputs.nth(index).setInputFiles(files);
            if (await attached(page, before)) {
              await page.keyboard.press("Escape").catch(() => undefined);
              log(spec.id, `attached with file input ${selector} #${index} after opening the upload menu`);
              return;
            }
          } catch {
            // Try the next way.
          }
        }
      }
      const item = await waitVisible(page, spec.attachMenuItems, 4000);
      if (item) picker = await opensPicker(item);
      // A one-time "before you upload" notice: accept it, and the picker follows.
      if (!picker) {
        const agree = await firstVisible(page, ["button:has-text('Agree')", "button:has-text('Accept')", "button:has-text('Got it')", "button:has-text('Continue')"]);
        if (agree) picker = await opensPicker(agree);
      }
    }
    if (picker) {
      await picker.setFiles(files);
      if (await attached(page, before)) {
        log(spec.id, "attached with the upload menu");
        return;
      }
    } else {
      log(spec.id, "upload menu: no file picker opened");
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }
  await pasteImages(page, box, files);
  if (await attached(page, before)) log(spec.id, "attached by pasting");
  else {
    throw new Error(`Couldn't attach your post image in ${spec.label}. Its page may have changed; please try again.`);
  }
}

async function sendButtonReady(page: Page, spec: ProviderSpec) {
  const button = await firstVisible(page, spec.send);
  if (!button) return null;
  const disabled = await button.evaluate((element) => (element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true", undefined, { timeout: 3000 }).catch(() => true);
  return disabled ? null : button;
}

async function lastAnswer(page: Page, spec: ProviderSpec) {
  for (const selector of spec.answer) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (count > 0) return { count, text: (await locator.nth(count - 1).innerText().catch(() => "")).trim() };
  }
  return { count: 0, text: "" };
}

const queues = new Map<AiProviderId, Promise<unknown>>();
/** Requests waiting or running per app: the window closes when the last one ends. */
const pendingAsks = new Map<AiProviderId, number>();

/** Sends the prompt and images to one app and returns its full answer. One request per app at a time. */
export function askAi(provider: AiProviderId, prompt: string, images: string[], onEvent: (event: AskEvent) => void): Promise<string> {
  pendingAsks.set(provider, (pendingAsks.get(provider) || 0) + 1);
  const job = (queues.get(provider) || Promise.resolve()).then(() => ask(provider, prompt, images, onEvent));
  queues.set(provider, job.catch(() => undefined));
  return job.finally(() => pendingAsks.set(provider, Math.max(0, (pendingAsks.get(provider) || 1) - 1)));
}

async function ask(provider: AiProviderId, prompt: string, images: string[], onEvent: (event: AskEvent) => void) {
  const spec = PROVIDERS[provider];
  const startedAt = Date.now();
  const step = (name: AiStep, detail: string) => {
    setActivity(provider, { state: "working", step: name, detail });
    onEvent({ state: "working", detail, step: name });
  };
  activity.delete(provider);
  step("opening", `Opening ${spec.label}…`);
  let window: AiWindow | null = null;
  try {
    window = await aiWindow(provider, spec.newChatUrl, false);
    window.busy += 1;
    const { page } = window;
    await readyToChat(window, spec, onEvent);
    if (activity.get(provider)?.state !== "working") step("opening", `Opening ${spec.label}…`);
    await chooseBestQuality(page, spec);
    const box = await settledPromptBox(page, spec);
    if (!box) throw new Error(`Couldn't find the message box in ${spec.label}. Its page may have changed; please try again.`);

    log(provider, `ready at ${new URL(page.url()).pathname}`);
    step(images.length ? "uploading" : "sending", images.length ? `Uploading your post to ${spec.label}…` : `Sending to ${spec.label}…`);
    const plainly = spec.askPlainlyFirst ? splitPrompt(prompt) : null;
    await typePrompt(page, await freshBox(page, spec, box), plainly ? plainly.ask : prompt);
    log(provider, plainly ? "prompt typed (asked plainly first)" : "prompt typed");
    await attachImages(page, spec, await freshBox(page, spec, box), images);
    log(provider, `${images.length} image(s) attached`);

    // Let the upload finish: the send button turns on when it is ready, and
    // uploads take a moment more on slow connections.
    const uploadDeadline = Date.now() + 120_000;
    await sleep(images.length ? 2500 + images.length * 1000 : 300);
    while (Date.now() < uploadDeadline && !(await sendButtonReady(page, spec))) {
      if (await humanCheck(page)) await readyToChat(window, spec, onEvent);
      await sleep(700);
    }
    const live = window;
    // Sends what is in the box and reads the reply until it stops changing. With
    // sections, a finished answer has the sections the prompt asks for.
    const sendAndRead = async (writing: string, sections = true) => {
      const wanted = sections ? markerCount(prompt) : 0;
      const before = (await lastAnswer(page, spec)).count;
      step("sending", `Sending to ${spec.label}…`);

      // Send, and make sure it really left the box: an app can ignore a click
      // while an upload is still finishing, so press again until it goes.
      const promptText = async () => (await (await freshBox(page, spec, box)).evaluate((element) => ("value" in element ? String((element as HTMLTextAreaElement).value) : element.textContent || ""), undefined, { timeout: 3000 }).catch(() => "")).trim();
      const sendDeadline = Date.now() + 90_000;
      let sent = false;
      for (let attempt = 1; !sent && Date.now() < sendDeadline; attempt += 1) {
        const send = await sendButtonReady(page, spec);
        if (send) await press(send);
        else await (await freshBox(page, spec, box)).press("Enter", { timeout: 3000 }).catch(() => undefined);
        for (let waited = 0; waited < 6000 && !sent; waited += 500) {
          await sleep(500);
          sent = (await lastAnswer(page, spec)).count > before || (await promptText()).length < 20;
        }
        log(provider, `send attempt ${attempt}: ${sent ? "sent" : "still in the box"}`);
      }
      if (!sent) await throwIfUsageLimit(page, spec);
      if (!sent) throw new Error(`${spec.label} didn't take the message. Check its window: it may need you, or your plan's limit may be reached.`);
      step("writing", writing);

      // Read the answer while it is written, until it stops changing.
      const started = Date.now();
      let text = "";
      let stableFor = 0;
      let answering = false;
      let limitCheckedAt = 0;
      while (Date.now() - started < ANSWER_TIMEOUT_MS) {
        await sleep(1000);
        if (live.closed) throw new Error(`The ${spec.label} window was closed.`);
        if (await humanCheck(page)) await readyToChat(live, spec, onEvent);
        const now = await lastAnswer(page, spec);
        if (now.count > before) answering = true;
        if (!answering) {
          // An app out of messages says so instead of answering: stop waiting.
          if (Date.now() - limitCheckedAt > 10_000) {
            limitCheckedAt = Date.now();
            await throwIfUsageLimit(page, spec);
          }
          // Thinking ("Extra thorough") can take minutes before the answer shows:
          // keep waiting while the app's stop button says it is working.
          const waited = Date.now() - started;
          if (waited > 120_000 && (waited > 360_000 || !(await firstVisible(page, spec.stop)))) throw new Error(`${spec.label} didn't start answering. Check its window (it may need you, or your plan's limit may be reached).`);
          continue;
        }
        if (now.text !== text) {
          text = now.text;
          stableFor = 0;
          if (text) {
            onEvent({ state: "writing", live: text });
            const current = activity.get(provider);
            if (current) activity.set(provider, { ...current, detail: `${writing} ${text.length.toLocaleString("en")} characters so far` });
            publishActivity();
          }
        } else {
          stableFor += 1;
        }
        // Done only when the real answer is there. While an app thinks (Gemini on
        // "Extra thorough") it shows a short status line that stays still for a
        // while, so the answer must have the sections the prompt asks for. Gemini's
        // stop button can also stay on screen after it finishes.
        const streaming = Boolean(await firstVisible(page, spec.stop));
        const found = markerCount(text);
        if (text && found >= wanted && stableFor >= 3 && (!streaming || stableFor >= 15)) break;
        if (text && found >= wanted / 2 && stableFor >= 20 && (!streaming || stableFor >= 40)) break;
        if (text && stableFor >= 90 && (!streaming || stableFor >= 150)) break;
        // The app's own error reply ("Could you try again?"): no need to wait.
        if (stableFor >= 4 && appErrorReply(text)) break;
      }
      if (!text) throw new Error(`${spec.label} took too long to answer.`);
      log(provider, `answer read (${text.length} characters) in ${Math.round((Date.now() - started) / 1000)}s`);
      return text;
    };

    // Apps sometimes fail a request ("I encountered an error… Could you try
    // again?"): ask again in the same chat, which still has the post.
    const answer = async (writing: string, sections: boolean) => {
      let reply = await sendAndRead(writing, sections);
      for (let retry = 1; retry <= 2 && appErrorReply(reply); retry += 1) {
        log(provider, `the app replied with an error, asking again (${retry}): ${reply.slice(0, 80)}`);
        await sleep(3000);
        await typePrompt(page, await freshBox(page, spec, box), "That didn't work. Please try again: the same request, in full.");
        reply = await sendAndRead(`${spec.label} had a hiccup, asking again…`, sections);
      }
      if (appErrorReply(reply)) throw new Error(`${spec.label} couldn't answer right now. It said: "${reply.replace(/\s+/g, " ").trim()}" Please try ${spec.label} again in a few minutes.`);
      return reply;
    };

    let text = await answer(`${spec.label} is writing your posts…`, !plainly);
    if (plainly) {
      // Its full answer, then the same posts arranged into the sections.
      await typePrompt(page, await freshBox(page, spec, box), plainly.arrange);
      const arranged = await answer(`${spec.label} is putting your posts in place…`, true);
      if (markerCount(arranged) * 2 >= markerCount(prompt)) text = arranged;
      else log(provider, `arranging gave ${markerCount(arranged)} sections: showing the full answer`);
    }
    rememberRun({ provider, label: spec.label, ok: true, seconds: Math.round((Date.now() - startedAt) / 1000), at: new Date().toISOString() });
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(provider, `FAILED: ${message}`);
    rememberRun({ provider, label: spec.label, ok: false, seconds: Math.round((Date.now() - startedAt) / 1000), at: new Date().toISOString(), message, limit: error instanceof AiLimitError });
    throw error;
  } finally {
    if (window) window.busy -= 1;
    if (activity.get(provider)?.state !== "connecting") setActivity(provider, null);
    // The window only lives while it works: close it unless another post is waiting for this AI.
    if (window && window.busy === 0 && (pendingAsks.get(provider) || 0) <= 1) await closeWindow(provider);
  }
}

// The Companion's Social SEO view can bring an AI's window forward when it needs the user.
(globalThis as { __AGENTICTHAT_SOCIAL_SEO_CONTROL__?: unknown }).__AGENTICTHAT_SOCIAL_SEO_CONTROL__ = {
  showWindow: (provider: AiProviderId) => showAiWindow(provider),
};

publishActivity();

// Never leave AI windows running after the Companion exits.
process.once("exit", () => {
  for (const window of windows.values()) window.process.kill();
});
