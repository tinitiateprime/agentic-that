import crypto from "node:crypto";
import { redirect } from "next/navigation";
import {
  OPERATIONAL_ROLE_CATALOG,
  SERVICE_AUDIENCE_CAPABILITIES,
  SERVICE_AUDIENCE_RESOURCES,
  accessCategory,
  accessSatisfies,
  capabilityModule,
  fullAccessMap,
  isKnownAccessResource,
} from "../access-catalog.js";
import { evaluateAccess, evaluateCapabilities } from "./access-policy.js";
import { resolveBillingStatus, selfServiceRoleGrants } from "./billing-policy.js";
import {
  getCurrentPlatformUser,
  getPlatformSql,
  activateWorkspaceTrial,
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

function localOperationalRoleGrants(inputUser) {
  const selected = new Set(Array.isArray(inputUser?.assignedRoleIds) ? inputUser.assignedRoleIds.map(String) : []);
  if (inputUser?.isWorkspaceOwner) selected.add("role_workspace_owner");
  return OPERATIONAL_ROLE_CATALOG
    .filter((role) => selected.has(role.id))
    .flatMap((role) => role.grants.map((grant) => ({ ...grant, roleId: role.id })));
}

function capabilitiesWithinAccess(capabilities, access) {
  return capabilities.filter((capability) => {
    const module = capabilityModule(capability);
    return module === "workspace" || accessSatisfies(access?.[module] || "none", "view");
  });
}

async function activateTrialOnServiceUse(principal, serviceKey) {
  if (
    !principal
    || principal.billingStatus !== "trialing"
    || principal.trialStartsAt
    || !principal.workspaceId
    || accessCategory(serviceKey) === "workspace"
  ) return principal;
  const activated = await activateWorkspaceTrial(principal.workspaceId, principal.userId);
  return activated ? { ...principal, ...activated } : principal;
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
    const operationalRoleGrants = localOperationalRoleGrants(inputUser);
    const access = evaluateAccess({ roleGrants, active: activeStatus(status), globalAdmin: isGlobalAdmin });
    const operationalCapabilities = evaluateCapabilities({ roleGrants: operationalRoleGrants, active: activeStatus(status), globalAdmin: isGlobalAdmin });
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
      access,
      capabilities: capabilitiesWithinAccess(operationalCapabilities, access),
      roleIds: [...new Set(operationalRoleGrants.map((grant) => grant.roleId))],
    };
  }

  const sql = await getPlatformSql();
  let [user] = await sql`
    SELECT u.id, u.name, u.email, u.business_name, u.status, u.is_global_admin,
           u.billing_status, u.trial_starts_at, u.trial_ends_at,
           m.workspace_id AS workspace_id
      FROM platform_users u
      LEFT JOIN workspace_memberships m ON m.user_id = u.id AND m.status = 'active'
     WHERE u.id = ${String(inputUser.id)}
     LIMIT 1`;
  if (!user) return null;

  const [workspaceOwner] = user.workspace_id ? await sql`
    SELECT owner.id, owner.billing_status, owner.trial_starts_at, owner.trial_ends_at
      FROM workspace_memberships membership
      JOIN user_role_assignments assignment
        ON assignment.user_id = membership.user_id AND assignment.role_id = 'role_workspace_owner'
      JOIN platform_users owner ON owner.id = membership.user_id
     WHERE membership.workspace_id = ${String(user.workspace_id)}
       AND membership.status = 'active'
       AND owner.status = 'active'
     ORDER BY membership.approved_at NULLS LAST, membership.created_at
     LIMIT 1` : [];
  // Billing belongs to the workspace, not to whichever person currently holds
  // the operational owner role. Keeping the entitlement holder independent
  // lets an owner hand off team administration without removing the workspace's
  // paid or trial access.
  const [workspaceBillingCandidate] = user.workspace_id ? await sql`
    SELECT membership.user_id AS id
      FROM workspace_memberships membership
      JOIN platform_users candidate ON candidate.id = membership.user_id
      JOIN user_role_entitlements entitlement ON entitlement.user_id = membership.user_id
     WHERE membership.workspace_id = ${String(user.workspace_id)}
       AND membership.status = 'active'
       AND candidate.status = 'active'
     ORDER BY CASE entitlement.status WHEN 'active' THEN 0 ELSE 1 END,
              CASE entitlement.source WHEN 'payment' THEN 0 ELSE 1 END,
              entitlement.expires_at DESC NULLS FIRST,
              membership.created_at
     LIMIT 1` : [];
  const billingUserId = workspaceBillingCandidate?.id || workspaceOwner?.id || user.id;
  await refreshPlatformBillingState(billingUserId);
  const [workspaceBillingUser] = await sql`
    SELECT id, billing_status, trial_starts_at, trial_ends_at
      FROM platform_users
     WHERE id = ${String(billingUserId)}
     LIMIT 1`;

  let moduleRoleGrants = user.workspace_id ? await sql`
    SELECT entitlement.role_id, role_grant.resource_key, role_grant.access_level
      FROM workspace_memberships membership
      JOIN user_role_entitlements entitlement ON entitlement.user_id = membership.user_id
      JOIN rbac_role_grants role_grant ON role_grant.role_id = entitlement.role_id
     WHERE membership.workspace_id = ${String(user.workspace_id)}
       AND membership.status = 'active'
       AND entitlement.status = 'active'
       AND entitlement.starts_at <= now()
       AND (entitlement.expires_at IS NULL OR entitlement.expires_at > now())` : [];
  // Existing single-user accounts created before workspace ownership was
  // introduced retain their current module access until the owner backfill runs.
  if (!moduleRoleGrants.length) moduleRoleGrants = await sql`
    SELECT e.role_id, g.resource_key, g.access_level
      FROM user_role_entitlements e
      JOIN rbac_role_grants g ON g.role_id = e.role_id
     WHERE e.user_id = ${String(user.id)}
       AND e.status = 'active'
       AND e.starts_at <= now()
       AND (e.expires_at IS NULL OR e.expires_at > now())`;
  const operationalRoleGrants = await sql`
    SELECT assignment.role_id, role_grant.resource_key, role_grant.access_level
      FROM user_role_assignments assignment
      JOIN rbac_role_grants role_grant ON role_grant.role_id = assignment.role_id
     WHERE assignment.user_id = ${String(user.id)}`;
  const status = String(user.status || "active");
  const isGlobalAdmin = Boolean(user.is_global_admin);
  const billingUser = workspaceBillingUser || workspaceOwner || user;
  const access = evaluateAccess({
    roleGrants: moduleRoleGrants,
    active: activeStatus(status),
    globalAdmin: isGlobalAdmin,
  });
  const operationalCapabilities = evaluateCapabilities({
    roleGrants: operationalRoleGrants,
    active: activeStatus(status),
    globalAdmin: isGlobalAdmin,
  });
  return {
    userId: String(user.id),
    workspaceId: user.workspace_id ? String(user.workspace_id) : null,
    name: String(user.name || "Workspace user"),
    email: String(user.email || ""),
    businessName: String(user.business_name || user.name || "Workspace"),
    status,
    isGlobalAdmin,
    billingStatus: String(billingUser.billing_status || "active"),
    trialStartsAt: billingUser.trial_starts_at || null,
    trialEndsAt: billingUser.trial_ends_at || null,
    access,
    capabilities: capabilitiesWithinAccess(operationalCapabilities, access),
    roleIds: [...new Set(operationalRoleGrants.map((grant) => String(grant.role_id)))],
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

export function principalHasCapability(principal, capability) {
  if (!principal || !activeStatus(principal.status) || !principal.workspaceId) return false;
  if (!Array.isArray(principal.capabilities) || !principal.capabilities.includes(capability)) return false;
  const module = capabilityModule(capability);
  if (!module || module === "workspace") return true;
  return accessSatisfies(principal.access?.[module] || "none", "view");
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
      return activateTrialOnServiceUse(principal, resourceKey);
    }
    throw new AccessDeniedError(403, "ACCESS_DENIED", `Your role does not include ${requiredLevel} access to ${resourceKey}.`);
  }
  return activateTrialOnServiceUse(principal, resourceKey);
}

