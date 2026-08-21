import assert from "node:assert/strict";
import test from "node:test";
import { telegramSendError } from "./server.ts";

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
