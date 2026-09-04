import {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  WebContentsView,
} from "electron";
import started from "electron-squirrel-startup";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  desktopPlatformDetails,
  linuxAutostartDesktopEntry,
  linuxAutostartFilePath,
} from "./platform-support.js";

const DESKTOP_PLATFORM = desktopPlatformDetails();
if (process.platform === "win32") {
  app.setAppUserModelId("com.squirrel.agenticthat_publishing_companion.agenticthat_publishing_companion");
}

function configuredDashboardUrl() {
  const fallback = "https://agentic-that.netlify.app/publishing";
  const configured = process.env.AGENTICTHAT_DASHBOARD_URL?.trim();
  if (!configured) return fallback;
  try {
    const url = new URL(configured);
    const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

const DASHBOARD_URL = configuredDashboardUrl();
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
const PUBLISHING_CONNECTIONS_URL = `${DASHBOARD_ORIGIN}/config-manager?service=publishing`;
const SERVICE_TOKEN_PUBLIC_KEY_URL = process.env.AGENTICTHAT_SERVICE_TOKEN_PUBLIC_KEY_URL?.trim()
  || `${DASHBOARD_ORIGIN}/api/platform-auth/service-token-public-key`;
// Companion is a focused worker and local session manager. The SaaS workspace
// opens in the normal browser; embedding remains an opt-in diagnostic.
const EMBED_FULL_PUBLISHING_WORKSPACE = process.env.AGENTICTHAT_COMPANION_EMBED_DASHBOARD === "1";
const CHROME_DOWNLOAD_URL = "https://www.google.com/chrome/";
const configuredServicePort = Number(process.env.AGENTICTHAT_COMPANION_SERVICE_PORT || 8792);
const SERVICE_PORT = Number.isInteger(configuredServicePort) && configuredServicePort > 0 && configuredServicePort < 65536
  ? configuredServicePort
  : 8792;
// The desktop API is deliberately loopback-only. Workspace sharing uses the
// outbound paired-token connection, never an exposed local port or tunnel.
const SERVICE_HOST = "127.0.0.1";
const SERVICE_ORIGIN = `http://127.0.0.1:${SERVICE_PORT}`;
const configuredDesktopDebugPort = Number(process.env.AGENTICTHAT_DESKTOP_DEBUG_PORT || 0);
const REQUESTED_DESKTOP_DEBUG_PORT = Number.isInteger(configuredDesktopDebugPort) && configuredDesktopDebugPort > 0
  ? configuredDesktopDebugPort
  : 0;
const MAX_ACTIVITY_HISTORY = 20;
const LEGACY_PRODUCT_NAME = "AgenticThat Publishing Companion";
const LEGACY_WINDOWS_AUTOSTART_NAMES = [
  "electron.app.AgenticThat Publishing Companion",
  "electron.app.AgenticThat Companion",
];

const userDataOverride = process.env.AGENTICTHAT_COMPANION_DATA_DIR?.trim();
if (userDataOverride) {
  const resolvedUserData = path.resolve(userDataOverride);
  fs.mkdirSync(resolvedUserData, { recursive: true });
  app.setPath("userData", resolvedUserData);
}

const ownsSingleInstanceLock = !started && app.requestSingleInstanceLock();

if (ownsSingleInstanceLock) {
  if (REQUESTED_DESKTOP_DEBUG_PORT === 0) {
    fs.rmSync(path.join(app.getPath("userData"), "DevToolsActivePort"), { force: true });
  }
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", String(REQUESTED_DESKTOP_DEBUG_PORT));
  app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling");
}

const APP_VERSION = app.getVersion();
const managedBrowsers = new Map();
const instagramScrapingBrowsers = new Map();
const facebookScrapingBrowsers = new Map();

let mainWindow = null;
let dashboardView = null;
let tray = null;
let publishingServer = null;
let publishingRuntime = null;
let quitting = false;
let settings = null;
let logPath = "";
let dashboardBounds = null;
let browserBounds = new Map();
let browserZoomFactors = new Map();
let publishingPermissionPromise = null;
let publishingRunPermissionActive = false;
let resolvedDesktopDebugPort = REQUESTED_DESKTOP_DEBUG_PORT || null;
let unsubscribeScrapingActivities = [];
let scrapingWorkActive = false;
let rebuildTrayMenu = null;
let serviceWatchdogTimer = null;
let serviceRestartPromise = null;
let consecutiveHealthFailures = 0;
let runtimeState = "starting";
let runtimeError = null;
let updateStatus = "unsupported";
let updatePromptTimer = null;
let updatePromptPending = false;
let scrapingActivityState = {
  activeJob: null,
  queuedJobs: [],
  recentJobs: [],
  concurrency: 1,
  updatedAt: new Date().toISOString(),
};
const scrapingActivityByPlatform = {
  Instagram: { ...scrapingActivityState },
  Facebook: { ...scrapingActivityState },
};

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function secureStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

function encryptedValue(value) {
  if (secureStorageAvailable()) {
    return { protected: true, value: safeStorage.encryptString(value).toString("base64") };
  }
  return { protected: false, value: Buffer.from(value, "utf8").toString("base64") };
}

function decryptedValue(record) {
  const buffer = Buffer.from(record.value, "base64");
  return record.protected ? safeStorage.decryptString(buffer) : buffer.toString("utf8");
}

function settingsFilePath() {
  return path.join(app.getPath("userData"), "companion-settings.json");
}

function atomicWriteFileSync(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "w", 0o600);
  try {
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function persistedSettings(value = settings) {
  return {
    version: value.version,
    username: value.username,
    password: value.password,
    authSecret: value.authSecret,
    sessionEncryptionKey: value.sessionEncryptionKey,
    instanceId: value.instanceId,
    autoStart: value.autoStart,
    publishingInteractionConsent: Boolean(value.publishingInteractionConsent),
    createdAt: value.createdAt,
  };
}

function writeSettings() {
  const settingsPath = settingsFilePath();
  try {
    if (fs.existsSync(settingsPath)) {
      const current = fs.readFileSync(settingsPath, "utf8");
      JSON.parse(current);
      atomicWriteFileSync(`${settingsPath}.backup`, current);
    }
  } catch {}
  atomicWriteFileSync(settingsPath, `${JSON.stringify(persistedSettings(), null, 2)}\n`);
}

function loadSettings() {
  const settingsPath = settingsFilePath();
  for (const candidate of [settingsPath, `${settingsPath}.backup`]) { try {
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
    if (parsed.version === 1 && parsed.password?.value && parsed.authSecret?.value) {
      const instanceId = parsed.instanceId || randomSecret(18);
      const passwordPlain = decryptedValue(parsed.password);
      const authSecretPlain = decryptedValue(parsed.authSecret);
      const savedSessionKey = parsed.sessionEncryptionKey?.value;
      const sessionEncryptionKeyPlain = savedSessionKey
        ? decryptedValue(parsed.sessionEncryptionKey)
        : secureStorageAvailable() ? randomSecret(32) : undefined;
      const secretsNeedProtection = secureStorageAvailable()
        && (parsed.password.protected !== true || parsed.authSecret.protected !== true || parsed.sessionEncryptionKey?.protected !== true);
      const normalized = {
        ...parsed,
        instanceId,
        password: secretsNeedProtection ? encryptedValue(passwordPlain) : parsed.password,
        authSecret: secretsNeedProtection ? encryptedValue(authSecretPlain) : parsed.authSecret,
        sessionEncryptionKey: sessionEncryptionKeyPlain
          ? parsed.sessionEncryptionKey?.protected === true ? parsed.sessionEncryptionKey : encryptedValue(sessionEncryptionKeyPlain)
          : undefined,
        publishingInteractionConsent: parsed.publishingInteractionConsent === true,
      };
      if (!parsed.instanceId || !savedSessionKey || secretsNeedProtection || parsed.publishingInteractionConsent === undefined) {
        atomicWriteFileSync(settingsPath, `${JSON.stringify(persistedSettings(normalized), null, 2)}\n`);
      } else if (candidate !== settingsPath) {
        atomicWriteFileSync(settingsPath, `${JSON.stringify(persistedSettings(normalized), null, 2)}\n`);
      }
      return {
        ...normalized,
        passwordPlain,
        authSecretPlain,
        sessionEncryptionKeyPlain,
      };
    }
  } catch {
    // Create a recoverable local configuration below.
  }
  }

  const passwordPlain = `${randomSecret(9)}!Aa7`;
  const authSecretPlain = randomSecret(48);
  const sessionEncryptionKeyPlain = secureStorageAvailable() ? randomSecret(32) : undefined;
  const created = {
    version: 1,
    username: "operations.manager",
    password: encryptedValue(passwordPlain),
    authSecret: encryptedValue(authSecretPlain),
    sessionEncryptionKey: sessionEncryptionKeyPlain ? encryptedValue(sessionEncryptionKeyPlain) : undefined,
    instanceId: randomSecret(18),
    autoStart: true,
    publishingInteractionConsent: false,
    createdAt: new Date().toISOString(),
  };
  atomicWriteFileSync(settingsPath, `${JSON.stringify(persistedSettings(created), null, 2)}\n`);
  return { ...created, passwordPlain, authSecretPlain, sessionEncryptionKeyPlain };
}

function configureRuntimeEnvironment() {
  const userDataDirectory = app.getPath("userData");
  const runtimeDataDirectory = path.join(userDataDirectory, "publishing-data");
  const dataDirectory = path.join(runtimeDataDirectory, "data");
  const uploadDirectory = path.join(runtimeDataDirectory, "uploads");
  const browserDataDirectory = path.join(runtimeDataDirectory, "browser-data");
  const logDirectory = path.join(runtimeDataDirectory, "logs");
  for (const directory of [dataDirectory, uploadDirectory, browserDataDirectory, logDirectory]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  logPath = path.join(logDirectory, "publishing-companion.log");
  if (fs.existsSync(logPath) && fs.statSync(logPath).size > 5 * 1024 * 1024) {
    fs.renameSync(logPath, `${logPath}.previous`);
  }

  process.env.NODE_ENV = "production";
  process.env.PUBLISH_QUEUE_SERVICE_HOST = SERVICE_HOST;
  process.env.PUBLISH_QUEUE_SERVICE_PORT = String(SERVICE_PORT);
  process.env.PUBLISH_QUEUE_WEB_ORIGIN = DASHBOARD_ORIGIN;
  process.env.PUBLISH_QUEUE_DATA_PATH = path.join(dataDirectory, "store.json");
  process.env.PUBLISH_QUEUE_UPLOAD_DIR = uploadDirectory;
  process.env.PUBLISH_QUEUE_BROWSER_DATA_DIR = browserDataDirectory;
  const legacyUserDataDirectory = legacyCompanionUserDataDirectory();
  if (legacyUserDataDirectory) {
    process.env.PUBLISH_QUEUE_LEGACY_DATA_PATH = path.join(
      legacyUserDataDirectory,
      "publishing-data",
      "data",
      "store.json",
    );
  }
  process.env.PUBLISH_QUEUE_LOCAL_AUTH_SECRET_PATH = path.join(dataDirectory, ".auth-token-secret");
  process.env.PUBLISH_QUEUE_AUTH_TOKEN_SECRET = settings.authSecretPlain;
  if (settings.sessionEncryptionKeyPlain) {
    process.env.PUBLISH_QUEUE_SESSION_ENCRYPTION_KEY = settings.sessionEncryptionKeyPlain;
  }
  // Keep this in sync with publishingCompanionId() in the embedded runtime.
  // The watchdog compares the health response with this exact local identity;
  // using a different variable name makes it mistake its own server for a
  // second Companion process.
  process.env.PUBLISHING_COMPANION_ID = settings.instanceId;
  process.env.PUBLISH_QUEUE_OPERATIONS_MANAGER_USERNAME = settings.username;
  process.env.PUBLISH_QUEUE_OPERATIONS_MANAGER_PASSWORD = settings.passwordPlain;
  process.env.PUBLISH_QUEUE_INTERRUPTED_POST_RECOVERY = "retry";
  process.env.AGENTICTHAT_COMPANION_UPDATE_STATUS = updateStatus;
}

function legacyCompanionUserDataDirectory() {
  if (!app.isPackaged || userDataOverride) return null;
  const currentDirectory = path.resolve(app.getPath("userData"));
  const legacyDirectory = path.resolve(app.getPath("appData"), LEGACY_PRODUCT_NAME);
  return legacyDirectory !== currentDirectory && fs.existsSync(legacyDirectory)
    ? legacyDirectory
    : null;
}

function migrateLegacyAccountBrowserData(accountId, platform) {
  const legacyDirectory = legacyCompanionUserDataDirectory();
  if (!legacyDirectory) return 0;
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(accountId) || !["instagram", "facebook", "x", "linkedin", "youtube"].includes(platform)) {
    throw new Error("The legacy account session path is invalid.");
  }
  const currentDirectory = app.getPath("userData");
  const partitionName = browserPartition(accountId).replace(/^persist:/, "");
  const candidates = [
    {
      source: path.join(legacyDirectory, "Partitions", partitionName),
      target: path.join(currentDirectory, "Partitions", partitionName),
    },
    {
      source: path.join(legacyDirectory, "publishing-data", "browser-data", "accounts", platform, accountId),
      target: path.join(currentDirectory, "publishing-data", "browser-data", "accounts", platform, accountId),
    },
  ];
  let copied = 0;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.source) || fs.existsSync(candidate.target)) continue;
    fs.mkdirSync(path.dirname(candidate.target), { recursive: true });
    fs.cpSync(candidate.source, candidate.target, { recursive: true, force: false, errorOnExist: false });
    copied += 1;
  }
  return copied;
}

