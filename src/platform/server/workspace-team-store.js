import crypto from "node:crypto";
import { initializeDatabaseDocument } from "../../../lib/database-document-store.js";
import { OPERATIONAL_ROLE_CATALOG, OPERATIONAL_ROLE_IDS } from "../access-catalog.js";
import {
  createPlatformSessionForUser,
  getPlatformSql,
  hashPlatformPassword,
  verifyPlatformPassword,
} from "./auth-store.js";

const INVITATIONS_DOCUMENT_KEY = "platform.workspace-invitations.v1";
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const operationalRoleIds = new Set(OPERATIONAL_ROLE_IDS);

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Enter a valid employee email address.");
  }
  return email;
}

function normalizeRoleIds(value, { allowOwner = true } = {}) {
  const roleIds = [...new Set((Array.isArray(value) ? value : []).map(String))];
  if (!roleIds.length) throw new Error("Assign at least one employee role.");
  if (roleIds.some((roleId) => !operationalRoleIds.has(roleId))) {
    throw new Error("One or more employee roles are invalid.");
  }
  if (!allowOwner && roleIds.includes("role_workspace_owner")) {
    throw new Error("Workspace ownership cannot be assigned by this operation.");
  }
  return roleIds;
}

function invitationsDocument(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.invitations)) {
    return { version: 1, invitations: [] };
  }
  return { version: 1, invitations: value.invitations };
}

async function initializeInvitations() {
  await initializeDatabaseDocument(INVITATIONS_DOCUMENT_KEY, { version: 1, invitations: [] });
}

async function lockInvitations(tx) {
  const [row] = await tx`
    SELECT value
      FROM agentic_that.app_document_store
     WHERE key = ${INVITATIONS_DOCUMENT_KEY}
     FOR UPDATE`;
  return invitationsDocument(row?.value);
}

async function saveInvitations(tx, document) {
  await tx`
    UPDATE agentic_that.app_document_store
       SET value = ${tx.json(document)}, updated_at = now()
     WHERE key = ${INVITATIONS_DOCUMENT_KEY}`;
}

async function audit(tx, actorUserId, targetType, targetId, action, before, after) {
  await tx`
    INSERT INTO rbac_audit_events
      (id, actor_user_id, target_type, target_id, action, before_value, after_value)
    VALUES
      (${crypto.randomUUID()}, ${actorUserId}, ${targetType}, ${targetId}, ${action},
       ${before ? tx.json(before) : null}, ${after ? tx.json(after) : null})`;
}

function publicInvitation(invitation, { includeToken = false } = {}) {
  const { tokenHash: _tokenHash, token: _token, ...safe } = invitation;
  return includeToken ? { ...safe, token: invitation.token } : safe;
}

async function assertRolesExist(tx, roleIds) {
  const rows = await tx`
    SELECT id FROM rbac_roles
     WHERE id = ANY(${roleIds}) AND is_system = true AND is_self_selectable = false`;
  if (rows.length !== roleIds.length) throw new Error("One or more employee roles are unavailable.");
}

async function workspaceMember(tx, workspaceId, userId) {
  const [member] = await tx`
    SELECT u.id, u.name, u.email, u.status, membership.status AS membership_status
      FROM workspace_memberships membership
      JOIN platform_users u ON u.id = membership.user_id
     WHERE membership.workspace_id = ${workspaceId} AND membership.user_id = ${userId}
     LIMIT 1`;
  return member || null;
}

async function isWorkspaceOwner(tx, workspaceId, userId) {
  const [row] = await tx`
    SELECT 1 FROM user_role_assignments
     WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
       AND role_id = 'role_workspace_owner'
     LIMIT 1`;
  return Boolean(row);
}

async function hasOtherActiveMembership(tx, userId, workspaceId) {
  const [row] = await tx`
    SELECT 1 FROM workspace_memberships membership
      JOIN platform_workspaces workspace ON workspace.id = membership.workspace_id AND workspace.status = 'active'
     WHERE membership.user_id = ${userId} AND membership.workspace_id <> ${workspaceId}
       AND membership.status = 'active'
     LIMIT 1`;
  return Boolean(row);
}

