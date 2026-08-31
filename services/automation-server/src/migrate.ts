import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase, createAutomationDatabase } from "./database.ts";
import { automationSchemaReady, migrateAutomationSchema } from "./schema.ts";
import { closeAutomationPostgres, createAutomationPostgres, migrateAutomationPostgres } from "./postgres-database.ts";

export async function runAutomationMigration() {
  const config = loadAutomationConfig();
  if (config.databaseEngine === "postgres") {
    // The migration file owns its transaction. A single dedicated connection
    // guarantees BEGIN/COMMIT cannot be split across a runtime connection pool.
    const database = createAutomationPostgres(config, 1);
    try {
      await migrateAutomationPostgres(database);
      process.stdout.write("Automation PostgreSQL database migrations are complete.\n");
    } finally {
      await closeAutomationPostgres(database);
    }
    return;
  }
  const target = assertSafeAutomationDatabase(config);
  await mkdir(config.dataDirectory, { recursive: true });
  const database = createAutomationDatabase(config);
  try {
    migrateAutomationSchema(database);
    if (!automationSchemaReady(database)) {
      throw new Error("The isolated automation database migration did not create the publishing job table.");
    }
    process.stdout.write(`Local automation SQLite database ready at ${target.file}.\n`);
  } finally {
    database.close();
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  runAutomationMigration().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
