import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { automationServerRequest, resolveAutomationServerBridgeConfig } from "./automation-server-bridge.js";

const token = "a-development-token-that-is-long-enough";

test("server automation dashboard integration is disabled by default", () => {
  assert.equal(resolveAutomationServerBridgeConfig({ NODE_ENV: "development" }), null);
  assert.equal(resolveAutomationServerBridgeConfig({ NODE_ENV: "production" }, {
    SERVER_EXECUTION_ENABLED: "true",
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: token,
  }), null);
});

test("local development may reuse the isolated automation server configuration", () => {
  assert.deepEqual(resolveAutomationServerBridgeConfig({ NODE_ENV: "development" }, {
    SERVER_EXECUTION_ENABLED: "true",
    SERVER_ARCHITECTURE_HOST: "127.0.0.1",
    SERVER_ARCHITECTURE_PORT: "8800",
    SERVER_ARCHITECTURE_INTERNAL_TOKEN: token,
  }), {
    origin: "http://127.0.0.1:8800",
    internalToken: token,
  });
});

test("production server automation requires an explicit HTTPS origin", () => {
  assert.throws(() => resolveAutomationServerBridgeConfig({
    NODE_ENV: "production",
    SERVER_AUTOMATION_DASHBOARD_ENABLED: "true",
    SERVER_AUTOMATION_ORIGIN: "http://worker.example.com",
    SERVER_AUTOMATION_INTERNAL_TOKEN: token,
  }), /HTTPS origin/);
  assert.deepEqual(resolveAutomationServerBridgeConfig({
    NODE_ENV: "production",
    SERVER_AUTOMATION_DASHBOARD_ENABLED: "true",
    SERVER_AUTOMATION_ORIGIN: "https://worker.example.com",
    SERVER_AUTOMATION_INTERNAL_TOKEN: token,
  }), {
    origin: "https://worker.example.com",
    internalToken: token,
  });
});

test("the bridge adds its server-only token and rejects protocol-relative paths", async () => {
  let receivedToken = "";
  const server = createServer((request, response) => {
    receivedToken = String(request.headers["x-agenticthat-internal-token"] || "");
    response.setHeader("content-type", "application/json");
    response.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test bridge did not receive a TCP address.");
    const config = { origin: `http://127.0.0.1:${address.port}`, internalToken: token };
    const response = await automationServerRequest(config, "/health");
    assert.equal(response.status, 200);
    assert.equal(receivedToken, token);
    await assert.rejects(() => automationServerRequest(config, "//untrusted.example"), /path is invalid/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
