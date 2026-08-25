import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";

test("server architecture is disabled and loopback-only by default", () => {
  const workspace = path.resolve("test-workspace");
  const config = loadAutomationConfig({}, workspace);
  assert.equal(config.deploymentMode, "development");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8800);
  assert.equal(config.executionEnabled, false);
  assert.equal(config.instagramPublishingEnabled, false);
  assert.equal(config.loginEnabled, false);
  assert.equal(config.scrapingEnabled, false);
  assert.equal(config.publishingDryRunEnabled, false);
  assert.equal(config.publishingPreviewEnabled, false);
  assert.equal(config.workerPollMs, 2_000);
  assert.equal(config.liveWorkerCount, 1);
  assert.equal(config.autoMigrate, false);
  assert.equal(config.databaseFile, path.join(workspace, ".server-data", "automation.db"));
  assert.equal(config.loginTimeoutMs, 600_000);
});

test("staging requires loopback, strong secrets, absolute storage, and automatic migrations", () => {
  const dataDirectory = path.resolve(".test-automation-staging");
  const base = {
    SERVER_ARCHITECTURE_DEPLOYMENT: "staging",
    SERVER_ARCHITECTURE_HOST: "127.0.0.1",
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a".repeat(32),
    SERVER_ARCHITECTURE_DATA_DIR: dataDirectory,
    SERVER_ARCHITECTURE_DATABASE_FILE: path.join(dataDirectory, "automation.db"),
    SERVER_ARCHITECTURE_AUTO_MIGRATE: "true",
  };
  const config = loadAutomationConfig(base);
  assert.equal(config.deploymentMode, "staging");
  assert.equal(config.dataDirectory, dataDirectory);

  assert.throws(
    () => loadAutomationConfig({ ...base, SERVER_ARCHITECTURE_INTERNAL_TOKEN: "short" }),
    /at least 32 characters/,
  );
  assert.throws(
    () => loadAutomationConfig({ ...base, SERVER_ARCHITECTURE_DATA_DIR: ".server-data" }),
    /absolute SERVER_ARCHITECTURE_DATA_DIR/,
  );
  assert.throws(
    () => loadAutomationConfig({ ...base, SERVER_ARCHITECTURE_AUTO_MIGRATE: "false" }),
    /AUTO_MIGRATE=true/,
  );
  assert.throws(
    () => loadAutomationConfig({ ...base, SERVER_LOGIN_ENABLED: "true", SERVER_BROWSER_EXECUTABLE_PATH: "chrome" }),
    /absolute SERVER_BROWSER_EXECUTABLE_PATH/,
  );
});

test("customer production remains blocked until durable encrypted storage exists", () => {
  assert.throws(
    () => loadAutomationConfig({ SERVER_ARCHITECTURE_DEPLOYMENT: "production" }),
    /PostgreSQL and encrypted browser-profile storage/,
  );
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
  assert.throws(() => loadAutomationConfig({ SERVER_LIVE_WORKER_COUNT: "0" }), /between 1 and 8/);
  assert.throws(() => loadAutomationConfig({ SERVER_LIVE_WORKER_COUNT: "9" }), /between 1 and 8/);
  assert.equal(loadAutomationConfig({ SERVER_LIVE_WORKER_COUNT: "4" }).liveWorkerCount, 4);
});
