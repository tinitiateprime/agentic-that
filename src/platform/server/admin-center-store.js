import crypto from "node:crypto";
import { getPlatformSql, refreshExpiredPlatformTrials } from "./auth-store.js";
import { validateGrantInput } from "./access-policy.js";

function text(value, name, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${name} is required.`);
  return normalized;
}

async function audit(tx, actorUserId, targetType, targetId, action, before, after) {
  await tx`
    INSERT INTO rbac_audit_events
      (id, actor_user_id, target_type, target_id, action, before_value, after_value)
    VALUES
      (${crypto.randomUUID()}, ${actorUserId}, ${targetType}, ${targetId}, ${action},
       ${before ? tx.json(before) : null}, ${after ? tx.json(after) : null})`;
}

export async function adminCenterSnapshot() {
  await refreshExpiredPlatformTrials();
  const sql = await getPlatformSql();
  const [users, workspaces, roles, roleGrants, entitlements, auditEvents, identityReviews] = await Promise.all([
    sql`
      SELECT u.id, u.name, u.email, u.business_name, u.requested_business_name,
             u.status, u.is_global_admin, u.billing_status, u.trial_starts_at, u.trial_ends_at, u.created_at,
             m.workspace_id, w.name AS workspace_name
        FROM platform_users u
        LEFT JOIN workspace_memberships m ON m.user_id = u.id
        LEFT JOIN platform_workspaces w ON w.id = m.workspace_id
       ORDER BY CASE u.status WHEN 'pending' THEN 0 ELSE 1 END, u.created_at DESC`,
    sql`SELECT id, name, status, created_at, updated_at FROM platform_workspaces ORDER BY name`,
    sql`SELECT id, name, description, is_system, is_self_selectable, created_at, updated_at FROM rbac_roles ORDER BY is_system DESC, name`,
    sql`SELECT role_id, resource_key, access_level FROM rbac_role_grants ORDER BY resource_key`,
    sql`
      SELECT user_id, role_id, source, status, starts_at, expires_at
        FROM user_role_entitlements
       ORDER BY created_at DESC`,
    sql`
      SELECT e.id, e.target_type, e.target_id, e.action, e.before_value, e.after_value,
             e.created_at, u.name AS actor_name, u.email AS actor_email
        FROM rbac_audit_events e
        LEFT JOIN platform_users u ON u.id = e.actor_user_id
       ORDER BY e.created_at DESC LIMIT 200`,
    sql`
      SELECT id, product, local_actor_id, local_email, reason, details, status, created_at, resolved_at
        FROM rbac_identity_review_queue
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
       LIMIT 200`,
  ]);

  return {
    users: users.map((user) => ({
      id: String(user.id),
      name: user.name,
      email: user.email,
      businessName: user.business_name,
      requestedBusinessName: user.requested_business_name || user.business_name,
      status: user.status,
      isGlobalAdmin: Boolean(user.is_global_admin),
      billingStatus: user.billing_status,
      trialStartsAt: user.trial_starts_at,
      trialEndsAt: user.trial_ends_at,
      workspaceId: user.workspace_id || null,
      workspaceName: user.workspace_name || null,
      entitlements: entitlements
        .filter((row) => row.user_id === user.id)
        .map((row) => ({
          roleId: row.role_id,
          source: row.source,
          status: row.status,
          startsAt: row.starts_at,
          expiresAt: row.expires_at,
        })),
      createdAt: user.created_at,
    })),
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      status: workspace.status,
      createdAt: workspace.created_at,
      updatedAt: workspace.updated_at,
    })),
    roles: roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: Boolean(role.is_system),
      isSelfSelectable: Boolean(role.is_self_selectable),
      grants: roleGrants
        .filter((grant) => grant.role_id === role.id)
        .map((grant) => ({ resourceKey: grant.resource_key, accessLevel: grant.access_level })),
      createdAt: role.created_at,
      updatedAt: role.updated_at,
    })),
    auditEvents: auditEvents.map((event) => ({
      id: event.id,
      targetType: event.target_type,
      targetId: event.target_id,
      action: event.action,
      before: event.before_value,
      after: event.after_value,
      actorName: event.actor_name || event.actor_email || "System",
      createdAt: event.created_at,
    })),
    identityReviews: identityReviews.map((item) => ({
      id: item.id,
      product: item.product,
      localActorId: item.local_actor_id,
      localEmail: item.local_email,
      reason: item.reason,
      details: item.details || {},
      status: item.status,
      createdAt: item.created_at,
      resolvedAt: item.resolved_at,
    })),
  };
}

export async function updateIdentityReview(actor, reviewIdInput, input) {
  const sql = await getPlatformSql();
  const reviewId = text(reviewIdInput, "Review ID", 300);
  const status = ["pending", "resolved", "dismissed"].includes(input.status) ? input.status : "pending";
  return sql.begin(async (tx) => {
    const [before] = await tx`SELECT * FROM rbac_identity_review_queue WHERE id = ${reviewId}`;
    if (!before) throw new Error("Identity review was not found.");
    await tx`
      UPDATE rbac_identity_review_queue
         SET status = ${status}, resolved_by = ${status === "pending" ? null : actor.userId},
             resolved_at = ${status === "pending" ? null : new Date().toISOString()}
       WHERE id = ${reviewId}`;
    const after = { status, note: String(input.note || "").trim().slice(0, 500) };
    await audit(tx, actor.userId, "identity_review", reviewId, `identity_review.${status}`, before, after);
    return { id: reviewId, ...after };
  });
}

export async function updateAdminUser(actor, userIdInput, input) {
  const sql = await getPlatformSql();
  const userId = text(userIdInput, "User ID", 200);
  return sql.begin(async (tx) => {
    const [before] = await tx`
      SELECT u.id, u.name, u.email, u.business_name, u.requested_business_name,
             u.status, u.is_global_admin, u.created_at, m.workspace_id
        FROM platform_users u
        LEFT JOIN workspace_memberships m ON m.user_id = u.id
       WHERE u.id = ${userId} LIMIT 1`;
    if (!before) throw new Error("User not found.");
    if (before.is_global_admin && input.status && input.status !== "active") {
      throw new Error("Global administrators cannot be disabled from this operation.");
    }

    const status = ["pending", "active", "suspended", "rejected"].includes(input.status)
      ? input.status
      : before.status;
    let workspaceId = input.workspaceId ? String(input.workspaceId) : before.workspace_id;
    if (status === "active" && !before.is_global_admin) {
      if (!workspaceId && input.workspaceName) {
        workspaceId = `workspace_${crypto.randomUUID()}`;
        await tx`
          INSERT INTO platform_workspaces (id, name)
          VALUES (${workspaceId}, ${text(input.workspaceName, "Workspace name", 120)})`;
      }
      if (!workspaceId) throw new Error("Choose or create a workspace before approval.");
      const [workspace] = await tx`SELECT id FROM platform_workspaces WHERE id = ${workspaceId} AND status = 'active'`;
      if (!workspace) throw new Error("The selected workspace is unavailable.");
      await tx`
        INSERT INTO workspace_memberships (user_id, workspace_id, status, approved_at, approved_by)
        VALUES (${userId}, ${workspaceId}, 'active', now(), ${actor.userId})
        ON CONFLICT (user_id) DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          status = 'active',
          approved_at = now(),
         approved_by = EXCLUDED.approved_by`;
      await tx`UPDATE platform_users SET workspace_id = ${workspaceId} WHERE id = ${userId}`;
    }

    await tx`UPDATE platform_users SET status = ${status} WHERE id = ${userId}`;
    if (["suspended", "rejected"].includes(status) || input.revokeSessions === true) {
      await tx`DELETE FROM platform_sessions WHERE user_id = ${userId}`;
    }
    const after = { status, workspaceId, sessionsRevoked: input.revokeSessions === true };
    await audit(tx, actor.userId, "user", userId, before.status === "pending" && status === "active" ? "user.approved" : "user.updated", before, after);
    return after;
  });
}

export async function createWorkspace(actor, input) {
  const sql = await getPlatformSql();
  const workspace = { id: `workspace_${crypto.randomUUID()}`, name: text(input.name, "Workspace name", 120) };
  await sql.begin(async (tx) => {
    await tx`INSERT INTO platform_workspaces (id, name) VALUES (${workspace.id}, ${workspace.name})`;
    await audit(tx, actor.userId, "workspace", workspace.id, "workspace.created", null, workspace);
  });
  return workspace;
}

export async function createRole(actor, input) {
  const sql = await getPlatformSql();
  const role = {
    id: `role_${crypto.randomUUID()}`,
    name: text(input.name, "Role name", 100),
    description: String(input.description || "").trim().slice(0, 500),
    isSelfSelectable: false,
    grants: validateGrantInput(input.grants || []),
  };
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO rbac_roles (id, name, description, is_self_selectable)
      VALUES (${role.id}, ${role.name}, ${role.description}, ${role.isSelfSelectable})`;
    for (const grant of role.grants) {
      await tx`
        INSERT INTO rbac_role_grants (role_id, resource_key, access_level)
        VALUES (${role.id}, ${grant.resourceKey}, ${grant.accessLevel})`;
    }
    await audit(tx, actor.userId, "role", role.id, "role.created", null, role);
  });
  return role;
}

