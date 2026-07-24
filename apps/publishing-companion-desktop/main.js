import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
  Tray,
  WebContentsView,
} from "electron";
import started from "electron-squirrel-startup";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DASHBOARD_URL = "https://agentic-that.netlify.app/publishing";
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
const CHROME_DOWNLOAD_URL = "https://www.google.com/chrome/";
const SERVICE_ORIGIN = "http://127.0.0.1:8792";
const DESKTOP_DEBUG_PORT = Number(process.env.AGENTICTHAT_DESKTOP_DEBUG_PORT || 8793);
const MAX_ACTIVITY_HISTORY = 20;

const userDataOverride = process.env.AGENTICTHAT_COMPANION_DATA_DIR?.trim();
if (userDataOverride) {
  const resolvedUserData = path.resolve(userDataOverride);
  fs.mkdirSync(resolvedUserData, { recursive: true });
  app.setPath("userData", resolvedUserData);
}

app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
app.commandLine.appendSwitch("remote-debugging-port", String(DESKTOP_DEBUG_PORT));
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling");

const APP_VERSION = app.getVersion();
const managedBrowsers = new Map();

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
let consentPromise = null;
let consentResolve = null;
let consentReject = null;

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function encryptedValue(value) {
  if (safeStorage.isEncryptionAvailable()) {
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

function persistedSettings(value = settings) {
  return {
    version: value.version,
    username: value.username,
    password: value.password,
    authSecret: value.authSecret,
    instanceId: value.instanceId,
    autoStart: value.autoStart,
    publishingInteractionConsent: Boolean(value.publishingInteractionConsent),
    createdAt: value.createdAt,
  };
}

function writeSettings() {
  fs.writeFileSync(
    settingsFilePath(),
    `${JSON.stringify(persistedSettings(), null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function loadSettings() {
  const settingsPath = settingsFilePath();
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (parsed.version === 1 && parsed.password?.value && parsed.authSecret?.value) {
      const instanceId = parsed.instanceId || randomSecret(18);
      const normalized = {
        ...parsed,
        instanceId,
        publishingInteractionConsent: parsed.publishingInteractionConsent === true,
      };
      if (!parsed.instanceId || parsed.publishingInteractionConsent === undefined) {
        fs.writeFileSync(settingsPath, `${JSON.stringify(persistedSettings(normalized), null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      return {
        ...normalized,
        passwordPlain: decryptedValue(parsed.password),
        authSecretPlain: decryptedValue(parsed.authSecret),
      };
    }
  } catch {
    // Create a recoverable local configuration below.
  }

  const passwordPlain = `${randomSecret(9)}!Aa7`;
  const authSecretPlain = randomSecret(48);
  const created = {
    version: 1,
    username: "operations.manager",
    password: encryptedValue(passwordPlain),
    authSecret: encryptedValue(authSecretPlain),
    instanceId: randomSecret(18),
    autoStart: true,
    publishingInteractionConsent: false,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(persistedSettings(created), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { ...created, passwordPlain, authSecretPlain };
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
  process.env.PUBLISH_QUEUE_SERVICE_HOST = "127.0.0.1";
  process.env.PUBLISH_QUEUE_SERVICE_PORT = "8792";
  process.env.PUBLISH_QUEUE_WEB_ORIGIN = DASHBOARD_ORIGIN;
  process.env.PUBLISH_QUEUE_DATA_PATH = path.join(dataDirectory, "store.json");
  process.env.PUBLISH_QUEUE_UPLOAD_DIR = uploadDirectory;
  process.env.PUBLISH_QUEUE_BROWSER_DATA_DIR = browserDataDirectory;
  process.env.PUBLISH_QUEUE_LOCAL_AUTH_SECRET_PATH = path.join(dataDirectory, ".auth-token-secret");
  process.env.PUBLISH_QUEUE_AUTH_TOKEN_SECRET = settings.authSecretPlain;
  process.env.PUBLISH_QUEUE_COMPANION_INSTANCE_ID = settings.instanceId;
  process.env.PUBLISH_QUEUE_OPERATIONS_MANAGER_USERNAME = settings.username;
  process.env.PUBLISH_QUEUE_OPERATIONS_MANAGER_PASSWORD = settings.passwordPlain;
  process.env.PUBLISH_QUEUE_SCHEDULER_ENABLED = "true";
  process.env.PUBLISH_QUEUE_SCHEDULER_CRON = "* * * * *";
  process.env.PUBLISH_QUEUE_SCHEDULER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  process.env.PUBLISH_QUEUE_INTERRUPTED_POST_RECOVERY = "review";
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

async function startPublishingService() {
  const runtimeEntry = path.join(app.getAppPath(), "runtime", "server.mjs");
  publishingRuntime = await import(
    `${pathToFileURL(runtimeEntry).href}?v=${createHash("sha1").update(APP_VERSION).digest("hex")}`
  );
  publishingServer = publishingRuntime.createPublishingHttpServer({
    host: "127.0.0.1",
    port: 8792,
    startBackgroundServices: true,
  });
  await new Promise((resolve, reject) => {
    if (publishingServer.listening) return resolve();
    publishingServer.once("listening", resolve);
    publishingServer.once("error", reject);
  });
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
      password: settings.passwordPlain,
      autoStart: settings.autoStart,
      publishingInteractionConsent: settings.publishingInteractionConsent,
      dataDirectory: path.join(app.getPath("userData"), "publishing-data"),
    };
  } catch (error) {
    return {
      connected: false,
      automationReady: false,
      embeddedBrowser: true,
      chromeInstalled: false,
      version: APP_VERSION,
      username: settings.username,
      password: settings.passwordPlain,
      autoStart: settings.autoStart,
      publishingInteractionConsent: settings.publishingInteractionConsent,
      error: error instanceof Error ? error.message : "The publishing service is unavailable.",
    };
  }
}

function saveAutoStart(enabled) {
  settings.autoStart = enabled;
  writeSettings();
  if (app.isPackaged && process.env.AGENTICTHAT_COMPANION_DISABLE_AUTOSTART !== "1") {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
  }
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
    setViewBounds(session.view, bounds);
    setViewBounds(session.lockView, session.request.purpose === "publish" ? bounds : null);
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
    activity: session.activity,
    active: Boolean(session.view),
    openedAt: session.openedAt,
    closedAt: session.closedAt ?? null,
  };
}

function workspaceState() {
  return {
    consentRequired: Boolean(consentPromise && !settings.publishingInteractionConsent),
    sessions: [...managedBrowsers.values()]
      .sort((left, right) => right.openedAt.localeCompare(left.openedAt))
      .slice(0, MAX_ACTIVITY_HISTORY)
      .map(publicBrowserSession),
  };
}

function notifyWorkspaceState({ revealActivity = false } = {}) {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("companion:workspace-state", workspaceState());
  if (revealActivity) mainWindow.webContents.send("companion:navigate", "activity");
}

function showCompanion(section = "dashboard", focus = true) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  if (focus) mainWindow.focus();
  mainWindow.webContents.send("companion:navigate", section);
}

function chromiumUserAgent(webContents) {
  return webContents
    .getUserAgent()
    .replace(/\sElectron\/[^\s]+/i, "")
    .replace(/\sAgenticThat Publishing Companion\/[^\s]+/i, "");
}

function createDashboardView() {
  dashboardView = new WebContentsView({
    webPreferences: {
      partition: "persist:agenticthat-dashboard",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: true,
      preload: path.join(app.getAppPath(), "dashboard-preload.cjs"),
    },
  });
  dashboardView.setBackgroundColor("#f4f8f6");
  dashboardView.webContents.setUserAgent(chromiumUserAgent(dashboardView.webContents));
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

function interactionLockPath() {
  return path.join(app.getAppPath(), "interaction-lock.html");
}

async function ensurePublishingInteractionConsent() {
  if (settings.publishingInteractionConsent) return;
  if (consentPromise) return consentPromise;

  showCompanion("activity");
  consentPromise = new Promise((resolve, reject) => {
    consentResolve = resolve;
    consentReject = reject;
  }).finally(() => {
    consentPromise = null;
    consentResolve = null;
    consentReject = null;
    notifyWorkspaceState();
  });
  notifyWorkspaceState({ revealActivity: true });
  return consentPromise;
}

function browserPartition(accountId) {
  const digest = createHash("sha256").update(accountId).digest("hex").slice(0, 24);
  return `persist:agenticthat-publishing-${digest}`;
}

async function openManagedBrowser(request) {
  if (request.purpose === "publish") await ensurePublishingInteractionConsent();

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
  view.webContents.setUserAgent(chromiumUserAgent(view.webContents));
  view.webContents.setWindowOpenHandler(({ url }) => {
    void view.webContents.loadURL(url);
    return { action: "deny" };
  });
  view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  let lockView = null;
  if (request.purpose === "publish") {
    lockView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(app.getAppPath(), "interaction-lock-preload.cjs"),
      },
    });
    lockView.setBackgroundColor("#00000000");
    await lockView.webContents.loadFile(interactionLockPath(), {
      query: { platform: request.platform, account: request.displayName || request.handle },
    });
  }

  const entry = {
    id,
    request,
    view,
    lockView,
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
  mainWindow.contentView.addChildView(view);
  if (lockView) mainWindow.contentView.addChildView(lockView);
  view.setVisible(false);
  lockView?.setVisible(false);
  await view.webContents.loadURL(targetUrl);

  showCompanion("activity", request.purpose === "login");
  notifyWorkspaceState({ revealActivity: true });
  applyWorkspaceLayout();

  return {
    id,
    debugEndpoint: `http://127.0.0.1:${DESKTOP_DEBUG_PORT}`,
    targetUrl,
  };
}

function updateManagedBrowser(sessionId, activity) {
  const session = managedBrowsers.get(sessionId);
  if (!session) return;
  session.activity = {
    ...session.activity,
    ...activity,
    updatedAt: new Date().toISOString(),
  };
  notifyWorkspaceState({ revealActivity: session.request.purpose === "login" });
}

function removeManagedViews(session) {
  for (const view of [session.lockView, session.view]) {
    if (!view) continue;
    try {
      mainWindow?.contentView.removeChildView(view);
    } catch {
      // The app may already be closing.
    }
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  session.view = null;
  session.lockView = null;
}

function pruneActivityHistory() {
  const completed = [...managedBrowsers.values()]
    .filter(session => !session.view)
    .sort((left, right) => String(right.closedAt).localeCompare(String(left.closedAt)));
  for (const session of completed.slice(MAX_ACTIVITY_HISTORY)) managedBrowsers.delete(session.id);
}

async function closeManagedBrowser(sessionId, forcedState) {
  const session = managedBrowsers.get(sessionId);
  if (!session || !session.view) return;
  if (forcedState) {
    session.activity = {
      ...session.activity,
      state: forcedState.state,
      detail: forcedState.detail,
      updatedAt: new Date().toISOString(),
    };
  }
  session.closedAt = new Date().toISOString();
  browserBounds.delete(sessionId);
  removeManagedViews(session);
  pruneActivityHistory();
  notifyWorkspaceState();
}

async function stopPublishingBrowsers(reason) {
  const activePublishingSessions = [...managedBrowsers.values()]
    .filter(session => session.view && session.request.purpose === "publish");
  await Promise.all(activePublishingSessions.map(session => closeManagedBrowser(session.id, {
    state: "stopped",
    detail: reason,
  })));
}

function installPublishingDesktopHost() {
  globalThis.__AGENTICTHAT_PUBLISHING_DESKTOP_HOST__ = {
    openBrowser: openManagedBrowser,
    updateBrowser: updateManagedBrowser,
    closeBrowser: closeManagedBrowser,
    stopPublishingBrowsers,
  };
}

async function emergencyStop() {
  const activeSessions = [...managedBrowsers.values()].filter(session => session.view);
  const stopped = await publishingRuntime?.cancelAutomation?.(
    "Publishing was stopped with the Companion emergency stop.",
  );
  await Promise.all(activeSessions.map(session => closeManagedBrowser(session.id, {
    state: "stopped",
    detail: session.request.purpose === "login"
      ? "Login was closed with the Companion emergency stop."
      : "Publishing was stopped with the Companion emergency stop.",
  })));
  notifyWorkspaceState();
  return Boolean(stopped || activeSessions.length);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: "AgenticThat Publishing Companion",
    icon: path.join(app.getAppPath(), "assets", "app-icon.ico"),
    backgroundColor: "#07142c",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(app.getAppPath(), "preload.cjs"),
    },
  });
  mainWindow.removeMenu();
  void mainWindow.loadFile(path.join(app.getAppPath(), "control.html"));
  mainWindow.once("ready-to-show", () => {
    if (!process.argv.includes("--hidden")) mainWindow.show();
  });
  mainWindow.on("close", event => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("closed", () => {
    dashboardView = null;
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  createDashboardView();
}

function createTray() {
  const trayImage = nativeImage.createFromPath(path.join(app.getAppPath(), "assets", "tray-icon.png"));
  tray = new Tray(trayImage);
  tray.setToolTip("AgenticThat Publishing Companion");
  const rebuildMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Publishing Workspace", click: () => showCompanion("dashboard") },
    { label: "View Live Activity", click: () => showCompanion("activity") },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: settings.autoStart,
      click: item => {
        saveAutoStart(item.checked);
        rebuildMenu();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => {
      quitting = true;
      app.quit();
    } },
  ]));
  rebuildMenu();
  tray.on("double-click", () => showCompanion("dashboard"));
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
  ipcMain.handle("companion:set-layout", (_event, layout) => {
    dashboardBounds = safeBounds(layout?.dashboard);
    browserBounds = new Map(
      (Array.isArray(layout?.browsers) ? layout.browsers : [])
        .map(entry => [String(entry?.id || ""), safeBounds(entry?.bounds)])
        .filter(([id, bounds]) => id && bounds),
    );
    applyWorkspaceLayout();
    return true;
  });
  ipcMain.handle("companion:open-dashboard", () => {
    showCompanion("dashboard");
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
  ipcMain.handle("companion:set-interaction-consent", (_event, enabled) => {
    settings.publishingInteractionConsent = Boolean(enabled);
    writeSettings();
    if (settings.publishingInteractionConsent) consentResolve?.();
    else consentReject?.(new Error("Publishing permission was not granted."));
    notifyWorkspaceState();
    return settings.publishingInteractionConsent;
  });
  ipcMain.handle("companion:emergency-stop", () => emergencyStop());
  ipcMain.handle("companion:dashboard-proxy", (event, message) => {
    if (!dashboardView || event.sender.id !== dashboardView.webContents.id) {
      return { ok: false, status: 403, error: "This page cannot use the publishing bridge." };
    }
    return proxyDashboardRequest(message);
  });
}

if (started) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showCompanion("dashboard"));

  app.whenReady().then(async () => {
    settings = loadSettings();
    configureRuntimeEnvironment();
    installFileLogging();
    registerIpc();
    createWindow();
    installPublishingDesktopHost();
    createTray();
    saveAutoStart(settings.autoStart);
    try {
      await startPublishingService();
      console.log(`AgenticThat Publishing Companion ${APP_VERSION} is ready.`);
    } catch (error) {
      console.error("Could not start publishing service:", error instanceof Error ? error.message : error);
    }
    mainWindow?.webContents.send("companion:status-changed");
    notifyWorkspaceState();
  });

  app.on("before-quit", () => {
    quitting = true;
    consentReject?.(new Error("Companion is closing."));
  });
  app.on("window-all-closed", () => {});
  app.on("will-quit", () => {
    publishingServer?.close();
    globalThis.__AGENTICTHAT_PUBLISHING_DESKTOP_HOST__ = undefined;
  });
}
