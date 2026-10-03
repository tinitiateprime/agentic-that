import { verifyAdminMfa, PlatformAuthError } from "@platform/server/auth-store";
import { enforceAuthRateLimit, requestClientAddress } from "@platform/server/auth-abuse";

export async function POST(request) {
  try {
    await enforceAuthRateLimit("mfa-verify-ip", requestClientAddress(request), 10, 15 * 60, 30 * 60);
    const body = await request.json();
    return Response.json({ ok: true, ...await verifyAdminMfa(body.code) });
  } catch (error) {
    if (error instanceof PlatformAuthError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.code === "RATE_LIMITED" ? 429 : 400 });
    }
    console.error("Admin MFA verification failed", error);
    return Response.json({ error: "Admin MFA verification failed." }, { status: 500 });
  }
}
