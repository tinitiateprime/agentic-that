import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import type { PublishingAccount } from "../../local-storage.js";
import { publishingBrowserDataDirectory } from "../../runtime-paths.js";
import type {
  DesktopBrowserPurpose,
  DesktopExternalBrowserLayout,
  PublishingDesktopHost,
} from "../../services/desktop-host.js";
import type { PublishingBrowserSession, RestorePublishingSession } from "../types.js";
import {
  externalBrowserTileLayout,
  type ExternalBrowserWorkspaceBounds,
} from "./layout.js";

const accountProfilesDir = path.join(publishingBrowserDataDirectory(), "accounts");
const fallbackWorkspaceBounds: ExternalBrowserWorkspaceBounds = { x: 0, y: 0, width: 1440, height: 900 };
const layoutSettleDelayMs = 120;

type ManagedExternalWindow = {
  activityId?: string;
  purpose: DesktopBrowserPurpose;
  visibleWindow: boolean;
  workspaceBounds: ExternalBrowserWorkspaceBounds;
  applyBounds?: (bounds: ExternalBrowserWorkspaceBounds) => Promise<void>;
  bringToFront?: () => Promise<void>;
  close?: (reason?: string) => Promise<void>;
  updateLayout?: (layout: DesktopExternalBrowserLayout) => Promise<void>;
};

const managedExternalWindows = new Map<symbol, ManagedExternalWindow>();
let externalLayoutQueue: Promise<{ count: number; columns: number; rows: number }> = Promise.resolve({
  count: 0,
  columns: 0,
  rows: 0,
});

type ExternalBrowserEngineOptions = {
  account: PublishingAccount;
  purpose: DesktopBrowserPurpose;
  targetUrl: string;
  desktopHost: PublishingDesktopHost | null;
  restoreSessionState: RestorePublishingSession;
  releaseAccount: () => void;
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

function prepareExternalBrowserProfile(profileDir: string) {
  const preferencesPath = path.join(profileDir, "Default", "Preferences");
  const preferences = readJsonFile(preferencesPath);
  preferences.browser = { ...(preferences.browser ?? {}), has_seen_welcome_page: true };
  preferences.credentials_enable_service = false;
  preferences.profile = { ...(preferences.profile ?? {}), exit_type: "Normal", password_manager_enabled: false };
  preferences.signin = { ...(preferences.signin ?? {}), allowed: false, allowed_on_next_startup: false };
  preferences.sync = { ...(preferences.sync ?? {}), suppress_start: true };
  writeJsonFile(preferencesPath, preferences);
}

function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error("Could not allocate a local browser connection port.")));
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

async function waitForDebugEndpoint(port: number, processHandle: ChildProcess, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const endpoint = `http://127.0.0.1:${port}`;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`The external browser closed before it was ready. Exit code: ${processHandle.exitCode}`);
    }
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return endpoint;
    } catch {
      // The dedicated browser profile is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("The external Chrome, Edge, or Chromium window did not become ready. Close any older window for this account and try again.");
}

function normalizedExternalWorkspace(candidate: ExternalBrowserWorkspaceBounds) {
  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width: Math.max(1, Math.round(candidate.width)),
    height: Math.max(1, Math.round(candidate.height)),
  };
}

function sharedExternalWorkspace(preferred?: ExternalBrowserWorkspaceBounds) {
  const activeWorkspace = [...managedExternalWindows.values()].find(entry => entry.visibleWindow)?.workspaceBounds;
  return normalizedExternalWorkspace(activeWorkspace ?? preferred ?? fallbackWorkspaceBounds);
}

function currentExternalLayout() {
  const entries = [...managedExternalWindows.values()].filter(entry => entry.visibleWindow);
  const workspace = sharedExternalWorkspace(entries[0]?.workspaceBounds);
  return {
    entries,
    tiles: externalBrowserTileLayout(workspace, entries.length),
  };
}

