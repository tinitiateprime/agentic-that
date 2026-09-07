import { platformSessionCookieHeader, PlatformAuthError, verifyPlatformEmail } from "@platform/server/auth-store";
import { enforceAuthRateLimit, requestClientAddress } from "@platform/server/auth-abuse";

export async function POST(request) {
  try {
    await enforceAuthRateLimit("verify-email-ip", requestClientAddress(request), 20, 60 * 60, 60 * 60);
    const body = await request.json();
    const { token, user } = await verifyPlatformEmail(body.token);
    const response = Response.json({ ok: true, user });
    response.headers.append("Set-Cookie", platformSessionCookieHeader(token));
    return response;
  } catch (error) {
    if (error instanceof PlatformAuthError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.code === "RATE_LIMITED" ? 429 : 400 });
    }
    console.error("Platform email verification failed", error);
    return Response.json({ error: "Email verification failed. Please try again." }, { status: 500 });
  }
}
