import assert from "node:assert/strict";
import test from "node:test";
import { resolveTelegramApiCredentials, telegramSendError } from "./server.ts";

test("per-connection Telegram API credentials are accepted when no shared identity exists", () => {
  assert.deepEqual(resolveTelegramApiCredentials({
    telegramApiId: "123456",
    telegramApiHash: "0123456789abcdef0123456789abcdef"
  }, null), {
    apiId: 123456,
    apiHash: "0123456789abcdef0123456789abcdef"
  });
});

test("shared Telegram API credentials keep the connection form phone-only", () => {
  const shared = { apiId: 654321, apiHash: "fedcba9876543210fedcba9876543210" };
  assert.equal(resolveTelegramApiCredentials({}, shared), shared);
});

test("missing per-connection Telegram API credentials return a useful client error", () => {
  assert.throws(
    () => resolveTelegramApiCredentials({}, null),
    (error: unknown) => Boolean(
      error instanceof Error &&
      "status" in error &&
      error.status === 400 &&
      /telegramApiId is required/i.test(error.message)
    )
  );
});

test("paid-message rejection explains that Stars are not spent automatically", () => {
  const error = telegramSendError(
    new Error("406: ALLOW_PAYMENT_REQUIRED (caused by messages.SendMedia)"),
    "@tester"
  );

  assert.equal(error.status, 402);
  assert.match(error.message, /@tester only accepts paid Telegram messages/);
  assert.match(error.message, /will not spend Stars automatically/);
});

test("paid-message rejection includes Telegram's required Star amount", () => {
  const error = telegramSendError(new Error("ALLOW_PAYMENT_REQUIRED_5"), "@paid_user");

  assert.equal(error.status, 402);
  assert.match(error.message, /requires 5 Telegram Stars per message/);
});

test("unconfirmed Telegram sends are never reported as successful", () => {
  const error = telegramSendError(new Error("Telegram did not return a message ID, so delivery could not be confirmed."));

  assert.equal(error.status, 502);
  assert.match(error.message, /delivery could not be confirmed/);
});
