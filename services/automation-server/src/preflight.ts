import { pathToFileURL } from "node:url";
import { livePublishingEnabled, loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase } from "./database.ts";
import { detectServerBrowserExecutable } from "./login-browser.ts";
import { automationPostgresReady, closeAutomationPostgres, createAutomationPostgres } from "./postgres-database.ts";
import { AzureAutomationRemoteStorage } from "./remote-storage.ts";

export async function automationPreflight() {
  const config = loadAutomationConfig();
  let databaseReady = false;
  let databaseTarget = "";
  if (config.databaseEngine === "postgres") {
    const database = createAutomationPostgres(config);
    try {
      databaseReady = await automationPostgresReady(database);
      databaseTarget = "configured PostgreSQL database";
    } finally {
      await closeAutomationPostgres(database);
    }
  } else {
    const database = assertSafeAutomationDatabase(config);
    databaseTarget = database.file;
    databaseReady = true;
  }
  if (!databaseReady) throw new Error("The automation database schema is not ready.");
  if (config.storageBackend === "azure") {
    await AzureAutomationRemoteStorage.fromConfig(config, config.dataDirectory).assertReady();
  }
  const browserRequired = config.loginEnabled
    || config.publishingPreviewEnabled
    || livePublishingEnabled(config);
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
    databaseEngine: config.databaseEngine,
    databaseTarget,
    storageBackend: config.storageBackend,
    dataDirectory: config.dataDirectory,
    browserRequired,
    browserExecutable,
    autoMigrate: config.autoMigrate,
    liveWorkerCount: livePublishingEnabled(config) ? config.liveWorkerCount : 0,
  };
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  try {
    automationPreflight().then(status => {
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    }).catch(error => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
