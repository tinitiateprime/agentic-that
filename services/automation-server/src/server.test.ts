import assert from "node:assert/strict";
import type { Server } from "node:http";
import test from "node:test";
import { createAutomationApp } from "./app.ts";
import { loadAutomationConfig } from "./config.ts";
import type { AutomationJobStore } from "./job-store.ts";

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
  }));
  try {
    const response = await fetch(`${runtime.url}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.features, { publishing: false, login: false, scraping: false });
    assert.equal(body.databaseReady, false);
  } finally {
    await runtime.close();
  }
});

test("mutation routes require a token and stay disabled even with a database store", async () => {
  const config = loadAutomationConfig({ SERVER_ARCHITECTURE_INTERNAL_TOKEN: "a-long-local-test-token" });
  const fakeStore = {} as AutomationJobStore;
  const runtime = await listen(createAutomationApp({ config, databaseReady: true, store: fakeStore }));
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
