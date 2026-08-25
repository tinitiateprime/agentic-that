import { pathToFileURL } from "node:url";
import { loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase } from "./database.ts";
import { detectServerBrowserExecutable } from "./login-browser.ts";

export function automationPreflight() {
  const config = loadAutomationConfig();
  const database = assertSafeAutomationDatabase(config);
  const browserRequired = config.loginEnabled
    || config.publishingPreviewEnabled
    || (config.executionEnabled && config.instagramPublishingEnabled);
  const browserExecutable = browserRequired
    ? detectServerBrowserExecutable(config.browserExecutablePath)
    : null;
  if (browserRequired && !browserExecutable) {
    throw new Error("A supported Chromium browser is required by the enabled staging features.");
  }

  return {
    ok: true,
    deploymentMode: config.deploymentMode,
    bind: `${config.host}:${config.port}`,
    databaseFile: database.file,
    dataDirectory: config.dataDirectory,
    browserRequired,
    browserExecutable,
    autoMigrate: config.autoMigrate,
    liveWorkerCount: config.executionEnabled && config.instagramPublishingEnabled ? config.liveWorkerCount : 0,
  };
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  try {
    process.stdout.write(`${JSON.stringify(automationPreflight(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
