import { SELF_SERVICE_ROLE_CATALOG } from "../access-catalog.js";

const EXPIRING_BILLING_STATUSES = new Set(["trialing", "payment_pending", "past_due"]);

export function resolveBillingStatus(statusInput, trialEndsAt, nowMs = Date.now()) {
  const status = String(statusInput || "active");
  const endsAtMs = trialEndsAt ? new Date(trialEndsAt).getTime() : Number.NaN;
  if (EXPIRING_BILLING_STATUSES.has(status) && Number.isFinite(endsAtMs) && endsAtMs <= nowMs) {
    return "expired";
  }
  return status;
}

export function selfServiceRoleGrants({ selectedRoleIds = [], billingStatus, trialEndsAt, nowMs = Date.now() }) {
  const status = resolveBillingStatus(billingStatus, trialEndsAt, nowMs);
  const trialStillActive = trialEndsAt && new Date(trialEndsAt).getTime() > nowMs;
  if (status !== "active" && !trialStillActive) return [];
  const selected = new Set(selectedRoleIds.map(String));
  return SELF_SERVICE_ROLE_CATALOG
    .filter((role) => selected.has(role.id))
    .flatMap((role) => role.grants.map((grant) => ({ ...grant, roleId: role.id })));
}
