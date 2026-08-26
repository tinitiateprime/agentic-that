import assert from "node:assert/strict";
import test from "node:test";
import { savedContactRecipient } from "./recipient-utils.js";

test("saved contact delivery prefers a routable Telegram username over a privacy-limited phone", () => {
  assert.equal(
    savedContactRecipient({ handle: "myacc1", countryCode: "+91", phone: "+916309123487" }, ["+91"]),
    "@myacc1"
  );
});

test("saved contact delivery uses a Telegram username when no phone is saved", () => {
  assert.equal(savedContactRecipient({ handle: "myacc1", phone: "" }, ["+91"]), "@myacc1");
});

test("saved contact delivery uses the selected full phone when no username is saved", () => {
  assert.equal(savedContactRecipient({ handle: "", countryCode: "+91", phone: "6281246483" }, ["+91"]), "+916281246483");
});
