import {
  loginPlatformUser,
  resendPlatformVerification,
  platformSessionCookieHeader,
  PlatformAuthError,
} from "@platform/server/auth-store";
import { clearAuthRateLimit, enforceAuthRateLimit, enforceVerificationEmailRateLimit, requestClientAddress } from "@platform/server/auth-abuse";
import { PlatformEmailDeliveryError } from "@platform/server/auth-email";

export async function POST(request) {
  let email = "";
  try {
    const credentials = await request.json();
    const address = requestClientAddress(request);
    email = String(credentials.email || "").trim().toLowerCase();
    await enforceAuthRateLimit("login-ip", address, 100, 15 * 60, 30 * 60);
    await enforceAuthRateLimit("login-email", email || address, 8, 15 * 60, 30 * 60);
    const { token, user, mfaRequired, mfaEnrollmentRequired } = await loginPlatformUser(credentials);
    await clearAuthRateLimit("login-email", email);
    const response = Response.json({ ok: true, user, mfaRequired, mfaEnrollmentRequired });
    response.headers.append("Set-Cookie", platformSessionCookieHeader(token));
    return response;
  } catch (error) {
    if (error instanceof PlatformAuthError) {
      if (error.code === "EMAIL_NOT_VERIFIED") {
        // loginPlatformUser checks the password before reporting this error.
        // Share the resend limits so repeated sign-ins cannot flood an inbox.
        let emailDeliveryFailed = false;
        let verificationMessage = "A verification link has been sent. Check your inbox and spam folder.";
        try {
          await enforceVerificationEmailRateLimit(request, email);
          await resendPlatformVerification(email);
        } catch (deliveryError) {
          emailDeliveryFailed = true;
          if (deliveryError instanceof PlatformAuthError && deliveryError.code === "RATE_LIMITED") {
            verificationMessage = "Verification email requests are limited. Check your inbox and spam folder, or try again later.";
          } else {
            verificationMessage = "We couldn't send the verification email. Please try resending later or contact support.";
            console.error("Platform login verification email failed:", deliveryError instanceof PlatformEmailDeliveryError ? deliveryError.message : "Unexpected delivery failure");
          }
        }
        return Response.json({ error: error.message, code: error.code, verificationRequired: true, emailDeliveryFailed, verificationMessage }, { status: 403 });
      }
      const status = error.code === "RATE_LIMITED" ? 429 : 401;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    console.error("Platform login failed", error);
    return Response.json({ error: "Sign in failed. Please try again." }, { status: 500 });
  }
}
