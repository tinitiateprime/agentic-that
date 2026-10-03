import assert from "node:assert/strict";
import test from "node:test";

import { getProvider } from "./provider.js";

test("mock provider records reaction details without network access", async () => {
  const provider = getProvider({ provider: "mock" });
  const result = await provider.sendReaction({
    to: "+91 98765 43210",
    messageId: "wamid.test",
    emoji: "👍",
  });

  assert.equal(result.status, "sent");
  assert.deepEqual(result.echo, {
    to: "+91 98765 43210",
    messageId: "wamid.test",
    emoji: "👍",
  });
});

test("Meta reactions use the tenant token, sender number, and expected payload", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnvToken = process.env.META_ACCESS_TOKEN;
  const originalEnvPhone = process.env.META_PHONE_NUMBER_ID;
  process.env.META_ACCESS_TOKEN = "deployment-owner-token";
  process.env.META_PHONE_NUMBER_ID = "deployment-owner-phone";

  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ messages: [{ id: "wamid.reaction" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalEnvToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = originalEnvToken;
    if (originalEnvPhone === undefined) delete process.env.META_PHONE_NUMBER_ID;
    else process.env.META_PHONE_NUMBER_ID = originalEnvPhone;
  });

  const provider = getProvider({
    provider: "meta",
    accessToken: "tenant-token",
    apiVersion: "v25.0",
    defaultPhoneNumberId: "tenant-phone",
  });
  const result = await provider.sendReaction({
    to: "+91 98765 43210",
    messageId: "wamid.original",
    emoji: "❤️",
  });

  assert.equal(result.providerId, "wamid.reaction");
  assert.equal(request.url, "https://graph.facebook.com/v25.0/tenant-phone/messages");
  assert.equal(request.options.headers.Authorization, "Bearer tenant-token");
  assert.deepEqual(JSON.parse(request.options.body), {
    messaging_product: "whatsapp",
    to: "919876543210",
    type: "reaction",
    reaction: { message_id: "wamid.original", emoji: "❤️" },
  });
});

test("Meta reaction removal sends an empty emoji", async (t) => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ messages: [{ id: "wamid.remove" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = getProvider({
    provider: "meta",
    accessToken: "tenant-token",
    apiVersion: "v25.0",
    defaultPhoneNumberId: "tenant-phone",
  });
  await provider.sendReaction({ to: "15551234567", messageId: "wamid.original", emoji: "" });
  assert.equal(payload.reaction.emoji, "");
});
