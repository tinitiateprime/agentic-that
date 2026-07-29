import { cookies } from "next/headers";
import { destroySession, clearSessionCookie, COOKIE_NAME } from "@whatsapp/lib/auth";

export async function POST() {
  const store = await cookies();
  await destroySession(store.get(COOKIE_NAME)?.value);
  await clearSessionCookie();
  return Response.json({ ok: true });
}
