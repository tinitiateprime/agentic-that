import crypto from "node:crypto";
import { redirect } from "next/navigation";
import {
  SERVICE_AUDIENCE_RESOURCES,
  accessSatisfies,
  fullAccessMap,
  isKnownAccessResource,
} from "../access-catalog.js";
import { evaluateAccess } from "./access-policy.js";
import { resolveBillingStatus, selfServiceRoleGrants } from "./billing-policy.js";
import {
  getCurrentPlatformUser,
  getPlatformSql,
  refreshPlatformBillingState,
} from "./auth-store.js";
import { signServiceAccessToken } from "../../../lib/service-access-token.js";

export class AccessDeniedError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function rbacEnforcementMode() {
  return process.env.RBAC_ENFORCEMENT_MODE?.trim().toLowerCase() === "shadow" ? "shadow" : "enforce";
}

function activeStatus(status) {
  return status === "active";
}

export async function getPrincipalForUser(inputUser) {
  if (!inputUser?.id) return null;

  if (!process.env.DATABASE_URL?.trim() && !process.env.SUPABASE_DB_URL?.trim()) {
    const status = inputUser.status || "active";
    const isGlobalAdmin = Boolean(inputUser.isGlobalAdmin);
    const billingStatus = resolveBillingStatus(inputUser.billingStatus, inputUser.trialEndsAt);
    const roleGrants = selfServiceRoleGrants({
      selectedRoleIds: inputUser.selectedRoleIds,
      billingStatus: inputUser.billingStatus,
      trialEndsAt: inputUser.trialEndsAt,
    });
    return {
      userId: String(inputUser.id),
      workspaceId: inputUser.workspaceId || null,
      name: inputUser.name || "Workspace user",
      email: inputUser.email || "",
      businessName: inputUser.businessName || inputUser.name || "Workspace",
      status,
      isGlobalAdmin,
      billingStatus,
      trialStartsAt: inputUser.trialStartsAt || null,
      trialEndsAt: inputUser.trialEndsAt || null,
      access: evaluateAccess({ roleGrants, active: activeStatus(status), globalAdmin: isGlobalAdmin }),
    };
  }

  const sql = await getPlatformSql();
  await refreshPlatformBillingState(inputUser.id);
  const [user] = await sql`
    SELECT u.id, u.name, u.email, u.business_name, u.status, u.is_global_admin,
           u.billing_status, u.trial_starts_at, u.trial_ends_at,
           COALESCE(m.workspace_id, u.workspace_id) AS workspace_id
      FROM platform_users u
      LEFT JOIN workspace_memberships m ON m.user_id = u.id AND m.status = 'active'
     WHERE u.id = ${String(inputUser.id)}
     LIMIT 1`;
  if (!user) return null;

  const roleGrants = await sql`
    SELECT e.role_id, g.resource_key, g.access_level
      FROM user_role_entitlements e
      JOIN rbac_role_grants g ON g.role_id = e.role_id
     WHERE e.user_id = ${String(user.id)}
       AND e.status = 'active'
       AND e.starts_at <= now()
       AND (e.expires_at IS NULL OR e.expires_at > now())`;
  const status = String(user.status || "active");
  const isGlobalAdmin = Boolean(user.is_global_admin);
  return {
    userId: String(user.id),
    workspaceId: user.workspace_id ? String(user.workspace_id) : null,
    name: String(user.name || "Workspace user"),
    email: String(user.email || ""),
    businessName: String(user.business_name || user.name || "Workspace"),
    status,
    isGlobalAdmin,
    billingStatus: String(user.billing_status || "active"),
    trialStartsAt: user.trial_starts_at || null,
    trialEndsAt: user.trial_ends_at || null,
    access: evaluateAccess({
      roleGrants,
      active: activeStatus(status),
      globalAdmin: isGlobalAdmin,
    }),
  };
}

export async function getCurrentPrincipal() {
  return getPrincipalForUser(await getCurrentPlatformUser());
}

export function principalHasAccess(principal, resourceKey, requiredLevel = "view") {
  if (!principal || !activeStatus(principal.status) || !principal.workspaceId) return false;
  if (!isKnownAccessResource(resourceKey)) return false;
  return accessSatisfies(principal.access?.[resourceKey] || "none", requiredLevel);
}

