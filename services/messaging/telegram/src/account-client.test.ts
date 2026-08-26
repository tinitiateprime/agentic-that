import assert from "node:assert/strict";
import test from "node:test";
import { telegramPhoneMatchesUser } from "./account-client.ts";

test("a connected Telegram account recognizes its own international phone number", () => {
  assert.equal(telegramPhoneMatchesUser("+91 62812 46483", "916281246483"), true);
  assert.equal(telegramPhoneMatchesUser("+916281246483", "+916281246483"), true);
  assert.equal(telegramPhoneMatchesUser("+916281246483", "918799445479"), false);
  assert.equal(telegramPhoneMatchesUser("invalid", "916281246483"), false);
});