export function arrangeExternalBrowserWindows(workspaceBounds?: ExternalBrowserWorkspaceBounds) {
  if (workspaceBounds) {
    const normalized = normalizedExternalWorkspace(workspaceBounds);
    for (const entry of managedExternalWindows.values()) entry.workspaceBounds = normalized;
  }
  externalLayoutQueue = externalLayoutQueue
    .catch(() => ({ count: 0, columns: 0, rows: 0 }))
    .then(async () => {
      const { entries, tiles } = currentExternalLayout();
      await Promise.all(entries.map(async (entry, index) => {
        const tile = tiles[index];
        if (!tile) return;
        await entry.applyBounds?.(tile.bounds).catch(() => undefined);
        await entry.updateLayout?.(tile).catch(() => undefined);
      }));
      return {
        count: entries.length,
        columns: tiles[0]?.columns ?? 0,
        rows: tiles[0]?.rows ?? 0,
      };
    });
  return externalLayoutQueue;
}

export async function focusExternalBrowserWindow(activityId: string) {
  const entry = [...managedExternalWindows.values()].find(candidate => candidate.activityId === activityId);
  if (!entry?.bringToFront) return false;
  await arrangeExternalBrowserWindows();
  await entry.bringToFront().catch(() => undefined);
  return true;
}

export function externalBrowserProfilePath(account: PublishingAccount) {
  return path.join(accountProfilesDir, account.platform, account.id.replace(/[^a-z0-9-_]/gi, "-"));
}

export function externalBrowserProfilesRoot() {
  return accountProfilesDir;
}

