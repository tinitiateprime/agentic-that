import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentPlatformUser } from "@platform/server/auth-store";
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
    SELECT id, name, email, role, business_id
      FROM users WHERE platform_user_id = ${platformUserId} LIMIT 1`;
  if (byPlatformId) return publicWorkspaceUser(byPlatformId);

  // An existing WhatsApp-only workspace is linked only when this browser has
  // authenticated to both products. Email alone is not proof of ownership
  // until the main product introduces verified email addresses.
  if (legacyUser?.id) {
    const [linkedLegacyUser] = await sql`
      UPDATE users
         SET platform_user_id = ${platformUserId}
       WHERE id = ${legacyUser.id}
         AND (platform_user_id IS NULL OR platform_user_id = ${platformUserId})
       RETURNING id, name, email, role, business_id`;
    if (linkedLegacyUser) return publicWorkspaceUser(linkedLegacyUser);
  }

  try {
    return await sql.begin(async (tx) => {
      const [existing] = await tx`
        SELECT id, name, email, role, business_id
          FROM users WHERE platform_user_id = ${platformUserId} LIMIT 1`;
      if (existing) return publicWorkspaceUser(existing);

      const [business] = await tx`
        INSERT INTO businesses (name, admin_number, provider, currency, onboarded_at)
        VALUES (${platformUser.businessName || platformUser.name || "My workspace"}, NULL, 'mock', 'INR', NULL)
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
export async function getCurrentUser() {
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
  if (platformUser) return ensurePlatformWorkspaceUser(platformUser, legacyUser);
  return legacyUser;
}

// Guard for WhatsApp server components / layouts. Keep this separate from the
// AgenticThat platform login route, which owns /login.
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/whatsapp/login");
  return user;
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
