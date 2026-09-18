import assert from "node:assert/strict";
import test from "node:test";
import { verifyServiceAccessToken } from "../../../lib/service-access-token.js";
import { getPrincipalForUser, issueServiceToken, principalHasAccess, principalHasCapability } from "./access-control.js";

test("an expired workspace owner keeps every module and operational capability", async () => {
  const owner = await getPrincipalForUser({
    id: "owner",
    workspaceId: "workspace",
    status: "active",
    isWorkspaceOwner: true,
    assignedRoleIds: ["role_workspace_owner"],
    billingStatus: "expired",
    trialStartsAt: "2026-08-01T00:00:00.000Z",
    trialEndsAt: "2026-08-08T00:00:00.000Z",
  });

  assert.equal(owner.billingStatus, "exempt");
  assert.equal(owner.trialStartsAt, null);
  assert.equal(owner.trialEndsAt, null);
  for (const resource of ["messaging.telegram", "publishing.youtube", "scraping.facebook"]) {
    assert.equal(principalHasAccess(owner, resource, "configure"), true);
  }
  for (const capability of ["workspace.team.manage", "messaging.configure", "publishing.execute", "scraping.run"]) {
    assert.equal(principalHasCapability(owner, capability), true);
  }
  const serviceToken = await issueServiceToken(owner, "scraping");
  const identity = verifyServiceAccessToken(serviceToken, "scraping");
  assert.equal(identity?.billingStatus, "exempt");
  assert.equal(identity?.trialEndsAt, null);
  assert.equal(identity?.grants?.["scraping.facebook"], "configure");
});

test("an inactive owner and an expired non-owner do not inherit owner access", async () => {
  const inactiveOwner = await getPrincipalForUser({
    id: "inactive-owner",
    workspaceId: "workspace",
    status: "suspended",
    isWorkspaceOwner: true,
    assignedRoleIds: ["role_workspace_owner"],
    billingStatus: "expired",
  });
  const member = await getPrincipalForUser({
    id: "member",
    workspaceId: "workspace",
    status: "active",
    isWorkspaceOwner: false,
    assignedRoleIds: ["role_publishing_viewer"],
    billingStatus: "expired",
  });

  assert.equal(principalHasAccess(inactiveOwner, "publishing.youtube"), false);
  assert.equal(principalHasAccess(member, "publishing.youtube"), false);
  assert.equal(member.billingStatus, "expired");
});
