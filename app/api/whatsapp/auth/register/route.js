import { getSql } from "@whatsapp/lib/db";
import {
  createSession,
  getCurrentUser,
  hashPassword,
  setSessionCookie,
  whatsappAccessErrorResponse,
} from "@whatsapp/lib/auth";

// Creates the WhatsApp workspace login for the signed-in AgenticThat user.
//
// The workspace and its WhatsApp-local user row already exist (they are
// provisioned the first time a platform user reaches WhatsApp), so registering
// sets the credentials on that row rather than creating a second tenant the way
// the legacy /api/whatsapp/auth/signup route does. The caller is signed in
// afterwards, so the Connection Manager continues straight into setup.
export const dynamic = "force-dynamic";

export async function POST(req) {
  const workspaceUser = await getCurrentUser("configure");
  if (!workspaceUser) return whatsappAccessErrorResponse("configure");

  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim();
  const businessName = String(body.businessName || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
    return Response.json({ error: "Enter a valid email address to use as your username" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const sql = await getSql();

  // users.email is UNIQUE across every tenant, so an address held by anyone
  // else has to be rejected before the update races the constraint.
  const [emailOwner] = await sql`SELECT id FROM users WHERE LOWER(email) = ${username}`;
  if (emailOwner && Number(emailOwner.id) !== Number(workspaceUser.id)) {
    return Response.json(
      { error: "That username already belongs to another WhatsApp login. Use Sign in to link it instead." },
      { status: 409 }
    );
  }

  try {
    await sql`
      UPDATE users
         SET name = ${displayName || workspaceUser.name || "Workspace owner"},
             email = ${username},
             password_hash = ${hashPassword(password)}
       WHERE id = ${workspaceUser.id}`;
  } catch (err) {
    if (/duplicate key|unique/i.test(String(err?.message))) {
      return Response.json(
        { error: "That username is already used by another WhatsApp login." },
        { status: 409 }
      );
    }
    throw err;
  }

  if (businessName) {
    await sql`UPDATE businesses SET name = ${businessName} WHERE id = ${workspaceUser.business_id}`;
  }

  const token = await createSession(workspaceUser.id);
  await setSessionCookie(token);
  return Response.json({
    ok: true,
    user: { id: workspaceUser.id, name: displayName || workspaceUser.name, email: username },
  });
}
