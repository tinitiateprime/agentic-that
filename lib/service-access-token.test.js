import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { signServiceAccessToken, verifyServiceAccessToken } from "./service-access-token.js";

test("service access tokens are signed and audience bound", () => {
  const token = signServiceAccessToken({
    audience: "telegram",
    subject: "user-1",
    workspaceId: "workspace-1",
    grants: { "messaging.telegram": "operate" },
    capabilities: ["messaging.view", "messaging.operate"],
    billingStatus: "trialing",
    trialStartsAt: "2026-08-18T00:00:00.000Z",
    trialEndsAt: "2026-08-25T00:00:00.000Z",
  });
  const verified = verifyServiceAccessToken(token, "telegram");
  assert.equal(verified?.workspaceId, "workspace-1");
  assert.deepEqual(verified?.capabilities, ["messaging.view", "messaging.operate"]);
  assert.equal(verified?.billingStatus, "trialing");
  assert.equal(verified?.trialEndsAt, "2026-08-25T00:00:00.000Z");
  assert.equal(verifyServiceAccessToken(token, "publishing"), null);
  const forged = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(verifyServiceAccessToken(forged, "telegram"), null);
});

test("unsigned legacy identity blobs are rejected", () => {
  const legacy = Buffer.from(JSON.stringify({ sub: "user-1", workspaceId: "workspace-1", exp: 9999999999 })).toString("base64url");
  assert.equal(verifyServiceAccessToken(legacy, "publishing"), null);
});

test("production service tokens support documented base64 DER keys", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    SERVICE_TOKEN_PRIVATE_KEY: process.env.SERVICE_TOKEN_PRIVATE_KEY,
    SERVICE_TOKEN_PUBLIC_KEY: process.env.SERVICE_TOKEN_PUBLIC_KEY,
  };
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");

  process.env.NODE_ENV = "production";
  process.env.SERVICE_TOKEN_PRIVATE_KEY = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  process.env.SERVICE_TOKEN_PUBLIC_KEY = publicKey.export({ format: "der", type: "spki" }).toString("base64");

  try {
    const token = signServiceAccessToken({
      audience: "telegram",
      subject: "production-user",
      workspaceId: "production-workspace",
      grants: { "messaging.telegram": "operate" },
    });
    assert.equal(verifyServiceAccessToken(token, "telegram")?.workspaceId, "production-workspace");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
