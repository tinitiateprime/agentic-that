import assert from "node:assert/strict";
import test from "node:test";
import { teamTestingFullAccessEnabled } from "./team-testing-access.js";
import { getPrincipalForUser } from "../src/platform/server/access-control.js";

test("team testing access is enabled by default", () => {
  const previous = process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS;
  try {
    delete process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS;
    assert.equal(teamTestingFullAccessEnabled(), true);
    assert.equal(teamTestingFullAccessEnabled(""), true);
    assert.equal(teamTestingFullAccessEnabled("true"), true);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS;
    else process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS = previous;
  }
});

test("team testing access can be disabled with common false values", () => {
  for (const value of ["0", "false", "FALSE", "no", "off", "disabled"]) {
    assert.equal(teamTestingFullAccessEnabled(value), false);
  }
});

test("team testing mode grants all modules without changing operational roles", async () => {
  const previous = process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS;
  const user = {
    id: "testing-user",
    workspaceId: "testing-workspace",
    status: "active",
    billingStatus: "expired",
    trialEndsAt: "2026-08-01T00:00:00.000Z",
    selectedRoleIds: ["role_self_full_access"],
    assignedRoleIds: ["role_publishing_viewer"],
  };

  try {
    process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS = "false";
    const restricted = await getPrincipalForUser(user);
    assert.equal(restricted.billingStatus, "expired");
    assert.equal(restricted.access["publishing.instagram"], "none");

    process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS = "true";
    const testing = await getPrincipalForUser(user);
    assert.equal(testing.billingStatus, "exempt");
    assert.equal(testing.access["publishing.instagram"], "configure");
    assert.equal(testing.access["messaging.telegram"], "configure");
    assert.deepEqual(testing.capabilities, ["publishing.view"]);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS;
    else process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS = previous;
  }
});
