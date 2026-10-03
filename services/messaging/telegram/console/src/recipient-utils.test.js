import assert from "node:assert/strict";
import test from "node:test";
import { savedContactRecipient } from "./recipient-utils.js";

test("saved contact delivery prefers its phone over an optional username", () => {
  assert.equal(
    savedContactRecipient({ handle: "myacc1", countryCode: "+91", phone: "+916309123487" }, ["+91"]),
    "+916309123487"
  );
});

test("saved contact delivery uses a Telegram username when no phone is saved", () => {
  assert.equal(savedContactRecipient({ handle: "myacc1", phone: "" }, ["+91"]), "@myacc1");
});
