import { cookies } from "next/headers";
import { getCurrentPlatformUser } from "@platform/server/auth-store";
import { getSql } from "@whatsapp/lib/db";
import {
  COOKIE_NAME,
  clearSessionCookie,
  createSession,
  destroySession,
  getCurrentUser,
  setSessionCookie,
  verifyPassword,
  whatsappAccessErrorResponse,
} from "@whatsapp/lib/auth";

// The WhatsApp workspace login used by the Connection Manager. Unlike the
// legacy /api/whatsapp/auth/login route (retired under RBAC enforce mode),
// every method here is authorized by the AgenticThat session first and only
// then touches the WhatsApp-local `users` table — the same shape Telegram uses
// for its dashboard login.
//
//   GET    -> is a WhatsApp workspace session open, and what should the form prefill?
//   POST   -> sign in to an existing WhatsApp workspace login
//   DELETE -> sign out of the WhatsApp workspace only
export const dynamic = "force-dynamic";

async function whatsappSessionUser() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const sql = await getSql();
  const [user] = await sql`
    SELECT u.id, u.name, u.email, u.business_id
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ${token}`;
  return user || null;
}

export async function GET() {
  const workspaceUser = await getCurrentUser("configure");
  if (!workspaceUser) return whatsappAccessErrorResponse("configure");

  const sql = await getSql();
  const sessionUser = await whatsappSessionUser();
  const platformUser = await getCurrentPlatformUser();
  const [business] = await sql`SELECT name FROM businesses WHERE id = ${workspaceUser.business_id}`;

  // Auto-provisioned rows carry a synthetic address, which is no use as a
  // username — fall back to the AgenticThat email in that case.
  const localEmail = String(workspaceUser.email || "");
  const username = localEmail.endsWith("@platform.agenticthat.local")
    ? platformUser?.email || ""
    : localEmail;

  return Response.json({
    ok: true,
    authenticated: Boolean(sessionUser),
    user: sessionUser ? { id: sessionUser.id, name: sessionUser.name, email: sessionUser.email } : null,
    // Prefill hints for the sign-in and register forms. Never a password.
    workspace: {
      businessName: business?.name || platformUser?.businessName || "",
      displayName: workspaceUser.name || platformUser?.name || "",
      username,
    },
  });
}

export async function POST(req) {
  const workspaceUser = await getCurrentUser("configure");
  if (!workspaceUser) return whatsappAccessErrorResponse("configure");

  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!username || !password) {
    return Response.json({ error: "Enter your WhatsApp workspace username and password" }, { status: 400 });
  }

  const sql = await getSql();
  const [user] = await sql`
    SELECT id, name, email, password_hash, business_id, platform_user_id
      FROM users WHERE LOWER(email) = ${username}`;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return Response.json({ error: "Invalid username or password" }, { status: 401 });
  }

  // Signing in to a login outside this workspace is only allowed when it is an
  // unclaimed WhatsApp-only account — that is the account-linking path in
  // ensurePlatformWorkspaceUser. Anything already owned elsewhere stays closed.
  if (Number(user.business_id) !== Number(workspaceUser.business_id)) {
    if (user.platform_user_id) {
      return Response.json(
        { error: "That WhatsApp login already belongs to another AgenticThat user." },
        { status: 403 }
      );
    }
    const [legacyBusiness] = await sql`
      SELECT platform_workspace_id FROM businesses WHERE id = ${user.business_id}`;
    if (legacyBusiness?.platform_workspace_id) {
      return Response.json(
        { error: "That WhatsApp workspace is connected to a different AgenticThat workspace." },
        { status: 403 }
      );
    }
  }

  const token = await createSession(user.id);
  await setSessionCookie(token);
  return Response.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
}

export async function DELETE() {
  const store = await cookies();
  await destroySession(store.get(COOKIE_NAME)?.value);
  await clearSessionCookie();
  return Response.json({ ok: true });
}
