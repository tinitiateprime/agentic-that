import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import { createAutomationApp } from "./app.ts";
import { loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase, createAutomationSql, type AutomationSql } from "./database.ts";
import { AutomationJobStore } from "./job-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { automationSchemaReady, migrateAutomationSchema } from "./schema.ts";

export async function startAutomationServer() {
  const config = loadAutomationConfig();
  const files = new AutomationFileStore(config.dataDirectory);
  await files.initialize();

  let sql: AutomationSql | null = null;
  let databaseReady = false;
  let store: AutomationJobStore | null = null;
  if (config.databaseUrl) {
    assertSafeAutomationDatabase(config);
    sql = createAutomationSql(config);
    if (config.autoMigrate) await migrateAutomationSchema(sql);
    databaseReady = await automationSchemaReady(sql);
    if (databaseReady) store = new AutomationJobStore(sql, files);
  }

  const app = createAutomationApp({ config, databaseReady, store });
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(config.port, config.host, () => resolve(listener));
    listener.once("error", reject);
  });

  const shutdown = async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (sql) await sql.end();
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