// Roles are per company: replacing them never touches the member's roles in
// any other company they belong to.
async function replaceWorkspaceRoles(tx, workspaceId, userId, roleIds, assignedBy) {
  await tx`
    DELETE FROM user_role_assignments
     WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
       AND role_id = ANY(${OPERATIONAL_ROLE_IDS})`;
  for (const roleId of roleIds) {
    await tx`
      INSERT INTO user_role_assignments (user_id, role_id, assigned_by, workspace_id)
      VALUES (${userId}, ${roleId}, ${assignedBy}, ${workspaceId})
      ON CONFLICT DO NOTHING`;
  }
}

async function selectRemainingWorkspace(tx, userId) {
  await tx`
    UPDATE platform_users account
       SET workspace_id = next.workspace_id, business_name = next.name
      FROM (
        SELECT membership.workspace_id, workspace.name
          FROM workspace_memberships membership
          JOIN platform_workspaces workspace ON workspace.id = membership.workspace_id AND workspace.status = 'active'
         WHERE membership.user_id = ${userId} AND membership.status = 'active'
         ORDER BY membership.approved_at NULLS LAST, membership.created_at
         LIMIT 1
      ) next
     WHERE account.id = ${userId}`;
}

async function activeOwnerCount(tx, workspaceId, exceptUserId = "") {
  const [row] = await tx`
    SELECT COUNT(*)::int AS count
      FROM workspace_memberships membership
      JOIN platform_users owner ON owner.id = membership.user_id
      JOIN user_role_assignments assignment
        ON assignment.user_id = membership.user_id AND assignment.role_id = 'role_workspace_owner'
       AND assignment.workspace_id = membership.workspace_id
     WHERE membership.workspace_id = ${workspaceId}
       AND membership.status = 'active'
       AND owner.status = 'active'
       AND (${exceptUserId} = '' OR membership.user_id <> ${exceptUserId})`;
  return Number(row?.count || 0);
}

async function preserveWorkspaceEntitlements(tx, workspaceId, fromUserId) {
  const [successor] = await tx`
    SELECT owner.id
      FROM workspace_memberships membership
      JOIN platform_users owner ON owner.id = membership.user_id
      JOIN user_role_assignments assignment
        ON assignment.user_id = membership.user_id AND assignment.role_id = 'role_workspace_owner'
       AND assignment.workspace_id = membership.workspace_id
     WHERE membership.workspace_id = ${workspaceId}
       AND membership.user_id <> ${fromUserId}
       AND membership.status = 'active'
       AND owner.status = 'active'
     ORDER BY membership.approved_at NULLS LAST, membership.created_at
     LIMIT 1`;
  if (!successor) return;
  await tx`
    INSERT INTO user_role_entitlements
      (user_id, role_id, source, status, starts_at, expires_at, external_ref, created_at, updated_at)
    SELECT ${successor.id}, role_id, source, status, starts_at, expires_at, external_ref, created_at, now()
      FROM user_role_entitlements
     WHERE user_id = ${fromUserId}
    ON CONFLICT (user_id, role_id, source) DO UPDATE SET
      status = CASE
        WHEN EXCLUDED.status = 'active' OR user_role_entitlements.status = 'active' THEN 'active'
        ELSE EXCLUDED.status
      END,
      starts_at = LEAST(user_role_entitlements.starts_at, EXCLUDED.starts_at),
      expires_at = CASE
        WHEN user_role_entitlements.expires_at IS NULL OR EXCLUDED.expires_at IS NULL THEN NULL
        ELSE GREATEST(user_role_entitlements.expires_at, EXCLUDED.expires_at)
      END,
      external_ref = COALESCE(EXCLUDED.external_ref, user_role_entitlements.external_ref),
      updated_at = now()`;
  await tx`
    UPDATE platform_users successor
       SET billing_status = source.billing_status,
           trial_starts_at = source.trial_starts_at,
           trial_ends_at = source.trial_ends_at
      FROM platform_users source
     WHERE successor.id = ${successor.id} AND source.id = ${fromUserId}
       AND EXISTS (SELECT 1 FROM user_role_entitlements WHERE user_id = ${fromUserId})`;
  await tx`DELETE FROM user_role_entitlements WHERE user_id = ${fromUserId}`;
}