export async function recordAccessAudit({ actorUserId = null, targetType, targetId = null, action, before = null, after = null }) {
  if (!process.env.DATABASE_URL?.trim() && !process.env.SUPABASE_DB_URL?.trim()) return;
  const sql = await getPlatformSql();
  await sql`
    INSERT INTO rbac_audit_events
      (id, actor_user_id, target_type, target_id, action, before_value, after_value)
    VALUES
      (${crypto.randomUUID()}, ${actorUserId}, ${targetType}, ${targetId}, ${action},
       ${before ? sql.json(before) : null}, ${after ? sql.json(after) : null})`;
}

async function recordShadowDenial(principal, resourceKey, requiredLevel) {
  console.warn("RBAC shadow denial", {
    userId: principal?.userId || null,
    workspaceId: principal?.workspaceId || null,
    resourceKey,
    requiredLevel,
  });
}

export async function assertPrincipalAccess(principal, resourceKey, requiredLevel = "view") {
  if (!principal) throw new AccessDeniedError(401, "UNAUTHENTICATED", "Sign in to continue.");
  if (principal.status === "pending") {
    throw new AccessDeniedError(403, "APPROVAL_PENDING", "Your account is waiting for approval.");
  }
  if (principal.status !== "active") {
    throw new AccessDeniedError(403, "ACCOUNT_DISABLED", "This account is not active.");
  }
  if (!principal.workspaceId) {
    throw new AccessDeniedError(403, "WORKSPACE_REQUIRED", "This account is not assigned to a workspace.");
  }
  if (!principalHasAccess(principal, resourceKey, requiredLevel)) {
    if (rbacEnforcementMode() === "shadow") {
      await recordShadowDenial(principal, resourceKey, requiredLevel);
      return principal;
    }
    throw new AccessDeniedError(403, "ACCESS_DENIED", `Your role does not include ${requiredLevel} access to ${resourceKey}.`);
  }
  return principal;
}

export async function requireAccess(resourceKey, requiredLevel = "view", returnTo = "/apps") {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect(`/?auth=login&next=${encodeURIComponent(returnTo)}`);
  if (principal.status === "pending") redirect("/pending-approval");
  try {
    return await assertPrincipalAccess(principal, resourceKey, requiredLevel);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      redirect(`/access-denied?resource=${encodeURIComponent(resourceKey)}&level=${encodeURIComponent(requiredLevel)}`);
    }
    throw error;
  }
}

export async function requireGlobalAdmin() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/?auth=login&next=/admin-center");
  if (principal.status === "pending") redirect("/pending-approval");
  if (principal.status !== "active" || !principal.isGlobalAdmin) redirect("/access-denied?resource=admin-center");
  return principal;
}

export async function authorizeGlobalAdminApi() {
  const principal = await getCurrentPrincipal();
  if (!principal) throw new AccessDeniedError(401, "UNAUTHENTICATED", "Sign in to continue.");
  if (principal.status !== "active" || !principal.isGlobalAdmin) {
    throw new AccessDeniedError(403, "ADMIN_REQUIRED", "Global administrator access is required.");
  }
  return principal;
}

export function accessErrorResponse(error) {
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  throw error;
}

export async function authorizeApiAccess(resourceKey, requiredLevel = "view") {
  const principal = await getCurrentPrincipal();
  return assertPrincipalAccess(principal, resourceKey, requiredLevel);
}

export async function issueServiceToken(principal, audience) {
  const resources = SERVICE_AUDIENCE_RESOURCES[audience];
  if (!resources) throw new AccessDeniedError(400, "INVALID_AUDIENCE", "Unknown service audience.");
  await assertPrincipalAccess(principal, resources[0], "view").catch(async (firstError) => {
    const allowed = resources.some((resource) => principalHasAccess(principal, resource, "view"));
    if (!allowed) throw firstError;
  });
  const grants = Object.fromEntries(resources.map((resource) => [resource, principal.access?.[resource] || "none"]));
  return signServiceAccessToken({
    audience,
    subject: principal.userId,
    workspaceId: principal.workspaceId,
    grants,
    name: principal.name,
    email: principal.email,
  });
}

export function legacyFullAccessPrincipal(user) {
  return {
    userId: String(user.id),
    workspaceId: user.workspaceId,
    name: user.name,
    email: user.email,
    businessName: user.businessName,
    status: "active",
    isGlobalAdmin: false,
    billingStatus: "exempt",
    trialStartsAt: null,
    trialEndsAt: null,
    access: fullAccessMap(),
  };
}
