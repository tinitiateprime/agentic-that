import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function fixture(context, options = {}) {
  const key = `loginEmailFixture_${Math.random().toString(36).slice(2)}`;
  const state = globalThis[key] = { options, deliveries: [], rateChecks: [], cleared: [] };
  context.after(() => { delete globalThis[key]; });
  const bundle = await build({
    entryPoints: ["app/api/platform-auth/login/route.js"], bundle: true, write: false, platform: "node", format: "esm",
    plugins: [{ name: "login-email-fixture", setup(builder) {
      builder.onResolve({ filter: /^@platform\/server\// }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("auth-store") ? `
        const state = globalThis[${JSON.stringify(key)}];
        export class PlatformAuthError extends Error { constructor(code, message) { super(message); this.code = code; } }
        export async function loginPlatformUser() {
          if (state.options.loginError) throw new PlatformAuthError(state.options.loginError, "Sign-in requires verification.");
          return { token: "session-token", user: { id: "verified-user" } };
        }
        export async function resendPlatformVerification(email) {
          state.deliveries.push(email);
          if (state.options.deliveryError) throw new Error("Private provider data");
          return { ok: true };
        }
        export function platformSessionCookieHeader(token) { return "agenticthat_session=" + token; }
      ` : args.path.endsWith("auth-abuse") ? `
        import { PlatformAuthError } from "@platform/server/auth-store";
        const state = globalThis[${JSON.stringify(key)}];
        export function requestClientAddress() { return "test-ip"; }
        export async function enforceAuthRateLimit() {}
        export async function clearAuthRateLimit(scope, email) { state.cleared.push({scope, email}); }
        export async function enforceVerificationEmailRateLimit(request, email) {
          state.rateChecks.push(email);
          if (state.options.rateLimited) throw new PlatformAuthError("RATE_LIMITED", "Too many requests.");
        }
      ` : "export class PlatformEmailDeliveryError extends Error {}" }));
    } }],
  });
  const route = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
  const response = await route.POST(new Request("https://example.com/api/platform-auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: " Person@Example.com ", password: "valid-password" }),
  }));
  return { state, response, data: await response.json() };
}

test("an unverified login sends a verification link after the shared resend limits", async context => {
  const { state, response, data } = await fixture(context, { loginError: "EMAIL_NOT_VERIFIED" });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(state.rateChecks, ["person@example.com"]);
  assert.deepEqual(state.deliveries, ["person@example.com"]);
  assert.equal(data.verificationRequired, true);
  assert.equal(data.emailDeliveryFailed, false);
  assert.match(data.verificationMessage, /link has been sent/);
});

test("invalid credentials and verified logins do not trigger verification email", async context => {
  const invalid = await fixture(context, { loginError: "INVALID_CREDENTIALS" });
  assert.equal(invalid.response.status, 401);
  assert.deepEqual(invalid.state.deliveries, []);
  assert.deepEqual(invalid.state.rateChecks, []);
  const valid = await fixture(context);
  assert.equal(valid.response.status, 200);
  assert.match(valid.response.headers.get("set-cookie"), /session-token/);
  assert.deepEqual(valid.state.deliveries, []);
});

test("verification throttling and provider failure keep the account unauthenticated with useful guidance", async context => {
  const limited = await fixture(context, { loginError: "EMAIL_NOT_VERIFIED", rateLimited: true });
  assert.equal(limited.response.status, 403);
  assert.equal(limited.response.headers.get("set-cookie"), null);
  assert.equal(limited.data.emailDeliveryFailed, true);
  assert.match(limited.data.verificationMessage, /requests are limited/);
  assert.deepEqual(limited.state.deliveries, []);
  context.mock.method(console, "error", () => {});
  const failed = await fixture(context, { loginError: "EMAIL_NOT_VERIFIED", deliveryError: true });
  assert.equal(failed.response.status, 403);
  assert.equal(failed.response.headers.get("set-cookie"), null);
  assert.equal(failed.data.emailDeliveryFailed, true);
  assert.match(failed.data.verificationMessage, /couldn't send/);
  assert.doesNotMatch(JSON.stringify(failed.data), /Private provider/);
});
