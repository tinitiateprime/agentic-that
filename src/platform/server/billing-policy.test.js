import assert from "node:assert/strict";
import test from "node:test";
import { resolveBillingStatus, selfServiceRoleGrants } from "./billing-policy.js";

const now = Date.parse("2026-08-18T00:00:00.000Z");

test("a selected role grants access during the seven-day trial", () => {
  const grants = selfServiceRoleGrants({
    selectedRoleIds: ["role_self_messaging"],
    billingStatus: "trialing",
    trialEndsAt: "2026-08-19T00:00:00.000Z",
    nowMs: now,
  });
  assert.deepEqual(grants, [{ roleId: "role_self_messaging", resourceKey: "messaging", accessLevel: "configure" }]);
});

test("trial status and selected access expire at the configured end time", () => {
  assert.equal(resolveBillingStatus("trialing", "2026-08-18T00:00:00.000Z", now), "expired");
  assert.deepEqual(selfServiceRoleGrants({
    selectedRoleIds: ["role_self_full_access"],
    billingStatus: "trialing",
    trialEndsAt: "2026-08-18T00:00:00.000Z",
    nowMs: now,
  }), []);
});

test("successful payment keeps the selected roles after the trial date", () => {
  assert.equal(selfServiceRoleGrants({
    selectedRoleIds: ["role_self_publishing"],
    billingStatus: "active",
    trialEndsAt: "2026-08-10T00:00:00.000Z",
    nowMs: now,
  }).length, 1);
});