export async function workspaceTeamSnapshot(principal) {
  await initializeInvitations();
  const sql = await getPlatformSql();
  const [members, assignments, roles, invitationRow] = await Promise.all([
    sql`
      SELECT u.id, u.name, u.email, u.status, membership.status AS membership_status,
             membership.created_at, membership.approved_at
        FROM workspace_memberships membership
        JOIN platform_users u ON u.id = membership.user_id
       WHERE membership.workspace_id = ${principal.workspaceId}
       ORDER BY membership.created_at`,
    sql`
      SELECT assignment.user_id, assignment.role_id
        FROM user_role_assignments assignment
       WHERE assignment.workspace_id = ${principal.workspaceId}
         AND assignment.role_id = ANY(${OPERATIONAL_ROLE_IDS})`,
    sql`
      SELECT id, name, description
        FROM rbac_roles
       WHERE id = ANY(${OPERATIONAL_ROLE_IDS})
       ORDER BY CASE id
         WHEN 'role_workspace_owner' THEN 0
         WHEN 'role_publishing_manager' THEN 10
         WHEN 'role_publishing_uploader' THEN 11
         WHEN 'role_publishing_scheduler' THEN 12
         WHEN 'role_publishing_viewer' THEN 13
         WHEN 'role_scraping_manager' THEN 20
         WHEN 'role_scraping_operator' THEN 21
         WHEN 'role_scraping_viewer' THEN 22
         ELSE 30 END`,
    sql`SELECT value FROM agentic_that.app_document_store WHERE key = ${INVITATIONS_DOCUMENT_KEY}`,
  ]);
  const document = invitationsDocument(invitationRow[0]?.value);
  const now = Date.now();
  return {
    members: members.map((member) => ({
      id: String(member.id),
      name: member.name,
      email: member.email,
      status: member.membership_status === "active" && member.status === "active" ? "active" : "suspended",
      roleIds: assignments.filter((row) => row.user_id === member.id).map((row) => String(row.role_id)),
      joinedAt: member.approved_at || member.created_at,
    })),
    roles: roles.map((role) => ({ id: String(role.id), name: role.name, description: role.description })),
    invitations: document.invitations
      .filter((invite) => invite.workspaceId === principal.workspaceId)
      .map((invite) => ({
        ...publicInvitation(invite),
        expired: invite.status === "pending" && Date.parse(invite.expiresAt) <= now,
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}

export async function adminWorkspaceInvitationsSnapshot() {
  await initializeInvitations();
  const sql = await getPlatformSql();
  const [row] = await sql`
    SELECT value FROM agentic_that.app_document_store
     WHERE key = ${INVITATIONS_DOCUMENT_KEY}`;
  const now = Date.now();
  return invitationsDocument(row?.value).invitations.map((invitation) => ({
    ...publicInvitation(invitation),
    status: invitation.status === "pending" && Date.parse(invitation.expiresAt) <= now
      ? "expired"
      : invitation.status,
  }));
}

export async function inviteWorkspaceMember(principal, input) {
  await initializeInvitations();
  const sql = await getPlatformSql();
  const email = normalizeEmail(input.email);
  const roleIds = normalizeRoleIds(input.roleIds);
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return sql.begin(async (tx) => {
    await assertRolesExist(tx, roleIds);
    const [existingMember] = await tx`
      SELECT u.id
        FROM platform_users u
        JOIN workspace_memberships membership ON membership.user_id = u.id
       WHERE membership.workspace_id = ${principal.workspaceId} AND LOWER(u.email) = ${email}
       LIMIT 1`;
    if (existingMember) throw new Error("This person is already a workspace member.");
    const document = await lockInvitations(tx);
    const pending = document.invitations.find((invite) =>
      invite.workspaceId === principal.workspaceId && invite.email === email && invite.status === "pending"
    );
    if (pending) throw new Error("A pending invitation already exists for this email.");
    const now = new Date();
    const invitation = {
      id: `invite_${crypto.randomUUID()}`,
      workspaceId: principal.workspaceId,
      email,
      roleIds,
      status: "pending",
      tokenHash: tokenHash(rawToken),
      createdByUserId: principal.userId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
    };
    document.invitations.push(invitation);
    await saveInvitations(tx, document);
    await audit(tx, principal.userId, "workspace_invitation", invitation.id, "invitation.created", null, publicInvitation(invitation));
    return publicInvitation({ ...invitation, token: rawToken }, { includeToken: true });
  });
}

// Details shown in the invitation email: company name, inviter and role names.
export async function workspaceInvitationEmailDetails(principal, roleIds) {
  const sql = await getPlatformSql();
  const [workspace] = await sql`SELECT name FROM platform_workspaces WHERE id = ${principal.workspaceId} LIMIT 1`;
  const [inviter] = await sql`SELECT name FROM platform_users WHERE id = ${principal.userId} LIMIT 1`;
  const roleNames = (roleIds || [])
    .map((roleId) => OPERATIONAL_ROLE_CATALOG.find((role) => role.id === roleId)?.name)
    .filter(Boolean)
    .join(", ");
  return { workspaceName: workspace?.name || "", inviterName: inviter?.name || principal.name || "", roleNames };
}

export async function resendWorkspaceInvitation(principal, invitationId) {
  await initializeInvitations();
  const sql = await getPlatformSql();
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return sql.begin(async (tx) => {
    const document = await lockInvitations(tx);
    const index = document.invitations.findIndex((invite) => invite.id === invitationId && invite.workspaceId === principal.workspaceId);
    if (index < 0) throw new Error("Invitation not found.");
    const before = document.invitations[index];
    if (before.status !== "pending") throw new Error("Only pending invitations can be resent.");
    const now = new Date();
    const after = {
      ...before,
      tokenHash: tokenHash(rawToken),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
    };
    document.invitations[index] = after;
    await saveInvitations(tx, document);
    await audit(tx, principal.userId, "workspace_invitation", invitationId, "invitation.resent", publicInvitation(before), publicInvitation(after));
    return publicInvitation({ ...after, token: rawToken }, { includeToken: true });
  });
}

export async function cancelWorkspaceInvitation(principal, invitationId) {
  await initializeInvitations();
  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    const document = await lockInvitations(tx);
    const index = document.invitations.findIndex((invite) => invite.id === invitationId && invite.workspaceId === principal.workspaceId);
    if (index < 0) throw new Error("Invitation not found.");
    const before = document.invitations[index];
    if (before.status !== "pending") throw new Error("Only pending invitations can be canceled.");
    const after = { ...before, status: "canceled", updatedAt: new Date().toISOString() };
    document.invitations[index] = after;
    await saveInvitations(tx, document);
    await audit(tx, principal.userId, "workspace_invitation", invitationId, "invitation.canceled", publicInvitation(before), publicInvitation(after));
    return publicInvitation(after);
  });
}

async function findInvitation(tx, token) {
  const normalizedToken = String(token || "").trim();
  if (normalizedToken.length < 32) throw new Error("This invitation is invalid.");
  const document = await lockInvitations(tx);
  const hash = tokenHash(normalizedToken);
  const index = document.invitations.findIndex((invite) => invite.tokenHash === hash);
  if (index < 0) throw new Error("This invitation is invalid.");
  const invitation = document.invitations[index];
  if (invitation.status !== "pending") throw new Error("This invitation has already been used or canceled.");
  if (Date.parse(invitation.expiresAt) <= Date.now()) {
    document.invitations[index] = { ...invitation, status: "expired", updatedAt: new Date().toISOString() };
    await saveInvitations(tx, document);
    throw new Error("This invitation has expired. Ask the workspace owner to resend it.");
  }
  return { document, index, invitation };
}

// What the join page shows before accepting: which company, for which email,
// and whether that email already has an AgenticThat account (sign in with the
// existing password) or needs a new one (choose a name and password).
export async function previewWorkspaceInvitation(token) {
  await initializeInvitations();
  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    const { invitation } = await findInvitation(tx, token);
    const [workspace] = await tx`SELECT name FROM platform_workspaces WHERE id = ${invitation.workspaceId} AND status = 'active'`;
    if (!workspace) throw new Error("This workspace is unavailable.");
    const [existing] = await tx`SELECT id FROM platform_users WHERE LOWER(email) = ${invitation.email} LIMIT 1`;
    return { email: invitation.email, workspaceName: workspace.name, existingAccount: Boolean(existing) };
  });
}

