import db from "@/lib/db";
import { verifyPassword, createSession, sessionCookieHeader } from "@/lib/auth";

export async function POST(req) {
  try {
    const { email, password } = await req.json();
    const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").trim());
    if (!user || !verifyPassword(password || "", user.password_hash)) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const token = await createSession(user.id);
    const response = Response.json({ ok: true });
    response.headers.append("Set-Cookie", sessionCookieHeader(token));
    return response;
  } catch (error) {
    console.error("Login failed", error);
    return Response.json({ error: "Login failed" }, { status: 500 });
  }
}
