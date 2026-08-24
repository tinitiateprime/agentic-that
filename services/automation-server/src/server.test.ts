import assert from "node:assert/strict";
import type { Server } from "node:http";
import test from "node:test";
import { createAutomationApp } from "./app.ts";
import { loadAutomationConfig } from "./config.ts";
import type { AutomationJobStore } from "./job-store.ts";
import type { AutomationLoginManager } from "./login-manager.ts";
import { developmentConnectPage } from "./development-ui.ts";
import type { AutomationFileStore } from "./profile-store.ts";

async function listen(app: ReturnType<typeof createAutomationApp>) {
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP address.");
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

test("health reports every new execution feature disabled by default", async () => {
  const runtime = await listen(createAutomationApp({
    config: loadAutomationConfig({}),
    databaseReady: false,
    store: null,
    loginManager: null,
  }));
  try {
    const response = await fetch(`${runtime.url}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.features, {
      publishing: false,
      publishingDryRun: false,
      login: false,
      scraping: false,
    });
    assert.equal(body.databaseReady, false);
    assert.equal(body.databaseEngine, "sqlite");
  } finally {
    await runtime.close();
  }
});

test("the local connection page contains a valid website-browser client and no password field", () => {
  const html = developmentConnectPage({
    internalToken: "local-test-token",
    loginEnabled: true,
    publishingDryRunEnabled: true,
  });
  const start = html.indexOf("<script>") + "<script>".length;
  const end = html.lastIndexOf("</script>");
  assert.ok(start >= "<script>".length && end > start);
  assert.doesNotThrow(() => new Function(html.slice(start, end)));
  assert.match(html, /Instagram server browser/);
  assert.doesNotMatch(html, /type=["']password["']/i);
});

test("mutation routes require a token and stay disabled even with a database store", async () => {
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a-long-local-test-token" });
  const fakeStore = {} as AutomationJobStore;
  const runtime = await listen(createAutomationApp({ config, databaseReady: true, store: fakeStore, loginManager: null }));
  try {
    const unauthorized = await fetch(`${runtime.url}/v1/publishing/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(unauthorized.status, 401);

    const disabled = await fetch(`${runtime.url}/v1/publishing/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agenticthat-internal-token": config.internalToken,
      },
      body: "{}",
    });
    assert.equal(disabled.status, 409);
    assert.match((await disabled.json()).error, /Current Companion behavior remains active/);
  } finally {
    await runtime.close();
  }
});

test("enabled local login routes start a workspace-scoped session", async () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a-long-local-test-token",
    SERVER_LOGIN_ENABLED: "true",
  });
  const fakeStore = {} as AutomationJobStore;
  let startedWith: string[] = [];
  const fakeLoginManager = {
    start(workspaceId: string, accountId: string) {
      startedWith = [workspaceId, accountId];
      return { id: "login_test", workspaceId, accountId, state: "STARTING" };
    },
  } as AutomationLoginManager;
  const runtime = await listen(createAutomationApp({
    config,
    databaseReady: true,
    store: fakeStore,
    loginManager: fakeLoginManager,
  }));
  try {
    const response = await fetch(`${runtime.url}/v1/accounts/account_test/login-sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agenticthat-internal-token": config.internalToken,
      },
      body: JSON.stringify({ workspaceId: "workspace_test" }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(startedWith, ["workspace_test", "account_test"]);
    assert.equal((await response.json()).session.state, "STARTING");
  } finally {
    await runtime.close();
  }
});

test("publishing dry-runs are isolated from the disabled live publishing route", async () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a-long-local-test-token",
    SERVER_PUBLISHING_DRY_RUN_ENABLED: "true",
  });
  let requestedMode = "";
  const fakeStore = {
    createPublishingJob(_body: unknown, mode: string) {
      requestedMode = mode;
      return { id: "job_dry_run", executionMode: mode, state: "SCHEDULED" };
    },
  } as unknown as AutomationJobStore;
  const runtime = await listen(createAutomationApp({
    config,
    databaseReady: true,
    store: fakeStore,
    loginManager: null,
  }));
  try {
    const headers = {
      "content-type": "application/json",
      "x-agenticthat-internal-token": config.internalToken,
    };
    const dryRun = await fetch(`${runtime.url}/v1/publishing/dry-runs`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(dryRun.status, 201);
    assert.equal(requestedMode, "DRY_RUN");
    assert.equal((await dryRun.json()).job.executionMode, "DRY_RUN");

    const live = await fetch(`${runtime.url}/v1/publishing/jobs`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(live.status, 409);
  } finally {
    await runtime.close();
  }
});

test("dry-run media uploads require authorization and preserve a decoded display filename", async () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a-long-local-test-token",
    SERVER_PUBLISHING_DRY_RUN_ENABLED: "true",
  });
  let stored: { bytes: Buffer; fileName: string; mimeType: string } | undefined;
  const fakeFiles = {
    async storeDevelopmentMedia(bytes: Buffer, fileName: string, mimeType: string) {
      stored = { bytes, fileName, mimeType };
      return { storageKey: "media_test.jpg", fileName, mimeType, size: bytes.length };
    },
  } as AutomationFileStore;
  const runtime = await listen(createAutomationApp({
    config,
    databaseReady: true,
    store: {} as AutomationJobStore,
    loginManager: null,
    files: fakeFiles,
  }));
  try {
    const response = await fetch(`${runtime.url}/v1/media`, {
      method: "POST",
      headers: {
        "content-type": "image/jpeg",
        "x-agenticthat-internal-token": config.internalToken,
        "x-agenticthat-workspace-id": "workspace_test",
        "x-agenticthat-file-name": encodeURIComponent("test image.jpg"),
      },
      body: Buffer.from([0xff, 0xd8, 0xff]),
    });
    assert.equal(response.status, 201);
    assert.equal(stored?.fileName, "test image.jpg");
    assert.equal(stored?.mimeType, "image/jpeg");
    assert.deepEqual(stored?.bytes, Buffer.from([0xff, 0xd8, 0xff]));
    assert.equal((await response.json()).media.storageKey, "media_test.jpg");
  } finally {
    await runtime.close();
  }
});
