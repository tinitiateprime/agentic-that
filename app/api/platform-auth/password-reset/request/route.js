import { requestPlatformPasswordReset, PlatformAuthError } from "@platform/server/auth-store";
import { enforceAuthRateLimit, requestClientAddress } from "@platform/server/auth-abuse";
import { PlatformEmailDeliveryError } from "@platform/server/auth-email";

export async function POST(request) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    await enforceAuthRateLimit("password-reset-ip", requestClientAddress(request), 5, 60 * 60, 60 * 60);
    await enforceAuthRateLimit("password-reset-email", email || "invalid", 3, 60 * 60, 60 * 60);
    await requestPlatformPasswordReset(email);
    return Response.json({ ok: true, message: "If an account exists, a password reset link has been sent." });
  } catch (error) {
    if (error instanceof PlatformAuthError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.code === "RATE_LIMITED" ? 429 : 400 });
    }
    if (error instanceof PlatformEmailDeliveryError) {
      console.error("Platform password reset email delivery failed:", error.message);
      return Response.json({ error: "Email delivery is temporarily unavailable. Please try again later or contact support.", code: error.code }, { status: 503 });
    }
    console.error("Platform password reset request failed", error);
    return Response.json({ error: "The password reset email could not be sent." }, { status: 500 });
  }
}