export async function acceptWorkspaceInvitation({ token, name, password }) {
  await initializeInvitations();
  const normalizedName = String(name || "").trim();
  const normalizedPassword = String(password || "");
  if (normalizedPassword.length < 1 || normalizedPassword.length > 128) {
    throw new Error("Enter your password.");
  }
  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    const { document, index, invitation } = await findInvitation(tx, token);
    const [workspace] = await tx`SELECT id, name FROM platform_workspaces WHERE id = ${invitation.workspaceId} AND status = 'active'`;
    if (!workspace) throw new Error("This workspace is unavailable.");
    await assertRolesExist(tx, invitation.roleIds);
    const [existing] = await tx`
      SELECT id, password_hash, is_global_admin
        FROM platform_users
       WHERE LOWER(email) = ${invitation.email}
       LIMIT 1`;
    let user;
    if (existing) {
      // An existing account joins this company in addition to the ones it
      // already belongs to. Its password, name and billing stay as they are;
      // the current password proves the person owns the account.
      if (existing.is_global_admin) throw new Error("A platform administrator account cannot be joined through an employee invitation.");
      if (!verifyPlatformPassword(normalizedPassword, existing.password_hash)) {
        throw new Error("That password is incorrect. Use your current AgenticThat password.");
      }
      const [membership] = await tx`
        SELECT status FROM workspace_memberships
         WHERE user_id = ${existing.id} AND workspace_id = ${workspace.id}`;
      if (membership?.status === "active") throw new Error("You are already a member of this workspace.");
      [user] = await tx`
        UPDATE platform_users
           SET workspace_id = ${workspace.id}, business_name = ${workspace.name}
         WHERE id = ${existing.id}
        RETURNING id, workspace_id, name, business_name, email, status, is_global_admin,
                  billing_status, trial_starts_at, trial_ends_at`;
    } else {
      if (normalizedName.length < 2 || normalizedName.length > 80) throw new Error("Enter your full name.");
      if (normalizedPassword.length < 8) throw new Error("Password must contain 8 to 128 characters.");
      [user] = await tx`
        INSERT INTO platform_users
          (id, workspace_id, publishing_workspace_key, name, business_name,
           email, password_hash, status, billing_status)
        VALUES
          (${crypto.randomUUID()}, ${workspace.id}, ${crypto.randomBytes(32).toString("base64url")},
           ${normalizedName}, ${workspace.name}, ${invitation.email},
           ${hashPlatformPassword(normalizedPassword)}, 'active', 'exempt')
        RETURNING id, workspace_id, name, business_name, email, status, is_global_admin,
                  billing_status, trial_starts_at, trial_ends_at`;
    }
    const userId = String(user.id);
    // The invitation link reached this inbox, which proves the address.
    const [verification] = await tx`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'platform_users' AND column_name = 'email_verified_at'`;
    if (verification) {
      await tx`UPDATE platform_users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ${userId}`;
    }
    await tx`
      INSERT INTO workspace_memberships (user_id, workspace_id, status, approved_at, approved_by)
      VALUES (${userId}, ${workspace.id}, 'active', now(), ${invitation.createdByUserId})
      ON CONFLICT (user_id, workspace_id) DO UPDATE SET
        status = 'active', approved_at = now(), approved_by = EXCLUDED.approved_by`;
    await replaceWorkspaceRoles(tx, workspace.id, userId, invitation.roleIds, invitation.createdByUserId);
    const accepted = {
      ...invitation,
      status: "accepted",
      acceptedByUserId: userId,
      acceptedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    document.invitations[index] = accepted;
    await saveInvitations(tx, document);
    await audit(tx, userId, "workspace_invitation", invitation.id, "invitation.accepted", publicInvitation(invitation), publicInvitation(accepted));
    return { token: await createPlatformSessionForUser(tx, userId), user };
  });
}

