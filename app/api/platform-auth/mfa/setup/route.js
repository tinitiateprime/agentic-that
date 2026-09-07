import { beginAdminMfaEnrollment, confirmAdminMfaEnrollment, PlatformAuthError } from "@platform/server/auth-store";
import { clearAuthRateLimit, enforceAuthRateLimit, requestClientAddress } from "@platform/server/auth-abuse";

function errorResponse(error) {
  if (error instanceof PlatformAuthError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.code === "RATE_LIMITED" ? 429 : 400 });
  }
  console.error("Admin MFA setup failed", error);
  return Response.json({ error: "Admin MFA setup failed." }, { status: 500 });
}
export async function POST(request) {
  try {
    const body = await request.json();
    const clientAddress = requestClientAddress(request);
    if (body.action === "begin") {
      await enforceAuthRateLimit("mfa-setup-begin-ip", clientAddress, 30, 5 * 60, 5 * 60);
      return Response.json({ ok: true, ...await beginAdminMfaEnrollment() });
    }
    if (body.action === "confirm") {
      await enforceAuthRateLimit("mfa-setup-confirm-ip", clientAddress, 10, 15 * 60, 30 * 60);
      const result = await confirmAdminMfaEnrollment(body.code);
      await clearAuthRateLimit("mfa-setup-confirm-ip", clientAddress);
      return Response.json({ ok: true, ...result });
    }
    return Response.json({ error: "Unsupported MFA setup action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
