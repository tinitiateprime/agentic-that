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
      instagramPublishing: false,
      publishingDryRun: false,
      publishingPreview: false,
      login: false,
      scraping: false,
    });
    assert.equal(body.databaseReady, false);
    assert.equal(body.databaseEngine, "sqlite");
    assert.equal(body.livePublishingWorkerCount, 0);
  } finally {
    await runtime.close();
  }
});

test("the local connection page contains a valid website-browser client and no password field", () => {
  const html = developmentConnectPage({
    internalToken: "local-test-token",
    loginEnabled: true,
    publishingDryRunEnabled: true,
    publishingPreviewEnabled: true,
    publishingLiveEnabled: true,
  });
  const start = html.indexOf("<script>") + "<script>".length;
  const end = html.lastIndexOf("</script>");
  assert.ok(start >= "<script>".length && end > start);
  assert.doesNotThrow(() => new Function(html.slice(start, end)));
  assert.match(html, /Instagram server browser/);
  assert.match(html, /REAL PUBLISHING/);
  assert.match(html, /Type PUBLISH to continue/);
  assert.match(html, /Scheduled Instagram publishing/);
  assert.match(html, /type="datetime-local"/);
  assert.match(html, /Instagram requires landscape images no wider than 1\.91:1/);
  assert.match(html, /Only a post that is still SCHEDULED can be cancelled|Cancel this scheduled post/);
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

test("publishing checks and previews are isolated from the disabled live publishing route", async () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a-long-local-test-token",
    SERVER_PUBLISHING_DRY_RUN_ENABLED: "true",
    SERVER_PUBLISHING_PREVIEW_ENABLED: "true",
  });
  const requests: Array<{ mode: string; stage: string }> = [];
  const fakeStore = {
    createPublishingJob(_body: unknown, mode: string, stage = "LOCAL") {
      requests.push({ mode, stage });
      return { id: `job_${stage.toLowerCase()}`, executionMode: mode, validationStage: stage, state: "SCHEDULED" };
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
    assert.deepEqual(requests[0], { mode: "DRY_RUN", stage: "LOCAL" });
    assert.equal((await dryRun.json()).job.executionMode, "DRY_RUN");

    const preview = await fetch(`${runtime.url}/v1/publishing/previews`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(preview.status, 201);
    assert.deepEqual(requests[1], { mode: "DRY_RUN", stage: "INSTAGRAM_PREVIEW" });
    assert.equal((await preview.json()).job.validationStage, "INSTAGRAM_PREVIEW");

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

test("live publishing requires both feature gates and an exact final-action confirmation", async () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a-long-local-test-token",
    SERVER_EXECUTION_ENABLED: "true",
    SERVER_INSTAGRAM_PUBLISHING_ENABLED: "true",
  });
  let authorized = false;
  const fakeStore = {
    createPublishingJob(_body: unknown, mode: string, stage: string, liveAuthorized: boolean) {
      authorized = liveAuthorized;
      return { id: "job_live", executionMode: mode, validationStage: stage, liveAuthorized, state: "SCHEDULED" };
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
    const unconfirmed = await fetch(`${runtime.url}/v1/publishing/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ liveConfirmation: "yes" }),
    });
    assert.equal(unconfirmed.status, 400);
    assert.equal(authorized, false);

    const confirmed = await fetch(`${runtime.url}/v1/publishing/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ liveConfirmation: "PUBLISH" }),
    });
    assert.equal(confirmed.status, 201);
    assert.equal(authorized, true);
    assert.equal((await confirmed.json()).job.liveAuthorized, true);
  } finally {
    await runtime.close();
  }
});

