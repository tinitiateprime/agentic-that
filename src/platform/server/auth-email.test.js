import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { platformAuthEmailTemplate, platformAuthLink, sendVerificationEmail } from "./auth-email.js";

test("authentication links use the canonical domain instead of the legacy Netlify hostname", () => {
  const originalOrigin = process.env.PLATFORM_PUBLIC_URL;
  process.env.PLATFORM_PUBLIC_URL = "https://agentic-that.netlify.app";

  try {
    assert.equal(
      platformAuthLink("/verify-email", "verification-token"),
      "https://agenticthat.com/verify-email?token=verification-token",
    );
  } finally {
    if (originalOrigin === undefined) delete process.env.PLATFORM_PUBLIC_URL;
    else process.env.PLATFORM_PUBLIC_URL = originalOrigin;
  }
});

test("authentication email template is branded, accessible, and safely escapes action links", () => {
  const html = platformAuthEmailTemplate({
    preheader: "Preview <secure>",
    eyebrow: "Account verification",
    title: "Confirm your email address",
    introduction: "Finish setup safely.",
    actionLabel: "Verify email address",
    actionUrl: "https://agenticthat.com/verify-email?token=one&next=<apps>",
    expiry: "This secure link expires in 24 hours",
    securityNote: "Ignore this message if you did not request it.",
  });

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /role="presentation"/);
  assert.match(html, />AgenticThat</);
  assert.match(html, /Verify email address/);
  assert.match(html, /Protected verification/);
  assert.match(html, /https:\/\/agenticthat\.com\/verify-email\?token=one&amp;next=&lt;apps&gt;/);
  assert.doesNotMatch(html, /Preview <secure>/);
});

test("verification delivery sends a polished HTML email with a useful plain-text fallback", async () => {
  const original = {
    fetch: globalThis.fetch,
    from: process.env.AUTH_EMAIL_FROM,
    key: process.env.RESEND_API_KEY,
    origin: process.env.PLATFORM_PUBLIC_URL,
  };
  let request;
  process.env.AUTH_EMAIL_FROM = "AgenticThat <accounts@agenticthat.com>";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.PLATFORM_PUBLIC_URL = "https://agenticthat.com";
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({ id: "email_123" });
  };

  try {
    const delivery = await sendVerificationEmail("person@example.com", "a".repeat(48));
    const payload = JSON.parse(request.options.body);
    assert.deepEqual(delivery, { provider: "resend", messageId: "email_123", skipped: false });
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.ok(request.options.signal instanceof AbortSignal);
    assert.equal(payload.subject, "Confirm your email address | AgenticThat");
    assert.match(payload.html, /Confirm your email address/);
    assert.match(payload.html, /This secure link expires in 24 hours/);
    assert.match(payload.text, /Verify email address: https:\/\/agenticthat\.com\/verify-email\?token=/);
  } finally {
    globalThis.fetch = original.fetch;
    if (original.from === undefined) delete process.env.AUTH_EMAIL_FROM;
    else process.env.AUTH_EMAIL_FROM = original.from;
    if (original.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original.key;
    if (original.origin === undefined) delete process.env.PLATFORM_PUBLIC_URL;
    else process.env.PLATFORM_PUBLIC_URL = original.origin;
  }
});

test("verification page signs in, removes the token from browser history, and redirects", async () => {
  const source = await readFile(new URL("../../../app/verify-email/page.jsx", import.meta.url), "utf8");
  assert.match(source, /window\.history\.replaceState\(null, "", window\.location\.pathname\)/);
  assert.match(source, /setStatus\("success"\)/);
  assert.match(source, /window\.location\.replace\(next\)/);
  assert.match(source, /You're signed in\. We're opening your AgenticThat workspace now\./);
  assert.doesNotMatch(source, /â€¦/);
});
