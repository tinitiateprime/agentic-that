import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase, createAutomationDatabase } from "./database.ts";
import { automationSchemaReady, migrateAutomationSchema } from "./schema.ts";

test("the default SQLite file stays inside the isolated data directory", () => {
  const workspace = path.resolve("test-workspace");
  const config = loadAutomationConfig({}, workspace);
  const target = assertSafeAutomationDatabase(config);
  assert.equal(target.file, path.join(workspace, ".server-data", "automation.db"));
  assert.equal(target.local, true);
});

test("SQLite files outside the isolated data directory are rejected", () => {
  const workspace = path.resolve("test-workspace");
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_DATA_DIR: ".server-data",
    SERVER_ARCHITECTURE_DATABASE_FILE: "existing-production.db",
  }, workspace);
  assert.throws(() => assertSafeAutomationDatabase(config), /must stay inside/);
});

test("SQLite database filenames require a recognized extension", () => {
  const workspace = path.resolve("test-workspace");
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_DATABASE_FILE: path.join(".server-data", "automation.txt"),
  }, workspace);
  assert.throws(() => assertSafeAutomationDatabase(config), /must end in/);
});

test("migration creates the local SQLite schema", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-sqlite-"));
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATA_DIR: directory }, directory);
  const database = createAutomationDatabase(config);
  try {
    assert.equal(automationSchemaReady(database), false);
    database.exec(`
      CREATE TABLE login_sessions (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, account_id TEXT NOT NULL,
        platform TEXT NOT NULL, state TEXT NOT NULL, error_code TEXT, error_message TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
      )
    `);
    database.exec(`
      CREATE TABLE publishing_jobs (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, state TEXT NOT NULL,
        scheduled_at TEXT NOT NULL, created_at TEXT NOT NULL
      )
    `);
    migrateAutomationSchema(database);
    assert.equal(automationSchemaReady(database), true);
    const columns = database.prepare("PRAGMA table_info(login_sessions)").all() as Array<{ name: string }>;
    assert.equal(columns.some(column => column.name === "surface"), true);
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO social_accounts (id, workspace_id, platform, display_name, created_at, updated_at)
      VALUES ('account_facebook_migration', 'workspace', 'facebook', 'Facebook migration', ?, ?)
    `).run(now, now);
    assert.doesNotThrow(() => database.prepare(`
      INSERT INTO login_sessions
        (id, workspace_id, account_id, platform, surface, state, created_at, updated_at)
      VALUES ('login_facebook_migration', 'workspace', 'account_facebook_migration', 'facebook', 'website', 'STARTING', ?, ?)
    `).run(now, now));
    for (const platform of ["linkedin", "youtube"] as const) {
      database.prepare(`
        INSERT INTO social_accounts (id, workspace_id, platform, display_name, created_at, updated_at)
        VALUES (?, 'workspace', ?, ?, ?, ?)
      `).run(`account_${platform}_migration`, platform, `${platform} migration`, now, now);
      assert.doesNotThrow(() => database.prepare(`
        INSERT INTO login_sessions
          (id, workspace_id, account_id, platform, surface, state, created_at, updated_at)
        VALUES (?, 'workspace', ?, ?, 'website', 'STARTING', ?, ?)
      `).run(`login_${platform}_migration`, `account_${platform}_migration`, platform, now, now));
    }
    database.prepare(`
      INSERT INTO social_accounts (id, workspace_id, platform, display_name, created_at, updated_at)
      VALUES ('account_x_migration', 'workspace', 'x', 'X migration', ?, ?)
    `).run(now, now);
    assert.doesNotThrow(() => database.prepare(`
      INSERT INTO login_sessions
        (id, workspace_id, account_id, platform, surface, state, created_at, updated_at)
      VALUES ('login_x_migration', 'workspace', 'account_x_migration', 'x', 'website', 'STARTING', ?, ?)
    `).run(now, now));
    const publishingColumns = database.prepare("PRAGMA table_info(publishing_jobs)").all() as Array<{ name: string }>;
    assert.equal(publishingColumns.some(column => column.name === "execution_mode"), true);
    assert.equal(publishingColumns.some(column => column.name === "validation_stage"), true);
    assert.equal(publishingColumns.some(column => column.name === "progress_message"), true);
    assert.equal(publishingColumns.some(column => column.name === "live_authorized"), true);
    assert.equal(publishingColumns.some(column => column.name === "platform_options"), true);
    migrateAutomationSchema(database);
    assert.equal(automationSchemaReady(database), true);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
