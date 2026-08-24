import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";

test("server architecture is disabled and loopback-only by default", () => {
  const config = loadAutomationConfig({}, "C:\\workspace");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8800);
  assert.equal(config.executionEnabled, false);
  assert.equal(config.instagramPublishingEnabled, false);
  assert.equal(config.loginEnabled, false);
  assert.equal(config.scrapingEnabled, false);
  assert.equal(config.publishingDryRunEnabled, false);
  assert.equal(config.publishingPreviewEnabled, false);
  assert.equal(config.workerPollMs, 2_000);
  assert.equal(config.autoMigrate, false);
  assert.equal(config.databaseFile, "C:\\workspace\\.server-data\\automation.db");
  assert.equal(config.loginTimeoutMs, 600_000);
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

test("invalid ports are rejected", () => {
  assert.throws(() => loadAutomationConfig({ SERVER_ARCHITECTURE_PORT: "70000" }), /between 1 and 65535/);
  assert.throws(() => loadAutomationConfig({ SERVER_LOGIN_TIMEOUT_MS: "1000" }), /between 60000 and 1800000/);
  assert.throws(() => loadAutomationConfig({ SERVER_WORKER_POLL_MS: "10" }), /between 250 and 60000/);
});
