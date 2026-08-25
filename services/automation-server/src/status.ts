import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase } from "./database.ts";

export function automationQueueStatus() {
  const config = loadAutomationConfig();
  const target = assertSafeAutomationDatabase(config);
  const database = new DatabaseSync(target.file, { readOnly: true });
  try {
    const active = database.prepare(`
      SELECT state, COUNT(*) AS count
      FROM publishing_jobs
      WHERE state IN ('SCHEDULED', 'PUBLISHING', 'VERIFYING')
      GROUP BY state
      ORDER BY state
    `).all() as Array<{ state: string; count: number }>;
    return {
      ok: true,
      safeToRestart: active.length === 0,
      active,
    };
  } finally {
    database.close();
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  try {
    process.stdout.write(`${JSON.stringify(automationQueueStatus(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