export function externalBrowserExecutableCandidates({
  platform = process.platform,
  environment = process.env,
  homeDirectory = os.homedir(),
}: {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
} = {}) {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const configured = [
    environment.PUBLISH_QUEUE_CHROME_PATH,
    environment.CHROME_PATH,
    environment.GOOGLE_CHROME_PATH,
    environment.MICROSOFT_EDGE_PATH,
    environment.CHROMIUM_PATH,
  ].map(value => value?.trim()).filter(Boolean) as string[];
  const platformCandidates: string[] = [];
  if (platform === "win32") {
    const programDirectories = [
      environment.ProgramFiles,
      environment["ProgramFiles(x86)"],
      environment.LOCALAPPDATA || environment.LocalAppData,
    ].filter(Boolean) as string[];
    for (const directory of programDirectories) {
      platformCandidates.push(
        platformPath.join(directory, "Google", "Chrome", "Application", "chrome.exe"),
        platformPath.join(directory, "Microsoft", "Edge", "Application", "msedge.exe"),
        platformPath.join(directory, "Chromium", "Application", "chrome.exe"),
      );
    }
  } else if (platform === "darwin") {
    for (const applicationsDirectory of ["/Applications", platformPath.join(homeDirectory, "Applications")]) {
      platformCandidates.push(
        platformPath.join(applicationsDirectory, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
        platformPath.join(applicationsDirectory, "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
        platformPath.join(applicationsDirectory, "Chromium.app", "Contents", "MacOS", "Chromium"),
      );
    }
  } else if (platform === "linux") {
    const binaryNames = [
      "google-chrome-stable", "google-chrome", "microsoft-edge-stable", "microsoft-edge",
      "chromium", "chromium-browser",
    ];
    const pathDirectories = String(environment.PATH || "").split(":").filter(Boolean);
    for (const directory of pathDirectories) {
      for (const binaryName of binaryNames) platformCandidates.push(platformPath.join(directory, binaryName));
    }
    platformCandidates.push(
      "/opt/google/chrome/chrome",
      "/opt/microsoft/msedge/msedge",
      "/snap/bin/chromium",
    );
  }
  return [...new Set([...configured, ...platformCandidates])];
}

function executableFile(candidate: string) {
  if (!path.isAbsolute(candidate)) return false;
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    if (process.platform !== "win32") fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function detectedExternalBrowserExecutablePath() {
  return externalBrowserExecutableCandidates().find(executableFile) ?? null;
}

export function externalBrowserExecutablePath() {
  const executablePath = detectedExternalBrowserExecutablePath();
  if (!executablePath) {
    throw new Error("Google Chrome, Microsoft Edge, or Chromium is required for the External browser engine. Install one, restart Companion, and try again.");
  }
  return executablePath;
}

export async function launchExternalBrowserEngine({
  account,
  purpose,
  targetUrl,
  desktopHost,
  restoreSessionState,
  releaseAccount,
}: ExternalBrowserEngineOptions): Promise<PublishingBrowserSession> {
  const profileDir = externalBrowserProfilePath(account);
  fs.mkdirSync(profileDir, { recursive: true });
  prepareExternalBrowserProfile(profileDir);

  const executablePath = externalBrowserExecutablePath();
  const browserName = /edge|msedge/i.test(executablePath)
    ? "Microsoft Edge"
    : /chromium/i.test(executablePath) ? "Chromium" : "Google Chrome";
  const port = await getFreePort();
  const activity = desktopHost
    ? await desktopHost.openExternalActivity({
      accountId: account.id,
      platform: account.platform,
      displayName: account.displayName,
      handle: account.handle,
      purpose,
      engine: "external_browser",
    })
    : null;
  const layoutToken = Symbol(account.id);
  const layoutEntry: ManagedExternalWindow = {
    activityId: activity?.id,
    purpose,
    visibleWindow: purpose === "login",
    workspaceBounds: sharedExternalWorkspace(activity?.workspaceBounds),
    updateLayout: layout => activity
      ? Promise.resolve(desktopHost?.updateBrowser(activity.id, { externalLayout: layout }))
      : Promise.resolve(),
  };
  managedExternalWindows.set(layoutToken, layoutEntry);
  // Let simultaneous account launches reserve their slots before any window
  // appears, so the browsers open directly into the final grid.
  if (layoutEntry.visibleWindow) {
    await new Promise(resolve => setTimeout(resolve, layoutSettleDelayMs));
    await arrangeExternalBrowserWindows();
  }
  const initialLayout = currentExternalLayout();
  const initialIndex = initialLayout.entries.indexOf(layoutEntry);
  const initialBounds = layoutEntry.visibleWindow
    ? initialLayout.tiles[initialIndex]?.bounds ?? layoutEntry.workspaceBounds
    : { x: -10_000, y: -10_000, width: 1280, height: 900 };
  let browserProcess: ChildProcess;
  try {
    browserProcess = spawn(executablePath, [
      `--user-data-dir=${profileDir}`,
      "--profile-directory=Default",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      `--window-position=${initialBounds.x},${initialBounds.y}`,
      `--window-size=${initialBounds.width},${initialBounds.height}`,
      "--new-window",
      targetUrl,
    ], {
      stdio: "ignore",
      windowsHide: false,
    });
  } catch (error) {
    managedExternalWindows.delete(layoutToken);
    await arrangeExternalBrowserWindows().catch(() => undefined);
    if (activity) await Promise.resolve(desktopHost?.closeBrowser(activity.id)).catch(() => undefined);
    releaseAccount();
    throw error;
  }
  let spawnError: Error | null = null;
  browserProcess.once("error", error => { spawnError = error; });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  let previewTimer: NodeJS.Timeout | null = null;
  let previewCaptureRunning = false;
  let closed = false;

  const close = async (reason?: string) => {
    if (closed) return;
    closed = true;
    if (reason && activity) {
      await Promise.resolve(desktopHost?.updateBrowser(activity.id, { state: "stopped", detail: reason })).catch(() => undefined);
    }
    if (previewTimer) clearInterval(previewTimer);
    previewTimer = null;
    try {
      await Promise.race([
        browser?.close().catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, 1500)),
      ]);
      const exited = await waitForProcessExit(browserProcess, 3000);
      if (!exited && browserProcess.exitCode === null && !browserProcess.killed) {
        browserProcess.kill();
        await waitForProcessExit(browserProcess, 2000);
      }
      if (activity) await Promise.resolve(desktopHost?.closeBrowser(activity.id)).catch(() => undefined);
    } finally {
      managedExternalWindows.delete(layoutToken);
      await arrangeExternalBrowserWindows().catch(() => undefined);
      releaseAccount();
    }
  };
  layoutEntry.close = close;

  try {
    await new Promise(resolve => setTimeout(resolve, 150));
    if (spawnError) throw spawnError;
    const debugEndpoint = await waitForDebugEndpoint(port, browserProcess);
    browser = await chromium.connectOverCDP(debugEndpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error(`${browserName} did not create the dedicated account profile.`);
    await restoreSessionState(context);
    const targetHost = targetUrl.startsWith("http") ? new URL(targetUrl).hostname : "";
    const page = context.pages().find(candidate => targetHost && candidate.url().includes(targetHost))
      ?? context.pages()[0]
      ?? await context.newPage();
    const cdpSession = await context.newCDPSession(page);
    const browserWindow = await cdpSession.send("Browser.getWindowForTarget") as { windowId?: number };
    if (typeof browserWindow.windowId === "number" && layoutEntry.visibleWindow) {
      const windowId = browserWindow.windowId;
      layoutEntry.applyBounds = async bounds => {
        await cdpSession.send("Browser.setWindowBounds", {
          windowId,
          bounds: { windowState: "normal" },
        });
        await cdpSession.send("Browser.setWindowBounds", {
          windowId,
          bounds: {
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
        });
      };
    } else if (typeof browserWindow.windowId === "number") {
      await cdpSession.send("Browser.setWindowBounds", {
        windowId: browserWindow.windowId,
        bounds: { windowState: "normal" },
      }).catch(() => undefined);
      await cdpSession.send("Browser.setWindowBounds", {
        windowId: browserWindow.windowId,
        bounds: { left: -10_000, top: -10_000, width: 1280, height: 900 },
      }).catch(() => undefined);
    }
    if (layoutEntry.visibleWindow) layoutEntry.bringToFront = () => page.bringToFront();
    browser.on("disconnected", () => {
      if (!closed) void close();
    });
    if (layoutEntry.visibleWindow) {
      await arrangeExternalBrowserWindows();
      await page.bringToFront().catch(() => undefined);
    } else if (activity) {
      const capturePreview = async () => {
        if (previewCaptureRunning || page.isClosed()) return;
        previewCaptureRunning = true;
        try {
          const screenshot = await page.screenshot({ type: "jpeg", quality: 65, timeout: 8000 });
          await Promise.resolve(desktopHost?.updateBrowser(activity.id, {
            previewFrame: `data:image/jpeg;base64,${screenshot.toString("base64")}`,
          }));
        } catch {
          // A navigation can replace the frame while the screenshot is taken.
        } finally {
          previewCaptureRunning = false;
        }
      };
      previewTimer = setInterval(() => { void capturePreview(); }, 1500);
      previewTimer.unref();
      void capturePreview();
    }
    return {
      engine: "external_browser",
      context,
      page,
      desktopSessionId: activity?.id,
      update: next => activity
        ? Promise.resolve(desktopHost?.updateBrowser(activity.id, next))
        : Promise.resolve(),
      close: () => close(),
    };
  } catch (error) {
    if (activity) {
      await Promise.resolve(desktopHost?.updateBrowser(activity.id, {
        state: "failed",
        detail: `The ${browserName} window could not start. Close older windows for this account and try again.`,
      })).catch(() => undefined);
    }
    await close();
    throw error;
  }
}

export async function stopExternalPublishingBrowsers(reason: string) {
  const sessions = [...managedExternalWindows.values()]
    .filter(entry => entry.purpose === "publish" && entry.close)
    .map(entry => entry.close!(reason));
  await Promise.all(sessions);
}

export async function stopAllExternalBrowserWindows(reason: string) {
  const sessions = [...managedExternalWindows.values()]
    .filter(entry => entry.close)
    .map(entry => entry.close!(reason));
  await Promise.all(sessions);
}
