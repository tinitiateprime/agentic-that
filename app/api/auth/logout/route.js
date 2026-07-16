import { cookies } from "next/headers";
import { destroySession, clearSessionCookieHeader, COOKIE_NAME } from "@/lib/auth";

export async function POST() {
  const store = await cookies();
  await destroySession(store.get(COOKIE_NAME)?.value);
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", clearSessionCookieHeader());
  return response;
}