export async function updateRole(actor, roleIdInput, input) {
  const sql = await getPlatformSql();
  const roleId = text(roleIdInput, "Role ID", 200);
  const grants = validateGrantInput(input.grants || []);
  return sql.begin(async (tx) => {
    const [before] = await tx`SELECT * FROM rbac_roles WHERE id = ${roleId}`;
    if (!before) throw new Error("Role not found.");
    if (before.is_system) throw new Error("System roles cannot be edited.");
    const name = text(input.name || before.name, "Role name", 100);
    const description = String(input.description ?? before.description ?? "").trim().slice(0, 500);
    const isSelfSelectable = false;
    await tx`
      UPDATE rbac_roles
         SET name = ${name}, description = ${description}, is_self_selectable = ${isSelfSelectable}, updated_at = now()
       WHERE id = ${roleId}`;
    await tx`DELETE FROM rbac_role_grants WHERE role_id = ${roleId}`;
    for (const grant of grants) {
      await tx`
        INSERT INTO rbac_role_grants (role_id, resource_key, access_level)
        VALUES (${roleId}, ${grant.resourceKey}, ${grant.accessLevel})`;
    }
    const after = { id: roleId, name, description, isSelfSelectable, grants };
    await audit(tx, actor.userId, "role", roleId, "role.updated", before, after);
    return after;
  });
}

export async function deleteRole(actor, roleIdInput) {
  const sql = await getPlatformSql();
  const roleId = text(roleIdInput, "Role ID", 200);
  return sql.begin(async (tx) => {
    const [before] = await tx`SELECT * FROM rbac_roles WHERE id = ${roleId}`;
    if (!before) throw new Error("Role not found.");
    if (before.is_system) throw new Error("System roles cannot be deleted.");
    const [existingEntitlement] = await tx`
      SELECT e.user_id
        FROM user_role_entitlements e
       WHERE e.role_id = ${roleId}
       LIMIT 1`;
    if (existingEntitlement) {
      throw new Error("This role has trial or payment history and cannot be deleted.");
    }
    await tx`DELETE FROM rbac_roles WHERE id = ${roleId}`;
    await audit(tx, actor.userId, "role", roleId, "role.deleted", before, null);
    return { ok: true };
  });
}
