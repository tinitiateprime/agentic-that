import { pathToFileURL } from "node:url";
import { loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase, createAutomationSql } from "./database.ts";
import { automationSchemaReady, migrateAutomationSchema } from "./schema.ts";

export async function runAutomationMigration() {
  const config = loadAutomationConfig();
  const target = assertSafeAutomationDatabase(config);
  const sql = createAutomationSql(config);
  try {
    await migrateAutomationSchema(sql);
    if (!(await automationSchemaReady(sql))) {
      throw new Error("The isolated automation database migration did not create the publishing job table.");
    }
    process.stdout.write(
      `Automation staging schema ready in ${target.database} on ${target.host}:${target.port}.\n`,
    );
  } finally {
    await sql.end();
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  runAutomationMigration().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
