import assert from "node:assert/strict";
import test from "node:test";
import { requireScrapingServiceAccess } from "./scraping-service-auth.ts";
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

test("scraping service tokens enforce viewer, operator, and manager boundaries", () => {
  const token = (grant, capabilities) => signServiceAccessToken({
    audience: "scraping",
    subject: `user-${grant}`,
    workspaceId: "workspace-1",
    grants: { "scraping.instagram": grant },
    capabilities,
  });
  const request = (value) => new Request("https://service.example.test", {
    headers: { authorization: `Bearer ${value}` },
  });
  const viewer = request(token("view", ["scraping.view"]));
  const operator = request(token("operate", ["scraping.view", "scraping.run", "scraping.analyze"]));
  const manager = request(token("configure", ["scraping.view", "scraping.run", "scraping.analyze", "scraping.configure"]));

  assert.equal(requireScrapingServiceAccess(viewer, "scraping.instagram", "view").workspaceId, "workspace-1");
  assert.throws(() => requireScrapingServiceAccess(viewer, "scraping.instagram", "operate"), { status: 403 });
  assert.equal(requireScrapingServiceAccess(operator, "scraping.instagram", "operate").workspaceId, "workspace-1");
  assert.throws(() => requireScrapingServiceAccess(operator, "scraping.instagram", "configure"), { status: 403 });
  assert.equal(requireScrapingServiceAccess(manager, "scraping.instagram", "configure").workspaceId, "workspace-1");
  assert.throws(() => requireScrapingServiceAccess(manager, "scraping.facebook", "view"), { status: 403 });
});
