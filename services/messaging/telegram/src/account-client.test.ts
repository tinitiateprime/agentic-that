import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { telegramPhoneMatchesUser } from "./account-client.ts";

test("a connected Telegram account recognizes its own international phone number", () => {
  assert.equal(telegramPhoneMatchesUser("+91 62812 46483", "916281246483"), true);
  assert.equal(telegramPhoneMatchesUser("+916281246483", "+916281246483"), true);
  assert.equal(telegramPhoneMatchesUser("+916281246483", "918799445479"), false);
  assert.equal(telegramPhoneMatchesUser("invalid", "916281246483"), false);
});

test("phone delivery checks the connected account's contacts and dialogs before import", async () => {
  const source = await readFile(new URL("./account-client.ts", import.meta.url), "utf8");
  assert.match(source, /contacts\.GetContacts/);
  assert.match(source, /client\.iterDialogs\(\{ limit: 500 \}\)/);
  assert.ok(source.indexOf("resolveExistingPhoneContact(client, recipient)") < source.indexOf("importPhoneContact(client, input)"));
});
