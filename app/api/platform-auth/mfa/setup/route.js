import { beginAdminMfaEnrollment, confirmAdminMfaEnrollment, PlatformAuthError } from "@platform/server/auth-store";
import { enforceAuthRateLimit, requestClientAddress } from "@platform/server/auth-abuse";

function errorResponse(error) {
  if (error instanceof PlatformAuthError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.code === "RATE_LIMITED" ? 429 : 400 });
  }
  console.error("Admin MFA setup failed", error);
  return Response.json({ error: "Admin MFA setup failed." }, { status: 500 });
}
export async function POST(request) {
  try {
    await enforceAuthRateLimit("mfa-setup-ip", requestClientAddress(request), 10, 60 * 60, 60 * 60);
    const body = await request.json();
    if (body.action === "begin") return Response.json({ ok: true, ...await beginAdminMfaEnrollment() });
    if (body.action === "confirm") return Response.json({ ok: true, ...await confirmAdminMfaEnrollment(body.code) });
    return Response.json({ error: "Unsupported MFA setup action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