test("scheduled publishing jobs can be listed and cancelled only while queued", async () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a-long-local-test-token",
    SERVER_EXECUTION_ENABLED: "true",
    SERVER_INSTAGRAM_PUBLISHING_ENABLED: "true",
  });
  let listedWith: [string, number] | null = null;
  let cancellationState: "CANCELLED" | "CONFLICT" = "CANCELLED";
  const fakeStore = {
    listPublishingJobs(workspaceId: string, limit: number) {
      listedWith = [workspaceId, limit];
      return [{ id: "job_scheduled", workspaceId, state: "SCHEDULED" }];
    },
    cancelScheduledPublishingJob(workspaceId: string, jobId: string) {
      assert.deepEqual([workspaceId, jobId], ["workspace_test", "job_scheduled"]);
      return cancellationState === "CANCELLED"
        ? { status: "CANCELLED", job: { id: jobId, workspaceId, state: "CANCELLED" } }
        : { status: "CONFLICT", job: { id: jobId, workspaceId, state: "PUBLISHING" } };
    },
  } as unknown as AutomationJobStore;
  const runtime = await listen(createAutomationApp({
    config,
    databaseReady: true,
    store: fakeStore,
    loginManager: null,
  }));
  try {
    const headers = { "x-agenticthat-internal-token": config.internalToken };
    const list = await fetch(`${runtime.url}/v1/publishing/jobs?workspaceId=workspace_test&limit=12`, { headers });
    assert.equal(list.status, 200);
    assert.deepEqual(listedWith, ["workspace_test", 12]);
    assert.equal((await list.json()).jobs[0].state, "SCHEDULED");

    const cancelled = await fetch(
      `${runtime.url}/v1/publishing/jobs/job_scheduled?workspaceId=workspace_test`,
      { method: "DELETE", headers },
    );
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).job.state, "CANCELLED");

    cancellationState = "CONFLICT";
    const conflict = await fetch(
      `${runtime.url}/v1/publishing/jobs/job_scheduled?workspaceId=workspace_test`,
      { method: "DELETE", headers },
    );
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).job.state, "PUBLISHING");
  } finally {
    await runtime.close();
  }
});

test("private preview frames are token- and workspace-scoped", async () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a-long-local-test-token",
    SERVER_PUBLISHING_PREVIEW_ENABLED: "true",
  });
  const screenshot = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const fakeStore = {
    getPublishingJob(workspaceId: string, jobId: string) {
      if (workspaceId !== "workspace_test" || jobId !== "job_preview") return null;
      return {
        id: jobId,
        validationStage: "INSTAGRAM_PREVIEW",
        errorCode: "PREVIEW_COMPLETE",
      };
    },
  } as unknown as AutomationJobStore;
  const fakeFiles = {
    async readPublishingPreview(jobId: string) {
      assert.equal(jobId, "job_preview");
      return screenshot;
    },
  } as AutomationFileStore;
  const runtime = await listen(createAutomationApp({
    config,
    databaseReady: true,
    store: fakeStore,
    loginManager: null,
    files: fakeFiles,
  }));
  try {
    const unauthorized = await fetch(`${runtime.url}/v1/publishing/previews/job_preview/frame?workspaceId=workspace_test`);
    assert.equal(unauthorized.status, 401);
    const response = await fetch(`${runtime.url}/v1/publishing/previews/job_preview/frame?workspaceId=workspace_test`, {
      headers: { "x-agenticthat-internal-token": config.internalToken },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), screenshot);
  } finally {
    await runtime.close();
  }
});

test("live publishing diagnostic frames are token- and workspace-scoped", async () => {
  const config = loadAutomationConfig({
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a-long-local-test-token",
    SERVER_EXECUTION_ENABLED: "true",
    SERVER_INSTAGRAM_PUBLISHING_ENABLED: "true",
  });
  const screenshot = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const fakeStore = {
    getPublishingJob(workspaceId: string, jobId: string) {
      if (workspaceId !== "workspace_test" || jobId !== "job_uncertain") return null;
      return { id: jobId, executionMode: "LIVE", state: "UNCERTAIN" };
    },
  } as unknown as AutomationJobStore;
  const fakeFiles = {
    async readPublishingPreview(jobId: string) {
      assert.equal(jobId, "job_uncertain");
      return screenshot;
    },
  } as AutomationFileStore;
  const runtime = await listen(createAutomationApp({
    config,
    databaseReady: true,
    store: fakeStore,
    loginManager: null,
    files: fakeFiles,
  }));
  try {
    const url = `${runtime.url}/v1/publishing/jobs/job_uncertain/diagnostic-frame?workspaceId=workspace_test`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, {
      headers: { "x-agenticthat-internal-token": config.internalToken },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), screenshot);
    const wrongWorkspace = await fetch(
      `${runtime.url}/v1/publishing/jobs/job_uncertain/diagnostic-frame?workspaceId=other`,
      { headers: { "x-agenticthat-internal-token": config.internalToken } },
    );
    assert.equal(wrongWorkspace.status, 404);
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
