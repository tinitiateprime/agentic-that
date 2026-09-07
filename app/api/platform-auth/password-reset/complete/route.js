import { resetPlatformPassword, PlatformAuthError } from "@platform/server/auth-store";
import { enforceAuthRateLimit, requestClientAddress } from "@platform/server/auth-abuse";

export async function POST(request) {
  try {
    await enforceAuthRateLimit("password-reset-complete-ip", requestClientAddress(request), 10, 60 * 60, 60 * 60);
    const body = await request.json();
    await resetPlatformPassword(body.token, body.password);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof PlatformAuthError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.code === "RATE_LIMITED" ? 429 : 400 });
    }
    console.error("Platform password reset failed", error);
    return Response.json({ error: "Password reset failed. Please request a new link." }, { status: 500 });
  }
}
