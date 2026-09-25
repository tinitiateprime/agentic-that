import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  buildGmailRaw,
  createGoogleAuthorization,
  decryptGoogleToken,
  encryptGoogleToken,
  exchangeGoogleCode,
  googleConnectionConfiguration,
  googleRedirectUri,
  normalizeBookingTimeZone,
  refreshGoogleGrant,
} from "./phone-front-desk-google.js";

function withGoogleEnvironment(callback) {
  const keys = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "CREDENTIAL_ENCRYPTION_KEY", "GOOGLE_OAUTH_REDIRECT_URI", "PLATFORM_PUBLIC_URL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-web-client.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
  process.env.CREDENTIAL_ENCRYPTION_KEY = "test-encryption-key-for-google-tokens";
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  process.env.PLATFORM_PUBLIC_URL = "https://agenticthat.com";
  return Promise.resolve().then(callback).finally(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test("Google OAuth calendar and mail use separate least-privilege scopes and PKCE", async () => withGoogleEnvironment(() => {
  const calendar = createGoogleAuthorization("calendar", "https://agenticthat.com/api/phone-front-desk/google/connect?kind=calendar");
  const mail = createGoogleAuthorization("mail", "https://agenticthat.com/api/phone-front-desk/google/connect?kind=mail");
  const calendarUrl = new URL(calendar.url);
  const mailUrl = new URL(mail.url);
  assert.equal(calendarUrl.searchParams.get("access_type"), "offline");
  assert.equal(calendarUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(calendarUrl.searchParams.get("redirect_uri"), "https://agenticthat.com/api/phone-front-desk/google/callback");
  assert.match(calendarUrl.searchParams.get("scope"), /calendar\.events\.freebusy/);
  assert.doesNotMatch(calendarUrl.searchParams.get("scope"), /gmail\.send/);
  assert.match(mailUrl.searchParams.get("scope"), /gmail\.send/);
  assert.doesNotMatch(mailUrl.searchParams.get("scope"), /calendar\.events/);
  assert.notEqual(calendar.state, mail.state);
  assert.notEqual(calendar.verifier, mail.verifier);
  assert.throws(() => createGoogleAuthorization("drive", "https://agenticthat.com"), /Choose Google Calendar or Gmail/);
  assert.equal(googleRedirectUri("http://localhost:3000/anything"), "http://localhost:3000/api/phone-front-desk/google/callback");
}));

test("Google OAuth tokens are encrypted and tampering is rejected", async () => withGoogleEnvironment(() => {
  const token = "1//refresh-token-secret";
  const encrypted = encryptGoogleToken(token);
  assert.doesNotMatch(encrypted, /refresh-token-secret/);
  assert.equal(decryptGoogleToken(encrypted), token);
  assert.throws(() => decryptGoogleToken(`${encrypted}x`));
}));

test("Google connections reject placeholder or short encryption keys", async () => withGoogleEnvironment(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = "a_long_random_secret";
  assert.equal(googleConnectionConfiguration().configured, false);
  assert.throws(() => encryptGoogleToken("refresh-token"), /random value of at least 32 characters/);
  process.env.CREDENTIAL_ENCRYPTION_KEY = "a".repeat(31);
  assert.equal(googleConnectionConfiguration().configured, false);
  process.env.CREDENTIAL_ENCRYPTION_KEY = "a".repeat(32);
  assert.equal(googleConnectionConfiguration().configured, false);
  process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  assert.equal(googleConnectionConfiguration().configured, true);
}));

test("booking time zones may differ from a connected calendar's default", () => {
  assert.equal(normalizeBookingTimeZone(" Asia/Kolkata "), "Asia/Kolkata");
  assert.equal(normalizeBookingTimeZone("America/Chicago"), "America/Chicago");
  assert.throws(() => normalizeBookingTimeZone("Mars/Olympus"), /valid booking time zone/);
  assert.throws(() => normalizeBookingTimeZone(""), /valid booking time zone/);
});

test("Google OAuth code exchange checks scopes and verified account email", async () => withGoogleEnvironment(async () => {
  const originalFetch = globalThis.fetch;
  let scopes = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send";
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/token")) {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("code_verifier"), "challenge-verifier");
      return Response.json({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600, scope: scopes });
    }
    if (String(url).endsWith("/userinfo")) return Response.json({ email: "Owner@Business.com", email_verified: true });
    throw new Error("Unexpected Google request");
  };
  try {
    const grant = await exchangeGoogleCode("mail", "auth-code", "challenge-verifier", "https://agenticthat.com/api/phone-front-desk/google/callback");
    assert.equal(grant.email, "owner@business.com");
    assert.equal(grant.refreshToken, "refresh-token");
    scopes = "openid email";
    await assert.rejects(exchangeGoogleCode("mail", "auth-code", "challenge-verifier", "https://agenticthat.com/api/phone-front-desk/google/callback"), /permissions were not granted/);
  } finally { globalThis.fetch = originalFetch; }
}));

test("Google refresh rotates access tokens and asks for reconnection on revoked grants", async () => withGoogleEnvironment(async () => {
  const originalFetch = globalThis.fetch;
  let revoked = false;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "saved-refresh-token");
    return revoked ? Response.json({ error: "invalid_grant" }, { status: 400 }) : Response.json({ access_token: "fresh-access-token", expires_in: 3600 });
  };
  try {
    assert.equal((await refreshGoogleGrant("saved-refresh-token")).accessToken, "fresh-access-token");
    revoked = true;
    await assert.rejects(refreshGoogleGrant("saved-refresh-token"), /Reconnect this account/);
  } finally { globalThis.fetch = originalFetch; }
}));

test("Gmail message is encoded safely with the business mailbox as sender", () => {
  const encoded = buildGmailRaw({ from: "owner@business.com", to: "customer@example.com", subject: "Booked\r\nBcc: attacker@example.com", text: "Your appointment is booked.\nThank you." });
  const mime = Buffer.from(encoded, "base64url").toString("utf8");
  assert.match(mime, /^From: owner@business\.com\r\nTo: customer@example\.com\r\n/);
  assert.doesNotMatch(mime, /\r\nBcc:/);
  assert.match(mime, /Content-Transfer-Encoding: base64/);
  assert.throws(() => buildGmailRaw({ from: "owner@business.com\r\nBcc:bad@example.com", to: "customer@example.com", subject: "Hi", text: "Test" }), /valid recipient email/);
});
