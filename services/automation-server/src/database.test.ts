import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase, createAutomationDatabase } from "./database.ts";
import { automationSchemaReady, migrateAutomationSchema } from "./schema.ts";

test("the default SQLite file stays inside the isolated data directory", () => {
  const config = loadAutomationConfig({}, "C:\\workspace");
  const target = assertSafeAutomationDatabase(config);
  assert.equal(target.file, "C:\\workspace\\.server-data\\automation.db");
  assert.equal(target.local, true);
});

test("SQLite files outside the isolated data directory are rejected", () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_DATA_DIR: ".server-data",
    SERVER_ARCHITECTURE_DATABASE_FILE: "existing-production.db",
  }, "C:\\workspace");
  assert.throws(() => assertSafeAutomationDatabase(config), /must stay inside/);
});

test("SQLite database filenames require a recognized extension", () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_DATABASE_FILE: ".server-data\\automation.txt",
  }, "C:\\workspace");
  assert.throws(() => assertSafeAutomationDatabase(config), /must end in/);
});

test("migration creates the local SQLite schema", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-sqlite-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const database = createAutomationDatabase(config);
  try {
    assert.equal(automationSchemaReady(database), false);
    migrateAutomationSchema(database);
    assert.equal(automationSchemaReady(database), true);
    migrateAutomationSchema(database);
    assert.equal(automationSchemaReady(database), true);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
