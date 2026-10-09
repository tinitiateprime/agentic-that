import { resendPlatformVerification, PlatformAuthError } from "@platform/server/auth-store";
import { enforceVerificationEmailRateLimit } from "@platform/server/auth-abuse";
import { PlatformEmailDeliveryError } from "@platform/server/auth-email";

export async function POST(request) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    await enforceVerificationEmailRateLimit(request, email);
    await resendPlatformVerification(email);
    return Response.json({ ok: true, message: "If the account needs verification, a new link has been sent." });
  } catch (error) {
    if (error instanceof PlatformAuthError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.code === "RATE_LIMITED" ? 429 : 400 });
    }
    if (error instanceof PlatformEmailDeliveryError) {
      console.error("Platform verification email delivery failed:", error.message);
      return Response.json({ error: "Email delivery is temporarily unavailable. Please try again later or contact support.", code: error.code }, { status: 503 });
    }
    console.error("Platform verification resend failed", error);
    return Response.json({ error: "The verification email could not be sent." }, { status: 500 });
  }
}
