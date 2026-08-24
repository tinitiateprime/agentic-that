import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import { createAutomationApp } from "./app.ts";
import { loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase, createAutomationDatabase } from "./database.ts";
import { AutomationJobStore } from "./job-store.ts";
import { PlaywrightLoginBrowserLauncher } from "./login-browser.ts";
import { AutomationLoginManager } from "./login-manager.ts";
import { AutomationLoginStore } from "./login-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { automationSchemaReady, migrateAutomationSchema } from "./schema.ts";

export async function startAutomationServer() {
  const config = loadAutomationConfig();
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();

  assertSafeAutomationDatabase(config);
  const database = createAutomationDatabase(config);
  if (config.autoMigrate) migrateAutomationSchema(database);
  const databaseReady = automationSchemaReady(database);
  const store = databaseReady ? new AutomationJobStore(database, files) : null;
  const loginManager = databaseReady
    ? new AutomationLoginManager(
        new AutomationLoginStore(database),
        files,
        new PlaywrightLoginBrowserLauncher(config.browserExecutablePath, config.loginTimeoutMs),
      )
    : null;
  loginManager?.recoverInterruptedSessions();

  const app = createAutomationApp({ config, databaseReady, store, loginManager });
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(config.port, config.host, () => resolve(listener));
    listener.once("error", reject);
  });

  const shutdown = async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await loginManager?.shutdown();
    database.close();
  };

  process.stdout.write(
    `AgenticThat automation server listening on http://${config.host}:${config.port} ` +
      `(publishing ${config.executionEnabled ? "enabled" : "disabled"}, database ${databaseReady ? "ready" : "not ready"}).\n`,
  );
  return { server, config, shutdown };
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  startAutomationServer()
    .then(({ shutdown }) => {
      let closing = false;
      const close = () => {
        if (closing) return;
        closing = true;
        void shutdown().finally(() => { process.exitCode = 0; });
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    })
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