export async function updateWorkspaceMember(principal, userId, input) {
  const roleIds = normalizeRoleIds(input.roleIds || [], { allowOwner: true });
  const status = input.status === "suspended" ? "suspended" : "active";
  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    const member = await workspaceMember(tx, principal.workspaceId, userId);
    if (!member) throw new Error("Workspace member not found.");
    await assertRolesExist(tx, roleIds);
    const wasOwner = await isWorkspaceOwner(tx, principal.workspaceId, userId);
    const remainsOwner = roleIds.includes("role_workspace_owner") && status === "active";
    if (wasOwner && !remainsOwner && await activeOwnerCount(tx, principal.workspaceId, userId) === 0) {
      throw new Error("The final Workspace Owner cannot be suspended or demoted.");
    }
    await tx`
      UPDATE workspace_memberships SET status = ${status}
       WHERE user_id = ${userId} AND workspace_id = ${principal.workspaceId}`;
    if (status === "active") {
      await tx`
        UPDATE platform_users
           SET billing_status = 'exempt', trial_starts_at = NULL, trial_ends_at = NULL
         WHERE id = ${userId}
           AND billing_status IN ('trialing', 'payment_pending', 'past_due', 'canceled', 'expired')`;
    }
    await replaceWorkspaceRoles(tx, principal.workspaceId, userId, roleIds, principal.userId);
    if (status === "suspended" && !(await hasOtherActiveMembership(tx, userId, principal.workspaceId))) {
      await preserveWorkspaceEntitlements(tx, principal.workspaceId, userId);
      await tx`DELETE FROM platform_sessions WHERE user_id = ${userId}`;
    }
    const after = { status, roleIds };
    await audit(tx, principal.userId, "workspace_member", userId, "member.updated", member, after);
    return { id: userId, ...after };
  });
}

