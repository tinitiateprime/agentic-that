import db from "@/lib/db";
import { verifyPassword, createSession, sessionCookieHeader } from "@/lib/auth";

export async function POST(req) {
  let step = "start";
  try {
    step = "parse";
    const { email, password } = await req.json();
    step = "lookup";
    const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").trim());
    step = "verify";
    if (!user || !verifyPassword(password || "", user.password_hash)) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }
    step = "session";
    const token = await createSession(user.id);
    step = "cookie";
    const response = Response.json({ ok: true });
    response.headers.append("Set-Cookie", sessionCookieHeader(token));
    return response;
  } catch (error) {
    console.error("Login failed", error);
    return Response.json({ error: "Login failed", step }, { status: 500 });
  }
}
