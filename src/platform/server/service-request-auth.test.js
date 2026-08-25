import assert from "node:assert/strict";
import test from "node:test";
import { signServiceAccessToken } from "../../../lib/service-access-token.js";
import { AccessDeniedError, servicePrincipalFromRequest } from "./access-control.js";

function publishingToken() {
  return signServiceAccessToken({
    audience: "publishing",
    subject: "user_1",
    workspaceId: "workspace_1",
    grants: { "publishing.instagram": "configure" },
    capabilities: ["publishing.view", "publishing.execute"],
    name: "Test User",
    email: "test@example.com",
  });
}

test("a signed website service token becomes a scoped request principal", () => {
  const request = new Request("http://localhost/api/publishing/auth/me", {
    headers: { authorization: `Bearer ${publishingToken()}` },
  });
  const principal = servicePrincipalFromRequest(request, "publishing");
  assert.equal(principal.userId, "user_1");
  assert.equal(principal.workspaceId, "workspace_1");
  assert.equal(principal.access["publishing.instagram"], "configure");
  assert.equal(principal.access.publishing, "configure");
  assert.deepEqual(principal.capabilities, ["publishing.view", "publishing.execute"]);
});

test("a service token cannot cross into another service audience", () => {
  const request = new Request("http://localhost/api/scraping", {
    headers: { authorization: `Bearer ${publishingToken()}` },
  });
  assert.throws(
    () => servicePrincipalFromRequest(request, "scraping"),
    error => error instanceof AccessDeniedError && error.code === "INVALID_SERVICE_TOKEN",
  );
});

test("a request without a bearer token may use the normal website cookie fallback", () => {
  assert.equal(servicePrincipalFromRequest(new Request("http://localhost"), "publishing"), null);
});
