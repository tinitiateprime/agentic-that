import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configManager = await readFile(path.join(projectRoot, "app", "config-manager", "ConfigManager.jsx"), "utf8");
const dashboard = await readFile(path.join(projectRoot, "services", "publishing", "queue-runner", "src", "App.tsx"), "utf8");
const companionServer = await readFile(path.join(projectRoot, "services", "publishing", "queue-runner", "server", "index.ts"), "utf8");

test("publishing account setup exposes Server Worker and Local Companion as separate engines", () => {
  assert.match(configManager, /setExecutionEngine\("server_worker"\)/);
  assert.match(configManager, /setExecutionEngine\("companion"\)/);
  assert.match(configManager, /The engine is fixed for this account/);
});

test("Companion pairing stays transient in the dashboard and synchronizes through the authenticated local service", () => {
  assert.match(configManager, /publishingRequest\("\/api\/companion\/pair"/);
  assert.match(configManager, /companionPublishingRequest\("\/api\/companion\/pair"/);
  assert.match(configManager, /companionPublishingRequest\("\/api\/companion\/sync"/);
  assert.doesNotMatch(configManager, /localStorage\.setItem\([^\n]*pairingToken/);
  assert.match(companionServer, /app\.post\("\/api\/companion\/sync", requireRoles\("operations_manager"\)/);
});

test("central publishing dashboard retains both Companion and Server Worker accounts", () => {
  assert.match(dashboard, /api\.accounts\(\)/);
  assert.match(dashboard, /\.\.\.companionAccounts\.filter\(account => account\.executionEngine !== 'server_worker'\)/);
  assert.match(dashboard, /\.\.\.availableServerAccounts/);
});