async function configureServiceTokenVerifier() {
  if (process.env.SERVICE_TOKEN_PUBLIC_KEY?.trim()) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(SERVICE_TOKEN_PUBLIC_KEY_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Public key request returned ${response.status}.`);
    const payload = await response.json();
    const publicKey = String(payload?.publicKey || "").trim();
    if (!publicKey.includes("BEGIN PUBLIC KEY")) throw new Error("Public key response is invalid.");
    process.env.SERVICE_TOKEN_PUBLIC_KEY = publicKey;
    if (payload.keyId) process.env.SERVICE_TOKEN_KEY_ID = String(payload.keyId).trim();
    if (payload.issuer) process.env.SERVICE_TOKEN_ISSUER = String(payload.issuer).trim();
    console.log("AgenticThat workspace token verification is configured.");
  } finally {
    clearTimeout(timeout);
  }
}

function installFileLogging() {
  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  for (const level of Object.keys(originalConsole)) {
    console[level] = (...values) => {
      originalConsole[level](...values);
      const message = values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ");
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`, "utf8");
      mainWindow?.webContents.send("companion:log", {
        level,
        message,
        createdAt: new Date().toISOString(),
      });
    };
  }
}

function setRuntimeState(state, error = null) {
  runtimeState = state;
  runtimeError = error;
  process.env.AGENTICTHAT_COMPANION_RUNTIME_ERROR = error || "";
  mainWindow?.webContents.send("companion:status-changed");
}

function setUpdateStatus(state) {
  updateStatus = state;
  process.env.AGENTICTHAT_COMPANION_UPDATE_STATUS = state;
  mainWindow?.webContents.send("companion:status-changed");
}

function squirrelInstalledBuild() {
  if (!app.isPackaged || process.platform !== "win32" || process.windowsStore) return false;
  const executableDirectory = path.dirname(process.execPath);
  return /^app-/i.test(path.basename(executableDirectory))
    && fs.existsSync(path.resolve(executableDirectory, "..", "Update.exe"));
}

