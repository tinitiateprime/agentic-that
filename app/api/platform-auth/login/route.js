import {
  loginPlatformUser,
  platformSessionCookieHeader,
  PlatformAuthError,
} from "@platform/server/auth-store";
import { clearAuthRateLimit, enforceAuthRateLimit, requestClientAddress } from "@platform/server/auth-abuse";

export async function POST(request) {
  try {
    const credentials = await request.json();
    const address = requestClientAddress(request);
    const email = String(credentials.email || "").trim().toLowerCase();
    await enforceAuthRateLimit("login-ip", address, 100, 15 * 60, 30 * 60);
    await enforceAuthRateLimit("login-email", email || address, 8, 15 * 60, 30 * 60);
    const { token, user, mfaRequired, mfaEnrollmentRequired } = await loginPlatformUser(credentials);
    await clearAuthRateLimit("login-email", email);
    const response = Response.json({ ok: true, user, mfaRequired, mfaEnrollmentRequired });
    response.headers.append("Set-Cookie", platformSessionCookieHeader(token));
    return response;
  } catch (error) {
    if (error instanceof PlatformAuthError) {
      const status = error.code === "RATE_LIMITED" ? 429 : error.code === "EMAIL_NOT_VERIFIED" ? 403 : 401;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    console.error("Platform login failed", error);
    return Response.json({ error: "Sign in failed. Please try again." }, { status: 500 });
  }
}
