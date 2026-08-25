import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import path from "node:path";
import type { AutomationConfig } from "./config.ts";

export type AutomationDatabase = DatabaseSync;

export function assertSafeAutomationDatabase(config: AutomationConfig) {
  const dataDirectory = path.resolve(config.dataDirectory);
  const databaseFile = path.resolve(config.databaseFile);
  const relative = path.relative(dataDirectory, databaseFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The SQLite database must stay inside the isolated server data directory.");
  }
  if (!/[.](db|sqlite|sqlite3)$/i.test(databaseFile)) {
    throw new Error("SERVER_ARCHITECTURE_DATABASE_FILE must end in .db, .sqlite, or .sqlite3.");
  }

  return {
    file: databaseFile,
    local: true,
  };
}

export function createAutomationDatabase(config: AutomationConfig) {
  const target = assertSafeAutomationDatabase(config);
  const database = new DatabaseSync(target.file);
  chmodSync(target.file, 0o600);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  return database;
}

export function withImmediateTransaction<T>(database: AutomationDatabase, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