function automaticUpdateBuild() {
  if (!app.isPackaged) return false;
  if (process.platform === "win32") return squirrelInstalledBuild();
  return process.platform === "darwin";
}

function configureAutoUpdates() {
  if (!automaticUpdateBuild() || process.env.AGENTICTHAT_COMPANION_DISABLE_AUTO_UPDATE === "1") {
    setUpdateStatus("unsupported");
    console.log(process.platform === "linux"
      ? "Companion updates are managed by the installed Linux package or a newly downloaded archive."
      : "Automatic updates are available in a signed installed Companion; this build will not self-update.");
    return;
  }
  autoUpdater.on("checking-for-update", () => setUpdateStatus("checking"));
  autoUpdater.on("update-available", () => setUpdateStatus("downloading"));
  autoUpdater.on("update-not-available", () => setUpdateStatus("idle"));
  autoUpdater.on("update-downloaded", () => setUpdateStatus("downloaded"));
  autoUpdater.on("error", error => {
    setUpdateStatus("error");
    console.warn("Companion update check failed:", error instanceof Error ? error.message : error);
  });
  try {
    setUpdateStatus("idle");
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: "tinitiateprime/agentic-that",
      },
      updateInterval: "10 minutes",
      notifyUser: true,
      onNotifyUser: () => scheduleSafeUpdatePrompt(),
      logger: console,
    });
    console.log("Automatic Companion updates are enabled.");
  } catch (error) {
    setUpdateStatus("error");
    console.warn("Could not enable Companion updates:", error instanceof Error ? error.message : error);
  }
}

