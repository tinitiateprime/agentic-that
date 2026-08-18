import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentPlatformUser } from "@platform/server/auth-store";
import {
  AccessDeniedError,
  assertPrincipalAccess,
  getCurrentPrincipal,
  requireAccess,
  rbacEnforcementMode,
} from "@platform/server/access-control";
import { getSql } from "./db.js";
import { hashPassword } from "./password.js";

export { hashPassword, verifyPassword } from "./password.js";

const COOKIE_NAME = "session";

// --- Sessions --------------------------------------------------------------
export async function createSession(userId) {
  const sql = await getSql();
  const token = crypto.randomBytes(32).toString("hex");
  await sql`INSERT INTO sessions (token, user_id) VALUES (${token}, ${userId})`;
  return token;
}

export async function destroySession(token) {
  if (!token) return;
  const sql = await getSql();
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

function publicWorkspaceUser(user) {
  return user
    ? { id: user.id, name: user.name, email: user.email, role: user.role, business_id: user.business_id }
    : null;
}

async function ensurePlatformWorkspaceUser(platformUser, legacyUser = null) {
  const sql = await getSql();
  const platformUserId = String(platformUser.id);
  const email = String(platformUser.email || "").trim().toLowerCase();

  const [byPlatformId] = await sql`
    SELECT u.id, u.name, u.email, u.role, u.business_id, b.platform_workspace_id
      FROM users u
      JOIN businesses b ON b.id = u.business_id
     WHERE u.platform_user_id = ${platformUserId} LIMIT 1`;
  if (byPlatformId) {
    if (platformUser.workspaceId) {
      if (byPlatformId.platform_workspace_id && byPlatformId.platform_workspace_id !== platformUser.workspaceId) {
        throw new Error("This WhatsApp identity is mapped to a different AgenticThat workspace. Ask a global administrator to review the mapping.");
      }
      await sql`
        UPDATE businesses SET platform_workspace_id = COALESCE(platform_workspace_id, ${platformUser.workspaceId})
         WHERE id = ${byPlatformId.business_id}`;
    }
    return publicWorkspaceUser(byPlatformId);
  }

  // All central users in one workspace share the same WhatsApp business. The
  // product-local user is retained only as an audit actor and ownership bridge.
  if (platformUser.workspaceId) {
    const [workspaceBusiness] = await sql`
      SELECT id FROM businesses WHERE platform_workspace_id = ${platformUser.workspaceId} LIMIT 1`;
    if (workspaceBusiness) {
      const [existingMember] = await sql`
        SELECT id, name, email, role, business_id
          FROM users
         WHERE business_id = ${workspaceBusiness.id} AND platform_user_id = ${platformUserId}
         LIMIT 1`;
      if (existingMember) return publicWorkspaceUser(existingMember);
      const [emailOwner] = email
        ? await sql`SELECT id FROM users WHERE LOWER(email) = ${email} LIMIT 1`
        : [];
      const workspaceEmail = email && !emailOwner ? email : `${platformUserId}@platform.agenticthat.local`;
      const [created] = await sql`
        INSERT INTO users (business_id, name, email, password_hash, role, platform_user_id)
        VALUES (${workspaceBusiness.id}, ${platformUser.name || "Workspace member"}, ${workspaceEmail},
                ${hashPassword(crypto.randomBytes(48).toString("base64url"))}, 'member', ${platformUserId})
        RETURNING id, name, email, role, business_id`;
      return publicWorkspaceUser(created);
    }
  }

  // An existing WhatsApp-only workspace is linked only when this browser has
  // authenticated to both products. Email alone is not proof of ownership
  // until the main product introduces verified email addresses.
  if (legacyUser?.id) {
    const [legacyBusiness] = await sql`
      SELECT b.platform_workspace_id
        FROM users u JOIN businesses b ON b.id = u.business_id
       WHERE u.id = ${legacyUser.id}`;
    if (legacyBusiness?.platform_workspace_id && legacyBusiness.platform_workspace_id !== platformUser.workspaceId) {
      throw new Error("This WhatsApp session belongs to a different AgenticThat workspace.");
    }
    const [linkedLegacyUser] = await sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE users
           SET platform_user_id = ${platformUserId}
         WHERE id = ${legacyUser.id}
           AND (platform_user_id IS NULL OR platform_user_id = ${platformUserId})
         RETURNING id, name, email, role, business_id`;
      if (rows[0] && platformUser.workspaceId) {
        await tx`
          UPDATE businesses SET platform_workspace_id = COALESCE(platform_workspace_id, ${platformUser.workspaceId})
           WHERE id = ${rows[0].business_id}`;
      }
      return rows;
    });
    if (linkedLegacyUser) return publicWorkspaceUser(linkedLegacyUser);
  }

  try {
    return await sql.begin(async (tx) => {
      const [existing] = await tx`
        SELECT id, name, email, role, business_id
          FROM users WHERE platform_user_id = ${platformUserId} LIMIT 1`;
      if (existing) return publicWorkspaceUser(existing);

      const [business] = await tx`
        INSERT INTO businesses (name, admin_number, provider, currency, onboarded_at, platform_workspace_id)
        VALUES (${platformUser.businessName || platformUser.name || "My workspace"}, NULL, 'mock', 'INR', NULL,
                ${platformUser.workspaceId || null})
        RETURNING id`;
      const [emailOwner] = email
        ? await tx`SELECT id FROM users WHERE LOWER(email) = ${email} LIMIT 1`
        : [];
      const workspaceEmail = email && !emailOwner
        ? email
        : `${platformUserId}@platform.agenticthat.local`;
      const generatedPassword = crypto.randomBytes(48).toString("base64url");
      const [created] = await tx`
        INSERT INTO users (business_id, name, email, password_hash, role, platform_user_id)
        VALUES (${business.id}, ${platformUser.name || "Workspace owner"},
                ${workspaceEmail},
                ${hashPassword(generatedPassword)}, 'admin', ${platformUserId})
        RETURNING id, name, email, role, business_id`;
      return publicWorkspaceUser(created);
    });
  } catch (error) {
    // Concurrent serverless requests can race during the first visit. The
    // unique platform id constraint decides the winner; reuse its row.
    const [winner] = await sql`
      SELECT id, name, email, role, business_id
        FROM users WHERE platform_user_id = ${platformUserId} LIMIT 1`;
    if (winner) return publicWorkspaceUser(winner);
    throw error;
  }
}

// AgenticThat owns product identity. A signed-in platform user is mapped to a
// WhatsApp workspace automatically, while the original WhatsApp session stays
// as a backwards-compatible route for legacy operators and webhook testing.
export async function getCurrentUser(requiredLevel = "view") {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  let legacyUser = null;
  if (token) {
    const sql = await getSql();
    const [user] = await sql`
      SELECT u.id, u.name, u.email, u.role, u.business_id
        FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ${token}`;
    legacyUser = publicWorkspaceUser(user);
  }

  const platformUser = await getCurrentPlatformUser();
  if (platformUser) {
    const principal = await getCurrentPrincipal();
    try {
      await assertPrincipalAccess(principal, "messaging.whatsapp", requiredLevel);
    } catch (error) {
      if (error instanceof AccessDeniedError) return null;
      throw error;
    }
    return ensurePlatformWorkspaceUser({ ...platformUser, workspaceId: principal.workspaceId }, legacyUser);
  }
  return rbacEnforcementMode() === "shadow" ? legacyUser : null;
}

// Route handlers use this after getCurrentUser() returns null so an expired or
// missing identity remains a 401 while an authenticated RBAC denial is a 403.
export async function whatsappAccessErrorResponse(requiredLevel = "view") {
  const principal = await getCurrentPrincipal();
  if (!principal) {
    return Response.json({ error: "Sign in to continue.", code: "UNAUTHENTICATED" }, { status: 401 });
  }
  try {
    await assertPrincipalAccess(principal, "messaging.whatsapp", requiredLevel);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
  return Response.json({ error: "WhatsApp workspace unavailable.", code: "WORKSPACE_UNAVAILABLE" }, { status: 503 });
}

// Guard for WhatsApp server components / layouts. Keep this separate from the
// AgenticThat platform login route, which owns /login.
export async function requireUser(requiredLevel = "view") {
  const principal = await requireAccess("messaging.whatsapp", requiredLevel, "/dashboard");
  const platformUser = await getCurrentPlatformUser();
  if (!platformUser) redirect("/?auth=login&next=/dashboard");
  return ensurePlatformWorkspaceUser({ ...platformUser, workspaceId: principal.workspaceId });
}

export async function setSessionCookie(token) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export { COOKIE_NAME };
