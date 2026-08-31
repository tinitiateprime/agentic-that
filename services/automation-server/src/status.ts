import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase } from "./database.ts";
import { automationPostgresReady, closeAutomationPostgres, createAutomationPostgres } from "./postgres-database.ts";

export async function automationQueueStatus() {
  const config = loadAutomationConfig();
  if (config.databaseEngine === "postgres") {
    const database = createAutomationPostgres(config);
    try {
      if (!await automationPostgresReady(database)) throw new Error("The automation PostgreSQL schema is not ready.");
      const active = await database<{ state: string; count: string }[]>`
        SELECT state, COUNT(*)::text AS count
        FROM publishing_jobs
        WHERE state IN ('SCHEDULED', 'PUBLISHING', 'VERIFYING')
        GROUP BY state ORDER BY state
      `;
      return {
        ok: true,
        databaseEngine: "postgres" as const,
        safeToRestart: !active.some(item => item.state === "PUBLISHING" || item.state === "VERIFYING"),
        active: active.map(item => ({ state: item.state, count: Number(item.count) })),
      };
    } finally {
      await closeAutomationPostgres(database);
    }
  }
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
    automationQueueStatus().then(status => {
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
