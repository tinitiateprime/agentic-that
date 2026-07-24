import { cookies } from "next/headers";
import {
  clearPlatformSessionCookieHeader,
  destroyPlatformSession,
  PLATFORM_SESSION_COOKIE,
} from "@platform/server/auth-store";

export async function POST() {
  const cookieStore = await cookies();
  try {
    await destroyPlatformSession(cookieStore.get(PLATFORM_SESSION_COOKIE)?.value);
  } catch (error) {
    console.error(
      "Unable to remove the server-side platform session:",
      error instanceof Error ? error.message : error
    );
  }
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", clearPlatformSessionCookieHeader());
  return response;
}
