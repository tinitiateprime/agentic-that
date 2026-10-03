import {
  platformSessionCookieHeader,
  PlatformAuthError,
  registerPlatformUser,
} from "@platform/server/auth-store";
import { enforceAuthRateLimit, requestClientAddress } from "@platform/server/auth-abuse";

export async function POST(request) {
  try {
    const registration = await request.json();
    const email = String(registration.email || "").trim().toLowerCase();
    await enforceAuthRateLimit("signup-ip", requestClientAddress(request), 20, 60 * 60, 60 * 60);
    await enforceAuthRateLimit("signup-email", email || "invalid", 3, 24 * 60 * 60, 24 * 60 * 60);
    const { token, user, verificationRequired, emailDeliveryFailed } = await registerPlatformUser(registration);
    const response = Response.json({ ok: true, user, verificationRequired, emailDeliveryFailed });
    if (token) response.headers.append("Set-Cookie", platformSessionCookieHeader(token));
    return response;
  } catch (error) {
    if (error instanceof PlatformAuthError) {
      const status = error.code === "RATE_LIMITED" ? 429 : error.code === "ACCOUNT_EXISTS" ? 409 : 400;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    console.error("Platform signup failed", error);
    return Response.json({ error: "Account creation failed. Please try again." }, { status: 500 });
  }
}
