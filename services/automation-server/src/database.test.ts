import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase } from "./database.ts";

test("a dedicated local staging database is accepted", () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_DATABASE_URL: "postgresql://postgres:secret@127.0.0.1:5432/agenticthat_server_staging",
  });
  const target = assertSafeAutomationDatabase(config, {});
  assert.equal(target.database, "agenticthat_server_staging");
  assert.equal(target.local, true);
});

test("the current AgenticThat database cannot be reused", () => {
  const url = "postgresql://postgres:secret@127.0.0.1:5432/agenticthat_server_staging";
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_DATABASE_URL: url });
  assert.throws(() => assertSafeAutomationDatabase(config, { DATABASE_URL: url }), /current AgenticThat database/);
});

test("remote databases require an explicit override", () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_DATABASE_URL: "postgresql://user:secret@db.example.com:5432/agenticthat_server_staging",
  });
  assert.throws(() => assertSafeAutomationDatabase(config, {}), /Refusing a remote automation database/);
});

test("production databases require an exact name confirmation", () => {
  const env = {
    SERVER_ARCHITECTURE_DATABASE_URL: "postgresql://user:secret@db.example.com:5432/agenticthat_server_production",
    SERVER_ARCHITECTURE_DATABASE_PURPOSE: "production",
    SERVER_ARCHITECTURE_ALLOW_REMOTE_DATABASE: "true",
  };
  assert.throws(() => assertSafeAutomationDatabase(loadAutomationConfig(env), {}), /confirmation is missing/);
  const confirmed = loadAutomationConfig({
    ...env,
    SERVER_ARCHITECTURE_CONFIRM_PRODUCTION_DATABASE: "agenticthat_server_production",
  });
  assert.equal(assertSafeAutomationDatabase(confirmed, {}).purpose, "production");
});
