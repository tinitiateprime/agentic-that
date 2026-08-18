import { getSql } from "@whatsapp/lib/db";
import { hashPassword, createSession, setSessionCookie, getCurrentUser } from "@whatsapp/lib/auth";
import { rbacEnforcementMode } from "@platform/server/access-control";

// Self-serve signup. Each signup creates a NEW tenant: one business (the
// workspace) plus its first admin user, then signs them in. WhatsApp isn't
// connected yet — the client is sent to /onboarding to finish setup.
export async function POST(req) {
  if (rbacEnforcementMode() !== "shadow") {
    return Response.json({ error: "Create your account through AgenticThat." }, { status: 410 });
  }
  // Already signed in? Don't silently create a second workspace.
  if (await getCurrentUser()) {
    return Response.json({ error: "You're already signed in." }, { status: 400 });
  }

  const { name, email, password, businessName } = await req.json().catch(() => ({}));

  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanName = String(name || "").trim();
  const cleanBusiness = String(businessName || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return Response.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (String(password || "").length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (!cleanBusiness) {
    return Response.json({ error: "Enter your business name" }, { status: 400 });
  }

  const sql = await getSql();

  // users.email is UNIQUE across all tenants, so this is the real check; the
  // insert below is still guarded in case of a race.
  const [existing] = await sql`SELECT id FROM users WHERE email = ${cleanEmail}`;
  if (existing) {
    return Response.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  let userId;
  try {
    userId = await sql.begin(async (tx) => {
      const [biz] = await tx`
        INSERT INTO businesses (name, provider, currency)
        VALUES (${cleanBusiness}, 'meta', 'INR')
        RETURNING id`;
      const [user] = await tx`
        INSERT INTO users (business_id, name, email, password_hash, role)
        VALUES (${biz.id}, ${cleanName || "Admin"}, ${cleanEmail}, ${hashPassword(password)}, 'admin')
        RETURNING id`;
      return user.id;
    });
  } catch (err) {
    if (/duplicate key|unique/i.test(String(err.message))) {
      return Response.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    throw err;
  }

  const token = await createSession(userId);
  await setSessionCookie(token);
  return Response.json({ ok: true, next: "/whatsapp/onboarding" });
}