function scheduleSafeUpdatePrompt() {
  if (updatePromptPending || quitting) return;
  updatePromptPending = true;
  const attemptPrompt = async () => {
    const activity = publishingRuntime?.companionRuntimeActivity?.();
    if (activity?.publishing || activity?.scraping) {
      console.log("Companion update is ready and will ask to restart after active work finishes.");
      updatePromptTimer = setTimeout(() => void attemptPrompt(), 10_000);
      return;
    }
    updatePromptTimer = null;
    const options = {
      type: "info",
      title: "AgenticThat Companion update ready",
      message: "A new Companion version is ready to install.",
      detail: "Restart now to apply the update. No publishing or scraping work is active.",
      buttons: ["Restart and update", "Later"],
      defaultId: 0,
      cancelId: 1,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    updatePromptPending = false;
    if (result.response === 0) {
      setUpdateStatus("applying");
      quitting = true;
      autoUpdater.quitAndInstall();
    }
  };
  void attemptPrompt();
}

async function startPublishingService() {
  setRuntimeState("starting");
  process.env.AGENTICTHAT_COMPANION_VERSION = APP_VERSION;
  const runtimeEntry = path.join(app.getAppPath(), "runtime", "server.mjs");
  publishingRuntime ??= await import(
    `${pathToFileURL(runtimeEntry).href}?v=${createHash("sha1").update(APP_VERSION).digest("hex")}`
  );
  if (typeof publishingRuntime.subscribeInstagramCompanionActivity === "function") {
    unsubscribeScrapingActivities.push(
      publishingRuntime.subscribeInstagramCompanionActivity(state => handleScrapingActivity("Instagram", state))
    );
  }
  if (typeof publishingRuntime.subscribeFacebookCompanionActivity === "function") {
    unsubscribeScrapingActivities.push(
      publishingRuntime.subscribeFacebookCompanionActivity(state => handleScrapingActivity("Facebook", state))
    );
  }
  publishingServer = publishingRuntime.createPublishingHttpServer({
    host: "127.0.0.1",
    port: SERVICE_PORT,
    startBackgroundServices: true,
  });
  await new Promise((resolve, reject) => {
    if (publishingServer.listening) return resolve();
    publishingServer.once("listening", resolve);
    publishingServer.once("error", reject);
  });
  const activeServer = publishingServer;
  activeServer.on("error", error => {
    if (publishingServer === activeServer) setRuntimeState("error", error instanceof Error ? error.message : String(error));
  });
  activeServer.on("close", () => {
    if (!quitting && publishingServer === activeServer) {
      publishingServer = null;
      setRuntimeState("error", "The local Companion service stopped unexpectedly.");
    }
  });
  setRuntimeState("ready");
}

async function closePublishingServer() {
  if (!publishingServer) return;
  const server = publishingServer;
  publishingServer = null;
  await Promise.race([
    new Promise(resolve => server.close(() => resolve())),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
}

async function restartPublishingService(reason) {
  if (serviceRestartPromise) return serviceRestartPromise;
  const activity = publishingRuntime?.companionRuntimeActivity?.();
  if (activity?.publishing || activity?.scraping) {
    console.warn(`Companion watchdog postponed a service restart while local work is active: ${reason}`);
    return;
  }
  serviceRestartPromise = (async () => {
    setRuntimeState("starting", reason);
    console.warn(`Companion watchdog is restarting the local service: ${reason}`);
    publishingRuntime?.stopPublishingBackgroundServices?.();
    for (const unsubscribe of unsubscribeScrapingActivities) unsubscribe?.();
    unsubscribeScrapingActivities = [];
    await closePublishingServer();
    try {
      await configureServiceTokenVerifier();
      await desktopDebugEndpoint();
      await startPublishingService();
      consecutiveHealthFailures = 0;
      console.log("Companion local service recovered successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeState("error", message);
      console.error("Companion local service restart failed:", message);
    }
  })().finally(() => { serviceRestartPromise = null; });
  return serviceRestartPromise;
}

function startServiceWatchdog() {
  if (serviceWatchdogTimer) return;
  serviceWatchdogTimer = setInterval(async () => {
    const status = await serviceStatus();
    if (status.connected) {
      consecutiveHealthFailures = 0;
      if (runtimeState !== "ready") setRuntimeState("ready");
      return;
    }
    consecutiveHealthFailures += 1;
    if (consecutiveHealthFailures >= 3) {
      await restartPublishingService(status.error || "Three consecutive health checks failed.");
    }
  }, 15_000);
}

async function serviceStatus() {
  try {
    const response = await fetch(`${SERVICE_ORIGIN}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`Health check returned ${response.status}`);
    const health = await response.json();
    if (health.companionInstanceId !== settings.instanceId) {
      throw new Error("Another publishing service is using port 8792. Close it, then restart this app.");
    }
    return {
      connected: true,
      ...health,
      version: APP_VERSION,
      username: settings.username,
      autoStart: settings.autoStart,
      publishingInteractionConsent: settings.publishingInteractionConsent,
      dataDirectory: path.join(app.getPath("userData"), "publishing-data"),
      secureLocalStorage: secureStorageAvailable(),
      runtimeState,
      runtimeError,
      updateStatus,
      platform: process.platform,
      architecture: process.arch,
      operatingSystemName: DESKTOP_PLATFORM.name,
      autoStartLabel: DESKTOP_PLATFORM.autoStartLabel,
      updateMode: DESKTOP_PLATFORM.updateMode,
    };
  } catch (error) {
    return {
      connected: false,
      automationReady: false,
      embeddedBrowser: true,
      chromeInstalled: false,
      version: APP_VERSION,
      username: settings.username,
      autoStart: settings.autoStart,
      publishingInteractionConsent: settings.publishingInteractionConsent,
      error: error instanceof Error ? error.message : "The publishing service is unavailable.",
      secureLocalStorage: secureStorageAvailable(),
      runtimeState,
      runtimeError,
      updateStatus,
      platform: process.platform,
      architecture: process.arch,
      operatingSystemName: DESKTOP_PLATFORM.name,
      autoStartLabel: DESKTOP_PLATFORM.autoStartLabel,
      updateMode: DESKTOP_PLATFORM.updateMode,
    };
  }
}

function applicationIconPath() {
  return path.join(app.getAppPath(), "assets", process.platform === "win32" ? "app-icon.ico" : "app-icon-1024.png");
}

function applyLinuxAutoStart(enabled) {
  const autoStartPath = linuxAutostartFilePath({
    xdgConfigHome: process.env.XDG_CONFIG_HOME,
    homeDirectory: app.getPath("home"),
  });
  if (!enabled) {
    fs.rmSync(autoStartPath, { force: true });
    return;
  }
  atomicWriteFileSync(autoStartPath, linuxAutostartDesktopEntry({
    executablePath: process.execPath,
    iconPath: applicationIconPath(),
  }));
}

function saveAutoStart(enabled) {
  if (app.isPackaged && process.env.AGENTICTHAT_COMPANION_DISABLE_AUTOSTART !== "1") {
    if (process.platform === "linux") {
      applyLinuxAutoStart(enabled);
    } else if (process.platform === "darwin") {
      app.setLoginItemSettings({ openAtLogin: enabled, type: "mainAppService" });
    } else if (process.platform === "win32") {
      for (const legacyName of LEGACY_WINDOWS_AUTOSTART_NAMES) {
        try {
          execFileSync("reg.exe", [
            "delete",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            "/v",
            legacyName,
            "/f",
          ], { stdio: "ignore", windowsHide: true });
        } catch {
          // The legacy launch entry is normally absent after the first repair.
        }
      }
      const installedLauncher = squirrelInstalledBuild()
        ? path.resolve(path.dirname(process.execPath), "..", path.basename(process.execPath))
        : process.execPath;
      app.setLoginItemSettings({
        openAtLogin: enabled,
        enabled,
        path: installedLauncher,
        args: ["--hidden"],
      });
    }
  }
  settings.autoStart = enabled;
  writeSettings();
  return settings.autoStart;
}

function safeBounds(value) {
  if (!value || typeof value !== "object") return null;
  const x = Math.max(0, Math.round(Number(value.x)));
  const y = Math.max(0, Math.round(Number(value.y)));
  const width = Math.max(0, Math.round(Number(value.width)));
  const height = Math.max(0, Math.round(Number(value.height)));
  if (![x, y, width, height].every(Number.isFinite) || width < 40 || height < 40) return null;
  return { x, y, width, height };
}

function safeZoomFactor(value) {
  const zoomFactor = Number(value);
  if (!Number.isFinite(zoomFactor)) return 1;
  return Math.min(1, Math.max(0.4, zoomFactor));
}

function setViewBounds(view, bounds) {
  if (!view || view.webContents.isDestroyed()) return;
  if (!bounds) {
    view.setVisible(false);
    return;
  }
  view.setBounds(bounds);
  view.setVisible(true);
}

function applyWorkspaceLayout() {
  setViewBounds(dashboardView, dashboardBounds);
  for (const session of managedBrowsers.values()) {
    const bounds = browserBounds.get(session.id) ?? null;
    if (session.view && !session.view.webContents.isDestroyed()) {
      session.view.webContents.setZoomFactor(browserZoomFactors.get(session.id) ?? 1);
    }
    setViewBounds(session.view, bounds);
  }
}

function publicBrowserSession(session) {
  return {
    id: session.id,
    accountId: session.request.accountId,
    platform: session.request.platform,
    displayName: session.request.displayName,
    handle: session.request.handle,
    purpose: session.request.purpose,
    engine: session.request.engine || "companion",
    activity: session.activity,
    active: !session.closedAt,
    openedAt: session.openedAt,
    closedAt: session.closedAt ?? null,
  };
}

function workspaceState() {
  return {
    sessions: [...managedBrowsers.values()]
      .sort((left, right) => right.openedAt.localeCompare(left.openedAt))
      .slice(0, MAX_ACTIVITY_HISTORY)
      .map(publicBrowserSession),
  };
}

function scrapingActivity() {
  return scrapingActivityState;
}

function scrapingWorkCount(state = scrapingActivityState) {
  const active = state.activeJob && ["queued", "running"].includes(state.activeJob.status) ? 1 : 0;
  return active + (Array.isArray(state.queuedJobs) ? state.queuedJobs.length : 0);
}

function showScrapingNotification(title, body) {
  if (process.env.AGENTICTHAT_COMPANION_DISABLE_NOTIFICATIONS === "1" || !Notification.isSupported()) return;
  const notification = new Notification({ title, body, silent: true });
  notification.on("click", () => showCompanion("scraping"));
  notification.show();
}

function platformActivityJob(platform, job) {
  return job ? { ...job, platform } : null;
}

function mergedScrapingActivity() {
  const states = Object.entries(scrapingActivityByPlatform);
  const activeJobs = states
    .map(([platform, state]) => platformActivityJob(platform, state.activeJob))
    .filter(Boolean)
    .sort((left, right) => String(left.startedAt || left.createdAt).localeCompare(String(right.startedAt || right.createdAt)));
  const queuedJobs = states.flatMap(([platform, state]) => (state.queuedJobs || []).map(job => platformActivityJob(platform, job)));
  const recentJobs = states
    .flatMap(([platform, state]) => (state.recentJobs || []).map(job => platformActivityJob(platform, job)))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, 16);
  return {
    activeJob: activeJobs[0] || null,
    queuedJobs: [...activeJobs.slice(1), ...queuedJobs],
    recentJobs,
    concurrency: 2,
    updatedAt: new Date().toISOString(),
  };
}

function handleScrapingActivity(platform, state) {
  const previousWorkActive = scrapingWorkActive;
  if (state && typeof state === "object") scrapingActivityByPlatform[platform] = state;
  scrapingActivityState = mergedScrapingActivity();
  const workCount = scrapingWorkCount(scrapingActivityState);
  scrapingWorkActive = workCount > 0;

  if (!previousWorkActive && scrapingWorkActive) {
    const job = scrapingActivityState.activeJob || scrapingActivityState.queuedJobs?.[0];
    const jobPlatform = job?.platform || platform;
    const query = job?.query || `${jobPlatform} request`;
    showScrapingNotification(
      `${jobPlatform} scraping started`,
      `${query} is running privately. Open Companion to follow progress.`,
    );
    const publishingIsVisible = [...managedBrowsers.values()].some(session => !session.closedAt);
    if (mainWindow?.isVisible() && !publishingIsVisible) {
      mainWindow.webContents.send("companion:navigate", "scraping");
    }
  } else if (previousWorkActive && !scrapingWorkActive) {
    const latest = scrapingActivityState.recentJobs?.[0];
    const latestPlatform = latest?.platform || platform;
    if (latest?.status === "complete") {
      showScrapingNotification(
        `${latestPlatform} scraping complete`,
        `${latest.query}: ${latest.resultCount ?? 0} live ${latest.resultCount === 1 ? "result" : "results"} ready.`,
      );
    } else if (latest?.status === "failed") {
      showScrapingNotification(
        `${latestPlatform} scraping needs attention`,
        `${latest.query}: ${latest.error?.message || "The scrape did not complete."}`,
      );
    }
  }

  if (tray) {
    const active = scrapingActivityState.activeJob;
    tray.setToolTip(active && scrapingWorkActive
      ? `AgenticThat Companion - Scraping ${active.query}`
      : "AgenticThat Companion");
  }
  rebuildTrayMenu?.();
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("companion:scraping-state", scrapingActivityState);
  }
}

function notifyWorkspaceState({ revealActivity = false } = {}) {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("companion:workspace-state", workspaceState());
  if (revealActivity) mainWindow.webContents.send("companion:navigate", "activity");
}

function showCompanion(section = "activity", focus = true) {
  if (!mainWindow) return;
  const visibleSection = section === "dashboard" && !EMBED_FULL_PUBLISHING_WORKSPACE
    ? "activity"
    : section;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (
    visibleSection === "activity"
    && [...managedBrowsers.values()].some(session => session.view)
    && !mainWindow.isMaximized()
  ) {
    mainWindow.maximize();
  }
  mainWindow.show();
  if (focus) mainWindow.focus();
  mainWindow.webContents.send("companion:navigate", visibleSection);
}

function chromiumUserAgent(webContents) {
  return webContents
    .getUserAgent()
    .replace(/\sElectron\/[^\s]+/i, "")
    // Packaged Electron removes spaces from productName in its UA token.
    // Facebook returns an empty, non-hydrated document when that custom token
    // remains, so cover both development and packaged spellings.
    .replace(/\sAgenticThat(?:\s*Publishing)?\s*Companion\/[^\s]+/i, "");
}

function createDashboardView() {
  dashboardView = new WebContentsView({
    webPreferences: {
      partition: "persist:agenticthat-dashboard",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(app.getAppPath(), "dashboard-preload.cjs"),
    },
  });
  dashboardView.setBackgroundColor("#f4f8f6");
  const dashboardUserAgent = chromiumUserAgent(dashboardView.webContents);
  dashboardView.webContents.setUserAgent(dashboardUserAgent);
  dashboardView.webContents.session.setUserAgent(dashboardUserAgent, "en-US,en;q=0.9");
  dashboardView.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.origin === DASHBOARD_ORIGIN) {
        void dashboardView.webContents.loadURL(url);
      } else {
        void shell.openExternal(url);
      }
    } catch {
      // Ignore invalid popup URLs.
    }
    return { action: "deny" };
  });
  dashboardView.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin === DASHBOARD_ORIGIN) return;
    } catch {
      // Block malformed navigation below.
    }
    event.preventDefault();
    if (url.startsWith("https://")) void shell.openExternal(url);
  });
  mainWindow.contentView.addChildView(dashboardView);
  dashboardView.setVisible(false);
  void dashboardView.webContents.loadURL(DASHBOARD_URL);
}

async function requestPersistentPublishingInteractionConsent() {
  if (settings.publishingInteractionConsent) return;
  if (publishingPermissionPromise) return publishingPermissionPromise;

  showCompanion("activity");
  publishingPermissionPromise = dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Workspace publishing permission",
    message: "Allow approved publishing jobs on this Companion?",
    detail: [
      "Companion will use each account's selected engine and complete the publishing steps in visible social-media tabs or external browser windows.",
      "Every publishing browser remains visible, and Emergency stop is always available in Companion and its tray menu.",
      "This permission is saved for future publish-now jobs from the paired workspace and can be revoked at any time in Companion Settings.",
    ].join("\n\n"),
    buttons: ["Allow", "Deny"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }).then(result => {
    if (result.response !== 0) {
      throw new Error("Publishing was cancelled because workspace publishing permission was denied.");
    }
    settings.publishingInteractionConsent = true;
    writeSettings();
    mainWindow?.webContents.send("companion:status-changed");
  }).finally(() => {
    publishingPermissionPromise = null;
  });
  return publishingPermissionPromise;
}

async function ensurePublishingInteractionConsent() {
  if (publishingRunPermissionActive) return;
  await requestPersistentPublishingInteractionConsent();
  publishingRunPermissionActive = true;
}

function finishPublishingInteractionConsent() {
  publishingRunPermissionActive = false;
}

function revokePublishingInteractionConsent() {
  settings.publishingInteractionConsent = false;
  publishingRunPermissionActive = false;
  writeSettings();
  mainWindow?.webContents.send("companion:status-changed");
  return true;
}

function browserPartition(accountId) {
  const digest = createHash("sha256").update(accountId).digest("hex").slice(0, 24);
  return `persist:agenticthat-publishing-${digest}`;
}

async function desktopDebugEndpoint(timeoutMs = 10000) {
  const endpointIsReady = async endpoint => {
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (!response.ok) return false;
      const version = await response.json();
      return typeof version?.webSocketDebuggerUrl === "string";
    } catch {
      return false;
    }
  };

  if (resolvedDesktopDebugPort) {
    const endpoint = `http://127.0.0.1:${resolvedDesktopDebugPort}`;
    if (await endpointIsReady(endpoint)) return endpoint;
    resolvedDesktopDebugPort = null;
  }

  const activePortPath = path.join(app.getPath("userData"), "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const port = Number(fs.readFileSync(activePortPath, "utf8").split(/\r?\n/, 1)[0]);
      if (Number.isInteger(port) && port > 0 && port < 65536) {
        const endpoint = `http://127.0.0.1:${port}`;
        if (await endpointIsReady(endpoint)) {
          resolvedDesktopDebugPort = port;
          return endpoint;
        }
      }
    } catch {
      // Chromium creates DevToolsActivePort shortly after Electron becomes ready.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error("The embedded browser debugging endpoint did not become ready.");
}

function isAllowedInstagramNavigation(value) {
  if (value.startsWith("about:blank")) return true;
  try {
    const target = new URL(value);
    const hostname = target.hostname.toLowerCase();
    return target.protocol === "https:"
      && (hostname === "instagram.com" || hostname.endsWith(".instagram.com"));
  } catch {
    return false;
  }
}

async function openInstagramScrapingBrowser(request) {
  const debugEndpoint = await desktopDebugEndpoint();
  const id = randomUUID();
  const targetUrl = `about:blank#agenticthat-instagram-scrape-${id}`;
  const partition = `agenticthat-instagram-scrape-${id}`;
  const workerWindow = new BrowserWindow({
    x: -10_000,
    y: -10_000,
    width: 1280,
    height: 900,
    show: false,
    opacity: 0,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  workerWindow.removeMenu();
  const isolatedSession = workerWindow.webContents.session;
  const userAgent = chromiumUserAgent(workerWindow.webContents);
  workerWindow.webContents.setUserAgent(userAgent);
  isolatedSession.setUserAgent(userAgent, "en-US,en;q=0.9");
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  workerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedInstagramNavigation(url)) void workerWindow.webContents.loadURL(url);
    return { action: "deny" };
  });
  const protectNavigation = (event, url) => {
    if (!isAllowedInstagramNavigation(url)) event.preventDefault();
  };
  workerWindow.webContents.on("will-navigate", protectNavigation);
  workerWindow.webContents.on("will-redirect", protectNavigation);
  workerWindow.on("closed", () => instagramScrapingBrowsers.delete(id));

  console.log(`Instagram scrape ${String(request?.jobId || "")}: opening isolated public browser session.`);

  instagramScrapingBrowsers.set(id, {
    id,
    jobId: String(request?.jobId || ""),
    window: workerWindow,
    isolatedSession,
  });
  try {
    await workerWindow.loadURL(targetUrl);
    // Instagram defers its Reels grid and data requests while the document is
    // hidden. Keep the worker compositor-visible but transparent and off-screen.
    workerWindow.showInactive();
    return { id, debugEndpoint, targetUrl };
  } catch (error) {
    await closeInstagramScrapingBrowser(id);
    throw error;
  }
}

async function closeInstagramScrapingBrowser(sessionId) {
  const entry = instagramScrapingBrowsers.get(sessionId);
  if (!entry) return;
  instagramScrapingBrowsers.delete(sessionId);
  if (!entry.window.isDestroyed()) {
    entry.window.webContents.stop();
    entry.window.destroy();
  }
  await Promise.allSettled([
    entry.isolatedSession.clearStorageData(),
    entry.isolatedSession.clearCache(),
  ]);
}

async function stopInstagramScrapingBrowsers() {
  await Promise.all([...instagramScrapingBrowsers.keys()].map(closeInstagramScrapingBrowser));
}

function isAllowedFacebookNavigation(value) {
  if (value.startsWith("about:blank")) return true;
  try {
    const target = new URL(value);
    const hostname = target.hostname.toLowerCase();
    return target.protocol === "https:"
      && (hostname === "facebook.com" || hostname.endsWith(".facebook.com") || hostname === "fb.com" || hostname === "fb.watch");
  } catch {
    return false;
  }
}

async function openFacebookScrapingBrowser(request) {
  const debugEndpoint = await desktopDebugEndpoint();
  const id = randomUUID();
  const targetUrl = `about:blank#agenticthat-facebook-scrape-${id}`;
  const partition = `agenticthat-facebook-scrape-${id}`;
  const workerWindow = new BrowserWindow({
    x: -10_000,
    y: -10_000,
    width: 1280,
    height: 900,
    show: false,
    opacity: 0,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  workerWindow.removeMenu();
  const isolatedSession = workerWindow.webContents.session;
  const userAgent = chromiumUserAgent(workerWindow.webContents);
  workerWindow.webContents.setUserAgent(userAgent);
  isolatedSession.setUserAgent(userAgent, "en-US,en;q=0.9");
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  workerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedFacebookNavigation(url)) void workerWindow.webContents.loadURL(url);
    return { action: "deny" };
  });
  const protectNavigation = (event, url) => {
    if (!isAllowedFacebookNavigation(url)) event.preventDefault();
  };
  workerWindow.webContents.on("will-navigate", protectNavigation);
  workerWindow.webContents.on("will-redirect", protectNavigation);
  workerWindow.on("closed", () => facebookScrapingBrowsers.delete(id));
  const sessionMode = "anonymous";
  console.log(`Facebook scrape ${String(request?.jobId || "")}: opening ${sessionMode} browser session.`);
  facebookScrapingBrowsers.set(id, {
    id,
    jobId: String(request?.jobId || ""),
    window: workerWindow,
    isolatedSession,
    persistentSession: false,
  });
  try {
    await workerWindow.loadURL(targetUrl);
    // Facebook defers its feed and Reels grid while an Electron document is in
    // the hidden visibility state. Keep the isolated worker compositor-visible
    // but fully transparent, unfocusable, off-screen, and absent from the taskbar.
    workerWindow.showInactive();
    return { id, debugEndpoint, targetUrl, sessionMode };
  } catch (error) {
    await closeFacebookScrapingBrowser(id);
    throw error;
  }
}

async function closeFacebookScrapingBrowser(sessionId) {
  const entry = facebookScrapingBrowsers.get(sessionId);
  if (!entry) return;
  facebookScrapingBrowsers.delete(sessionId);
  if (!entry.window.isDestroyed()) {
    entry.window.webContents.stop();
    entry.window.destroy();
  }
  await Promise.allSettled([
    ...(entry.persistentSession ? [] : [entry.isolatedSession.clearStorageData()]),
    entry.isolatedSession.clearCache(),
  ]);
}

async function stopFacebookScrapingBrowsers() {
  await Promise.all([...facebookScrapingBrowsers.keys()].map(closeFacebookScrapingBrowser));
}

async function clearAccountBrowserData(accountId) {
  const accountSession = session.fromPartition(browserPartition(accountId));
  await accountSession.clearStorageData();
  await accountSession.clearCache();
}

async function flushAccountBrowserData(accountId) {
  const accountSession = session.fromPartition(browserPartition(accountId));
  await accountSession.flushStorageData();
}

async function openManagedBrowser(request) {
  if (request.purpose === "publish") await ensurePublishingInteractionConsent();

  const debugEndpoint = await desktopDebugEndpoint();
  const id = randomUUID();
  const targetUrl = `about:blank#agenticthat-publishing-${id}`;
  const view = new WebContentsView({
    webPreferences: {
      partition: browserPartition(request.accountId),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  view.setBackgroundColor("#ffffff");
  const embeddedUserAgent = chromiumUserAgent(view.webContents);
  view.webContents.setUserAgent(embeddedUserAgent);
  view.webContents.session.setUserAgent(embeddedUserAgent, "en-US,en;q=0.9");
  view.webContents.setWindowOpenHandler(({ url }) => {
    void view.webContents.loadURL(url);
    return { action: "deny" };
  });
  view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const entry = {
    id,
    request,
    view,
    activity: {
      state: "opening",
      detail: request.purpose === "login"
        ? "Opening a secure login page."
        : "Preparing the live publishing page.",
    },
    openedAt: new Date().toISOString(),
    closedAt: null,
  };
  managedBrowsers.set(id, entry);
  const reapplyLayoutAfterNavigation = () => {
    setImmediate(() => {
      const activeEntry = managedBrowsers.get(id);
      if (activeEntry?.view === view && !view.webContents.isDestroyed()) applyWorkspaceLayout();
    });
  };
  view.webContents.on("did-navigate", reapplyLayoutAfterNavigation);
  view.webContents.on("did-navigate-in-page", reapplyLayoutAfterNavigation);
  view.webContents.on("did-finish-load", reapplyLayoutAfterNavigation);
  mainWindow.contentView.addChildView(view);
  view.setVisible(false);
  await view.webContents.loadURL(targetUrl);

  // Publishing stays in the background. Only a human login needs the
  // Companion window to be shown automatically.
  if (request.purpose === "login") showCompanion("activity", true);
  notifyWorkspaceState({ revealActivity: request.purpose === "login" });
  applyWorkspaceLayout();

  return {
    id,
    debugEndpoint,
    targetUrl,
  };
}

function externalBrowserWorkspaceBounds() {
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = cursorDisplay?.workArea || screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(workArea.x),
    y: Math.round(workArea.y),
    width: Math.max(1, Math.round(workArea.width)),
    height: Math.max(1, Math.round(workArea.height)),
  };
}

async function openExternalActivity(request) {
  if (request.purpose === "publish") await ensurePublishingInteractionConsent();
  const id = randomUUID();
  const workspaceBounds = externalBrowserWorkspaceBounds();
  managedBrowsers.set(id, {
    id,
    request: { ...request, engine: "external_browser" },
    view: null,
    activity: {
      state: "opening",
      detail: request.purpose === "login"
        ? "Opening the dedicated external login window in the browser grid."
        : "Opening the protected Companion-managed Chrome publishing session.",
    },
    openedAt: new Date().toISOString(),
    closedAt: null,
  });
  if (request.purpose === "login") showCompanion("activity", true);
  notifyWorkspaceState({ revealActivity: request.purpose === "login" });
  return { id, workspaceBounds };
}

function updateManagedBrowser(sessionId, activity) {
  const session = managedBrowsers.get(sessionId);
  if (!session) return;
  session.activity = {
    ...session.activity,
    ...activity,
    updatedAt: new Date().toISOString(),
  };
  if (session.request.purpose === "login" && activity.state === "posted") {
    for (const [candidateId, candidate] of managedBrowsers) {
      if (
        candidateId !== sessionId
        && candidate.closedAt
        && candidate.request.purpose === "login"
        && candidate.request.accountId === session.request.accountId
      ) {
        managedBrowsers.delete(candidateId);
      }
    }
  }
  notifyWorkspaceState({ revealActivity: session.request.purpose === "login" });
}

function removeManagedViews(session) {
  for (const view of [session.view]) {
    if (!view) continue;
    try {
      mainWindow?.contentView.removeChildView(view);
    } catch {
      // The app may already be closing.
    }
    if (!view.webContents.isDestroyed()) {
      // Social composers commonly install beforeunload handlers. Waiting for
      // those prompts blocks Electron's main thread, the local API, and every
      // later account in the queue. These views are disposable and their
      // session state is saved before this close runs.
      view.webContents.close({ waitForBeforeUnload: false });
    }
  }
  session.view = null;
}

function pruneActivityHistory() {
  const completed = [...managedBrowsers.values()]
    .filter(session => session.closedAt)
    .sort((left, right) => String(right.closedAt).localeCompare(String(left.closedAt)));
  for (const session of completed.slice(MAX_ACTIVITY_HISTORY)) managedBrowsers.delete(session.id);
}

async function closeManagedBrowser(sessionId, forcedState) {
  const session = managedBrowsers.get(sessionId);
  if (!session || session.closedAt) return;
  if (forcedState) {
    session.activity = {
      ...session.activity,
      state: forcedState.state,
      detail: forcedState.detail,
      updatedAt: new Date().toISOString(),
    };
  }
  session.activity.previewFrame = undefined;
  session.closedAt = new Date().toISOString();
  browserBounds.delete(sessionId);
  browserZoomFactors.delete(sessionId);
  removeManagedViews(session);
  pruneActivityHistory();
  notifyWorkspaceState();
}

async function stopPublishingBrowsers(reason) {
  const activePublishingSessions = [...managedBrowsers.values()]
    .filter(session => !session.closedAt && session.request.purpose === "publish");
  await Promise.all(activePublishingSessions.map(session => closeManagedBrowser(session.id, {
    state: "stopped",
    detail: reason,
  })));
}

function installPublishingDesktopHost() {
  globalThis.__AGENTICTHAT_PUBLISHING_DESKTOP_HOST__ = {
    requestPersistentPublishingPermission: requestPersistentPublishingInteractionConsent,
    requestPublishingPermission: ensurePublishingInteractionConsent,
    finishPublishingRun: finishPublishingInteractionConsent,
    openBrowser: openManagedBrowser,
    openExternalActivity,
    updateBrowser: updateManagedBrowser,
    closeBrowser: closeManagedBrowser,
    stopPublishingBrowsers,
    clearAccountBrowserData,
    flushAccountBrowserData,
    migrateLegacyAccountBrowserData,
  };
  globalThis.__AGENTICTHAT_INSTAGRAM_COMPANION_DESKTOP_HOST__ = {
    openBrowser: openInstagramScrapingBrowser,
    closeBrowser: closeInstagramScrapingBrowser,
    stopBrowsers: stopInstagramScrapingBrowsers,
  };
  globalThis.__AGENTICTHAT_FACEBOOK_COMPANION_DESKTOP_HOST__ = {
    openBrowser: openFacebookScrapingBrowser,
    closeBrowser: closeFacebookScrapingBrowser,
    stopBrowsers: stopFacebookScrapingBrowsers,
  };
}

async function emergencyStop() {
  const activeSessions = [...managedBrowsers.values()].filter(session => !session.closedAt);
  const reason = "Publishing was stopped with the Companion emergency stop.";
  const stopped = await publishingRuntime?.cancelAutomation?.(reason);
  const scrapingStopped = await publishingRuntime?.cancelAllInstagramCompanionJobs?.(
    "Instagram scraping was stopped with the Companion emergency stop."
  );
  const facebookScrapingStopped = await publishingRuntime?.cancelAllFacebookCompanionJobs?.(
    "Facebook scraping was stopped with the Companion emergency stop."
  );
  await publishingRuntime?.stopAllExternalBrowserWindows?.(reason);
  await stopInstagramScrapingBrowsers();
  await stopFacebookScrapingBrowsers();
  await Promise.all(activeSessions.map(session => closeManagedBrowser(session.id, {
    state: "stopped",
    detail: session.request.purpose === "login"
      ? "Login was closed with the Companion emergency stop."
      : "Publishing was stopped with the Companion emergency stop.",
  })));
  notifyWorkspaceState();
  return Boolean(stopped || scrapingStopped || facebookScrapingStopped || activeSessions.length);
}

async function stopScraping() {
  const [instagramStopped, facebookStopped] = await Promise.all([
    publishingRuntime?.cancelAllInstagramCompanionJobs?.("Instagram scraping was stopped from Companion."),
    publishingRuntime?.cancelAllFacebookCompanionJobs?.("Facebook scraping was stopped from Companion."),
  ]);
  return Boolean(instagramStopped || facebookStopped);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: "AgenticThat Companion",
    icon: applicationIconPath(),
    backgroundColor: "#f4f6f9",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(app.getAppPath(), "preload.cjs"),
    },
  });
  mainWindow.removeMenu();
  void mainWindow.loadFile(path.join(app.getAppPath(), "control.html"));
  mainWindow.once("ready-to-show", () => {
    const openedAtMacLogin = process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin;
    // Login-start launches remain unobtrusive on every supported desktop OS.
    if (!process.argv.includes("--hidden") && !openedAtMacLogin) mainWindow.show();
  });
  mainWindow.on("close", event => {
    if (quitting) return;
    if (tray) {
      event.preventDefault();
      mainWindow.hide();
    } else {
      quitting = true;
    }
  });
  mainWindow.on("closed", () => {
    dashboardView = null;
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Companion interface process stopped (${details.reason}). Reloading the local interface.`);
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) void mainWindow.reload();
  });
  if (EMBED_FULL_PUBLISHING_WORKSPACE) createDashboardView();
}

function createTray() {
  const trayImage = nativeImage
    .createFromPath(path.join(app.getAppPath(), "assets", "tray-icon.png"))
    .resize({ width: process.platform === "darwin" ? 18 : 24, height: process.platform === "darwin" ? 18 : 24 });
  if (process.platform === "darwin") trayImage.setTemplateImage(true);
  try {
    tray = new Tray(trayImage);
  } catch (error) {
    tray = null;
    console.warn("The desktop environment does not provide a system tray; Companion will remain available in its main window.", error);
    const revealWithoutTray = () => {
      if (!quitting && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    };
    if (mainWindow?.webContents.isLoading()) mainWindow.once("ready-to-show", revealWithoutTray);
    else revealWithoutTray();
    return false;
  }
  tray.setToolTip("AgenticThat Companion");
  const rebuildMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open AgenticThat Companion", click: () => showCompanion("activity") },
    { label: "Open Workspace in Browser", click: () => shell.openExternal(DASHBOARD_URL) },
    { label: "View Login & Publishing Activity", click: () => showCompanion("activity") },
    {
      label: scrapingWorkCount() > 0
        ? `View Instagram Scraping (${scrapingWorkCount()} active)`
        : "View Instagram Scraping",
      click: () => showCompanion("scraping"),
    },
    { label: "Emergency stop all activity", click: () => void emergencyStop() },
    { type: "separator" },
    {
      label: DESKTOP_PLATFORM.autoStartLabel,
      type: "checkbox",
      checked: settings.autoStart,
      click: item => {
        try {
          saveAutoStart(item.checked);
        } catch (error) {
          item.checked = settings.autoStart;
          console.warn("Could not update Companion login startup:", error instanceof Error ? error.message : error);
        }
        rebuildMenu();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => {
      quitting = true;
      app.quit();
    } },
  ]));
  rebuildTrayMenu = rebuildMenu;
  rebuildMenu();
  tray.on("double-click", () => showCompanion(scrapingWorkCount() > 0 ? "scraping" : "activity"));
  return true;
}

function safeProxyPath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  const url = new URL(value, SERVICE_ORIGIN);
  if (url.origin !== SERVICE_ORIGIN) return null;
  if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/uploads/")) return null;
  return `${url.pathname}${url.search}`;
}

async function proxyDashboardRequest(message) {
  const requestPath = safeProxyPath(message?.path);
  const method = String(message?.method || "GET").toUpperCase();
  if (!requestPath || !new Set(["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"]).has(method)) {
    return { ok: false, status: 400, error: "The publishing request is invalid." };
  }

  const headers = new Headers();
  for (const entry of Array.isArray(message.headers) ? message.headers : []) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const name = String(entry[0]);
    if (/^(host|origin|referer|content-length|connection)$/i.test(name)) continue;
    headers.set(name, String(entry[1]));
  }
  headers.set("X-AgenticThat-Extension", APP_VERSION);
  headers.set("X-AgenticThat-Desktop", APP_VERSION);

  let body;
  if (typeof message.bodyText === "string") body = message.bodyText;
  if (typeof message.bodyBase64 === "string") body = Buffer.from(message.bodyBase64, "base64");

  try {
    const response = await fetch(`${SERVICE_ORIGIN}${requestPath}`, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      cache: "no-store",
      redirect: "manual",
    });
    const responseHeaders = [...response.headers.entries()];
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json") || contentType.startsWith("text/")) {
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        bodyText: await response.text(),
      };
    }
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
    };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: error instanceof Error ? error.message : "The local publishing service is unavailable.",
    };
  }
}

function registerIpc() {
  ipcMain.handle("companion:status", () => serviceStatus());
  ipcMain.handle("companion:workspace-state", () => workspaceState());
  ipcMain.handle("companion:scraping-state", () => scrapingActivity());
  ipcMain.handle("companion:set-layout", (_event, layout) => {
    dashboardBounds = EMBED_FULL_PUBLISHING_WORKSPACE ? safeBounds(layout?.dashboard) : null;
    browserBounds = new Map(
      (Array.isArray(layout?.browsers) ? layout.browsers : [])
        .map(entry => [String(entry?.id || ""), safeBounds(entry?.bounds)])
        .filter(([id, bounds]) => id && bounds),
    );
    browserZoomFactors = new Map(
      (Array.isArray(layout?.browsers) ? layout.browsers : [])
        .map(entry => [String(entry?.id || ""), safeZoomFactor(entry?.zoomFactor)])
        .filter(([id]) => id),
    );
    applyWorkspaceLayout();
    return true;
  });
  ipcMain.handle("companion:open-dashboard", () => {
    if (EMBED_FULL_PUBLISHING_WORKSPACE) showCompanion("dashboard");
    else void shell.openExternal(DASHBOARD_URL);
    return true;
  });
  ipcMain.handle("companion:open-connections", () => {
    void shell.openExternal(PUBLISHING_CONNECTIONS_URL);
    return true;
  });
  ipcMain.handle("companion:reload-dashboard", () => {
    dashboardView?.webContents.reloadIgnoringCache();
    return true;
  });
  ipcMain.handle("companion:install-chrome", () => shell.openExternal(CHROME_DOWNLOAD_URL));
  ipcMain.handle("companion:open-data", () => shell.openPath(path.join(app.getPath("userData"), "publishing-data")));
  ipcMain.handle("companion:open-logs", () => shell.showItemInFolder(logPath));
  ipcMain.handle("companion:copy-credentials", () => {
    clipboard.writeText(`Username: ${settings.username}\nPassword: ${settings.passwordPlain}`);
    return true;
  });
  ipcMain.handle("companion:set-auto-start", (_event, enabled) => {
    saveAutoStart(Boolean(enabled));
    return settings.autoStart;
  });
  ipcMain.handle("companion:revoke-publishing-consent", () => revokePublishingInteractionConsent());
  ipcMain.handle("companion:arrange-external-windows", () => (
    publishingRuntime?.arrangeExternalBrowserWindows?.(externalBrowserWorkspaceBounds())
  ));
  ipcMain.handle("companion:focus-external-window", (_event, sessionId) => (
    publishingRuntime?.focusExternalBrowserWindow?.(String(sessionId || ""))
  ));
  ipcMain.handle("companion:stop-scraping", () => stopScraping());
  ipcMain.handle("companion:emergency-stop", () => emergencyStop());
  ipcMain.handle("companion:dashboard-proxy", (event, message) => {
    if (!EMBED_FULL_PUBLISHING_WORKSPACE || !dashboardView || event.sender.id !== dashboardView.webContents.id) {
      return { ok: false, status: 403, error: "This page cannot use the publishing bridge." };
    }
    return proxyDashboardRequest(message);
  });
}

if (started || !ownsSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => showCompanion(
    scrapingWorkCount() > 0 ? "scraping" : managedBrowsers.size > 0 ? "activity" : "dashboard",
  ));

  app.whenReady().then(async () => {
    if (app.isPackaged && !secureStorageAvailable()) {
      const detail = process.platform === "linux"
        ? "Install and unlock GNOME Keyring/libsecret or KWallet, then start Companion again. Companion refuses Linux's basic-text fallback."
        : process.platform === "darwin"
          ? "Unlock macOS Keychain and try again. A signed Companion build is required for consistent Keychain access."
          : "Restart Windows and try again.";
      await dialog.showMessageBox({
        type: "error",
        title: "Secure storage is unavailable",
        message: "AgenticThat Companion cannot start without operating-system encryption.",
        detail: `${detail} Companion will not store workspace or social-session secrets as plain text.`,
        buttons: ["Close"],
      });
      app.quit();
      return;
    }
    settings = loadSettings();
    configureRuntimeEnvironment();
    installFileLogging();
    configureAutoUpdates();
    registerIpc();
    createWindow();
    installPublishingDesktopHost();
    createTray();
    try {
      saveAutoStart(settings.autoStart);
    } catch (error) {
      console.warn("Could not configure Companion login startup:", error instanceof Error ? error.message : error);
    }
    try {
      await configureServiceTokenVerifier();
      await desktopDebugEndpoint();
      await startPublishingService();
      startServiceWatchdog();
      console.log(`AgenticThat Companion ${APP_VERSION} is ready.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isPortConflict = /port 8792|EADDRINUSE|address already in use/i.test(errorMessage);
      console.error("Could not start publishing service:", errorMessage);
      const response = await dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Companion could not start",
        message: isPortConflict
          ? "Another AgenticThat Companion is already running."
          : "AgenticThat Companion could not start its local service.",
        detail: isPortConflict
          ? "Close every older Companion version, then open this version again."
          : `${errorMessage}\n\nCompanion can remain open and retry automatically.`,
        buttons: isPortConflict ? ["Close"] : ["Keep retrying", "Close"],
        defaultId: 0,
        cancelId: isPortConflict ? 0 : 1,
      });
      if (isPortConflict || response.response === 1) {
        app.quit();
        return;
      }
      setRuntimeState("error", errorMessage);
      startServiceWatchdog();
    }
    mainWindow?.webContents.send("companion:status-changed");
    notifyWorkspaceState();

    powerMonitor.on("resume", () => {
      console.log("Computer resumed; checking Companion health and workspace jobs now.");
      void publishingRuntime?.wakeCentralWorkspaceCompanion?.().catch(error => {
        console.warn("Workspace reconnect after resume is pending:", error instanceof Error ? error.message : error);
      });
      void serviceStatus().then(status => {
        if (!status.connected) return restartPublishingService(status.error || "Local service did not recover after resume.");
      });
    });
  });

  app.on("before-quit", () => {
    quitting = true;
    publishingRunPermissionActive = false;
  });
  app.on("window-all-closed", () => {});
  app.on("will-quit", () => {
    if (serviceWatchdogTimer) clearInterval(serviceWatchdogTimer);
    serviceWatchdogTimer = null;
    if (updatePromptTimer) clearTimeout(updatePromptTimer);
    updatePromptTimer = null;
    for (const unsubscribe of unsubscribeScrapingActivities) unsubscribe?.();
    unsubscribeScrapingActivities = [];
    // Do not mark queued/running scrape jobs as cancelled on normal exit or an
    // update restart. Their encrypted snapshots restore running work as queued
    // so a restart never silently discards a customer job.
    void stopInstagramScrapingBrowsers();
    void stopFacebookScrapingBrowsers();
    publishingRuntime?.stopPublishingBackgroundServices?.();
    publishingServer?.close();
    globalThis.__AGENTICTHAT_PUBLISHING_DESKTOP_HOST__ = undefined;
    globalThis.__AGENTICTHAT_INSTAGRAM_COMPANION_DESKTOP_HOST__ = undefined;
    globalThis.__AGENTICTHAT_FACEBOOK_COMPANION_DESKTOP_HOST__ = undefined;
  });
}