export async function removeWorkspaceMember(principal, userId) {
  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    const member = await workspaceMember(tx, principal.workspaceId, userId);
    if (!member) throw new Error("Workspace member not found.");
    const isOwner = await isWorkspaceOwner(tx, principal.workspaceId, userId);
    if (isOwner && await activeOwnerCount(tx, principal.workspaceId, userId) === 0) {
      throw new Error("The final Workspace Owner cannot be removed.");
    }
    const keepsOtherCompany = await hasOtherActiveMembership(tx, userId, principal.workspaceId);
    await tx`
      DELETE FROM user_role_assignments
       WHERE user_id = ${userId} AND workspace_id = ${principal.workspaceId}
         AND role_id = ANY(${OPERATIONAL_ROLE_IDS})`;
    await tx`DELETE FROM workspace_memberships WHERE user_id = ${userId} AND workspace_id = ${principal.workspaceId}`;
    if (keepsOtherCompany) {
      // The account still belongs to another company: move its selection
      // there and keep its own sessions and billing untouched.
      await selectRemainingWorkspace(tx, userId);
    } else {
      // Keep the historical workspace pointer so later billing-provider events
      // still resolve to this workspace. Active access is determined solely by
      // workspace_memberships, which was removed above.
      await preserveWorkspaceEntitlements(tx, principal.workspaceId, userId);
      await tx`DELETE FROM platform_sessions WHERE user_id = ${userId}`;
    }
    await audit(tx, principal.userId, "workspace_member", userId, "member.removed", member, null);
    return { ok: true };
  });
}

// Companies this account belongs to, for the workspace switcher.
export async function listAccountWorkspaces(principal) {
  const sql = await getPlatformSql();
  const rows = await sql`
    SELECT workspace.id, workspace.name,
           EXISTS (
             SELECT 1 FROM user_role_assignments assignment
              WHERE assignment.user_id = membership.user_id
                AND assignment.workspace_id = membership.workspace_id
                AND assignment.role_id = 'role_workspace_owner'
           ) AS is_owner
      FROM workspace_memberships membership
      JOIN platform_workspaces workspace ON workspace.id = membership.workspace_id AND workspace.status = 'active'
     WHERE membership.user_id = ${principal.userId} AND membership.status = 'active'
     ORDER BY workspace.name`;
  return {
    currentWorkspaceId: principal.workspaceId,
    workspaces: rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      isOwner: Boolean(row.is_owner),
      current: String(row.id) === principal.workspaceId,
    })),
  };
}

// Select another company the account is an active member of. Every product
// reads the current company from platform_users.workspace_id.
export async function switchAccountWorkspace(principal, workspaceIdInput) {
  const workspaceId = String(workspaceIdInput || "").trim();
  if (!workspaceId) throw new Error("Choose a workspace.");
  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    const [target] = await tx`
      SELECT workspace.id, workspace.name
        FROM workspace_memberships membership
        JOIN platform_workspaces workspace ON workspace.id = membership.workspace_id AND workspace.status = 'active'
       WHERE membership.user_id = ${principal.userId} AND membership.workspace_id = ${workspaceId}
         AND membership.status = 'active'
       LIMIT 1`;
    if (!target) throw new Error("You are not a member of that workspace.");
    await tx`
      UPDATE platform_users SET workspace_id = ${target.id}, business_name = ${target.name}
       WHERE id = ${principal.userId}`;
    await audit(tx, principal.userId, "workspace", target.id, "workspace.switched",
      { workspaceId: principal.workspaceId }, { workspaceId: target.id });
    return { id: String(target.id), name: target.name };
  });
}
