import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";

test("server architecture is disabled and loopback-only by default", () => {
  const config = loadAutomationConfig({}, "C:\\workspace");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8800);
  assert.equal(config.executionEnabled, false);
  assert.equal(config.loginEnabled, false);
  assert.equal(config.scrapingEnabled, false);
  assert.equal(config.autoMigrate, false);
  assert.equal(config.databaseUrl, "");
});

test("a public bind requires an explicit safety override", () => {
  assert.throws(
    () => loadAutomationConfig({ SERVER_ARCHITECTURE_HOST: "0.0.0.0" }),
    /Refusing a public automation-server bind/,
  );
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_HOST: "0.0.0.0",
    SERVER_ARCHITECTURE_ALLOW_PUBLIC_BIND: "true",
  });
  assert.equal(config.host, "0.0.0.0");
});

test("invalid ports and database purposes are rejected", () => {
  assert.throws(() => loadAutomationConfig({ SERVER_ARCHITECTURE_PORT: "70000" }), /between 1 and 65535/);
  assert.throws(
    () => loadAutomationConfig({ SERVER_ARCHITECTURE_DATABASE_PURPOSE: "customer" }),
    /development, staging, or production/,
  );
});