export async function assertPrincipalCapability(principal, capability) {
  if (!principal) throw new AccessDeniedError(401, "UNAUTHENTICATED", "Sign in to continue.");
  if (principal.status !== "active") {
    throw new AccessDeniedError(403, "ACCOUNT_DISABLED", "This account is not active.");
  }
  if (!principal.workspaceId) {
    throw new AccessDeniedError(403, "WORKSPACE_REQUIRED", "This account is not assigned to a workspace.");
  }
  if (!principalHasCapability(principal, capability)) {
    if (rbacEnforcementMode() === "shadow") {
      await recordShadowDenial(principal, capability, "capability");
      return activateTrialOnServiceUse(principal, capability);
    }
    throw new AccessDeniedError(403, "CAPABILITY_REQUIRED", `Your role does not include ${capability}.`);
  }
  return activateTrialOnServiceUse(principal, capability);
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

export async function requireCapability(capability, returnTo = "/apps") {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect(`/?auth=login&next=${encodeURIComponent(returnTo)}`);
  if (principal.status === "pending") redirect("/pending-approval");
  try {
    return await assertPrincipalCapability(principal, capability);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      redirect(`/access-denied?capability=${encodeURIComponent(capability)}`);
    }
    throw error;
  }
}

export async function authorizeApiCapability(capability) {
  return assertPrincipalCapability(await getCurrentPrincipal(), capability);
}

export async function issueServiceToken(principal, audience) {
  const resources = SERVICE_AUDIENCE_RESOURCES[audience];
  if (!resources) throw new AccessDeniedError(400, "INVALID_AUDIENCE", "Unknown service audience.");
  const viewerCapability = audience === "publishing"
    ? "publishing.view"
    : audience === "scraping"
      ? "scraping.view"
      : "messaging.view";
  principal = await assertPrincipalCapability(principal, viewerCapability);
  await assertPrincipalAccess(principal, resources[0], "view").catch(async (firstError) => {
    const allowed = resources.some((resource) => principalHasAccess(principal, resource, "view"));
    if (!allowed) throw firstError;
  });
  const grants = Object.fromEntries(resources.map((resource) => [resource, principal.access?.[resource] || "none"]));
  const allowedCapabilities = new Set(SERVICE_AUDIENCE_CAPABILITIES[audience] || []);
  const capabilities = (principal.capabilities || []).filter((capability) => allowedCapabilities.has(capability));
  return signServiceAccessToken({
    audience,
    subject: principal.userId,
    workspaceId: principal.workspaceId,
    grants,
    capabilities,
    billingStatus: principal.billingStatus,
    trialStartsAt: principal.trialStartsAt,
    trialEndsAt: principal.trialEndsAt,
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
    capabilities: OPERATIONAL_ROLE_CATALOG.find((role) => role.id === "role_workspace_owner")?.capabilities || [],
    roleIds: ["role_workspace_owner"],
  };
}
