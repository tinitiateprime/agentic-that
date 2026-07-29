import { getSql } from "@whatsapp/lib/db";
import { verifyPassword, createSession, setSessionCookie } from "@whatsapp/lib/auth";

export async function POST(req) {
  try {
    const { email, password } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const sql = await getSql();
    const [user] = await sql`SELECT * FROM users WHERE LOWER(email) = ${normalizedEmail}`;
    if (!user || !verifyPassword(password || "", user.password_hash)) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const token = await createSession(user.id);
    await setSessionCookie(token);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("WhatsApp login failed", error);
    return Response.json({ error: "Sign in failed" }, { status: 500 });
  }
}
