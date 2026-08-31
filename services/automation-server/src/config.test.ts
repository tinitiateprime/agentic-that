import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadAutomationConfig } from "./config.ts";

test("server architecture is disabled and loopback-only by default", () => {
  const workspace = path.resolve("test-workspace");
  const config = loadAutomationConfig({}, workspace);
  assert.equal(config.deploymentMode, "development");
  assert.equal(config.databaseEngine, "sqlite");
  assert.equal(config.storageBackend, "local");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8800);
  assert.equal(config.executionEnabled, false);
  assert.equal(config.instagramPublishingEnabled, false);
  assert.equal(config.facebookPublishingEnabled, false);
  assert.equal(config.xPublishingEnabled, false);
  assert.equal(config.linkedinPublishingEnabled, false);
  assert.equal(config.youtubePublishingEnabled, false);
  assert.equal(config.loginEnabled, false);
  assert.equal(config.scrapingEnabled, false);
  assert.equal(config.publishingDryRunEnabled, false);
  assert.equal(config.publishingPreviewEnabled, false);
  assert.equal(config.workerPollMs, 2_000);
  assert.equal(config.liveWorkerCount, 1);
  assert.equal(config.mediaUploadMaxBytes, 10 * 1024 * 1024 * 1024);
  assert.equal(config.autoMigrate, false);
  assert.equal(config.profileStorageEncrypted, false);
  assert.equal(config.backupsConfigured, false);
  assert.equal(config.singleHostAcknowledged, false);
  assert.equal(config.databaseFile, path.join(workspace, ".server-data", "automation.db"));
  assert.equal(config.loginTimeoutMs, 600_000);
  assert.equal(config.loginMaxConcurrent, 1);
});

test("staging requires loopback, strong secrets, and absolute temporary storage", () => {
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
  assert.equal(loadAutomationConfig({ ...base, SERVER_ARCHITECTURE_AUTO_MIGRATE: "false" }).autoMigrate, false);
  assert.throws(
    () => loadAutomationConfig({ ...base, SERVER_DATABASE_ENGINE: "postgres", SERVER_AUTOMATION_DATABASE_URL: "" }),
    /requires SERVER_AUTOMATION_DATABASE_URL/,
  );
  assert.throws(
    () => loadAutomationConfig({ ...base, SERVER_LOGIN_ENABLED: "true", SERVER_BROWSER_EXECUTABLE_PATH: "chrome" }),
    /absolute SERVER_BROWSER_EXECUTABLE_PATH/,
  );
});

test("production fails closed without PostgreSQL, Azure storage, encryption, and backups", () => {
  const dataDirectory = path.resolve(".test-automation-production");
  const base = {
    SERVER_ARCHITECTURE_DEPLOYMENT: "production",
    SERVER_ARCHITECTURE_HOST: "127.0.0.1",
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a".repeat(32),
    SERVER_ARCHITECTURE_DATA_DIR: dataDirectory,
    SERVER_ARCHITECTURE_DATABASE_FILE: path.join(dataDirectory, "automation.db"),
    SERVER_DATABASE_ENGINE: "postgres",
    SERVER_AUTOMATION_DATABASE_URL: "postgres://automation:secret@example.invalid:5432/postgres",
    SERVER_STORAGE_BACKEND: "azure",
    AZURE_STORAGE_ACCOUNT_URL: "https://example.blob.core.windows.net",
    AZURE_KEY_VAULT_URL: "https://example.vault.azure.net",
    AZURE_PROFILE_KEY_NAME: "automation-profile-key",
    SERVER_SINGLE_HOST_ACKNOWLEDGED: "true",
    SERVER_PROFILE_STORAGE_ENCRYPTED: "true",
    SERVER_BACKUPS_CONFIGURED: "true",
  };
  assert.throws(
    () => loadAutomationConfig({ ...base, SERVER_PROFILE_STORAGE_ENCRYPTED: "false" }),
    /encrypted-at-rest profile storage/,
  );
  assert.throws(() => loadAutomationConfig({ ...base, SERVER_BACKUPS_CONFIGURED: "false" }), /tested encrypted backups/);
  assert.throws(() => loadAutomationConfig({ ...base, SERVER_SINGLE_HOST_ACKNOWLEDGED: "false" }), /remain single-instance/);
  assert.throws(() => loadAutomationConfig({ ...base, SERVER_DATABASE_ENGINE: "sqlite" }), /requires SERVER_DATABASE_ENGINE=postgres/);
  assert.throws(() => loadAutomationConfig({ ...base, SERVER_STORAGE_BACKEND: "local" }), /requires SERVER_STORAGE_BACKEND=azure/);
  assert.throws(() => loadAutomationConfig({ ...base, SERVER_ARCHITECTURE_AUTO_MIGRATE: "true" }), /must be run explicitly/);
  const config = loadAutomationConfig(base);
  assert.equal(config.deploymentMode, "production");
  assert.equal(config.profileStorageEncrypted, true);
  assert.equal(config.backupsConfigured, true);
  assert.equal(config.databaseEngine, "postgres");
  assert.equal(config.storageBackend, "azure");
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
  assert.throws(() => loadAutomationConfig({ SERVER_LOGIN_MAX_CONCURRENT: "0" }), /between 1 and 4/);
  assert.throws(() => loadAutomationConfig({ SERVER_MEDIA_UPLOAD_MAX_BYTES: "1024" }), /between 8 MB and 256 GB/);
  assert.equal(loadAutomationConfig({ SERVER_LIVE_WORKER_COUNT: "4" }).liveWorkerCount, 4);
});
