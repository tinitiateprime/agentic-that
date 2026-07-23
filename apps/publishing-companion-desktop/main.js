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
} from "electron";
import started from "electron-squirrel-startup";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DASHBOARD_URL = "https://agentic-that.netlify.app/publishing";
const CHROME_DOWNLOAD_URL = "https://www.google.com/chrome/";
const SERVICE_ORIGIN = "http://127.0.0.1:8792";
const userDataOverride = process.env.AGENTICTHAT_COMPANION_DATA_DIR?.trim();
if (userDataOverride) {
  const resolvedUserData = path.resolve(userDataOverride);
  fs.mkdirSync(resolvedUserData, { recursive: true });
  app.setPath("userData", resolvedUserData);
}
const APP_VERSION = app.getVersion();

let mainWindow = null;
let tray = null;
let publishingServer = null;
let quitting = false;
let settings = null;
let logPath = "";

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

function loadSettings() {
  const settingsPath = settingsFilePath();
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (parsed.version === 1 && parsed.password?.value && parsed.authSecret?.value) {
      const instanceId = parsed.instanceId || randomSecret(18);
      if (!parsed.instanceId) {
        fs.writeFileSync(settingsPath, `${JSON.stringify({ ...parsed, instanceId }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      }
      return {
        ...parsed,
        instanceId,
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
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(created, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
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
  process.env.PUBLISH_QUEUE_WEB_ORIGIN = "https://agentic-that.netlify.app";
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
    };
  }
}

async function startPublishingService() {
  const runtimeEntry = path.join(app.getAppPath(), "runtime", "server.mjs");
  const runtime = await import(`${pathToFileURL(runtimeEntry).href}?v=${createHash("sha1").update(APP_VERSION).digest("hex")}`);
  publishingServer = runtime.createPublishingHttpServer({ host: "127.0.0.1", port: 8792, startBackgroundServices: true });
  await new Promise((resolve, reject) => {
    if (publishingServer.listening) return resolve();
    publishingServer.once("listening", resolve);
    publishingServer.once("error", reject);
  });
}

async function serviceStatus() {
  try {
    const response = await fetch(`${SERVICE_ORIGIN}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error(`Health check returned ${response.status}`);
    const health = await response.json();
    if (health.companionInstanceId !== settings.instanceId) {
      throw new Error("Another publishing service is using port 8792. Close the older command-window companion, then restart this app.");
    }
    return {
      connected: true,
      ...health,
      version: APP_VERSION,
      username: settings.username,
      password: settings.passwordPlain,
      autoStart: settings.autoStart,
      dataDirectory: path.join(app.getPath("userData"), "publishing-data"),
    };
  } catch (error) {
    return {
      connected: false,
      automationReady: false,
      chromeInstalled: false,
      version: APP_VERSION,
      username: settings.username,
      password: settings.passwordPlain,
      autoStart: settings.autoStart,
      error: error instanceof Error ? error.message : "The publishing service is unavailable.",
    };
  }
}

function saveAutoStart(enabled) {
  settings.autoStart = enabled;
  const persisted = {
    version: settings.version,
    username: settings.username,
    password: settings.password,
    authSecret: settings.authSecret,
    instanceId: settings.instanceId,
    autoStart: enabled,
    createdAt: settings.createdAt,
  };
  fs.writeFileSync(settingsFilePath(), `${JSON.stringify(persisted, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (app.isPackaged && process.env.AGENTICTHAT_COMPANION_DISABLE_AUTOSTART !== "1") {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 650,
    minWidth: 680,
    minHeight: 560,
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function createTray() {
  const trayImage = nativeImage.createFromPath(path.join(app.getAppPath(), "assets", "tray-icon.png"));
  tray = new Tray(trayImage);
  tray.setToolTip("AgenticThat Publishing Companion");
  const rebuildMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Companion", click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: "Open Publishing Dashboard", click: () => void shell.openExternal(DASHBOARD_URL) },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: settings.autoStart,
      click: item => { saveAutoStart(item.checked); rebuildMenu(); },
    },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
  rebuildMenu();
  tray.on("double-click", () => { mainWindow.show(); mainWindow.focus(); });
}

function registerIpc() {
  ipcMain.handle("companion:status", () => serviceStatus());
  ipcMain.handle("companion:open-dashboard", () => shell.openExternal(DASHBOARD_URL));
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
}

if (started) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    settings = loadSettings();
    configureRuntimeEnvironment();
    installFileLogging();
    registerIpc();
    createWindow();
    createTray();
    saveAutoStart(settings.autoStart);
    try {
      await startPublishingService();
      console.log(`AgenticThat Publishing Companion ${APP_VERSION} is ready.`);
    } catch (error) {
      console.error("Could not start publishing service:", error instanceof Error ? error.message : error);
    }
    mainWindow?.webContents.send("companion:status-changed");
  });

  app.on("before-quit", () => { quitting = true; });
  app.on("window-all-closed", () => {});
  app.on("will-quit", () => {
    publishingServer?.close();
  });
}
