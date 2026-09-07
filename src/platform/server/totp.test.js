import assert from "node:assert/strict";
import test from "node:test";
import { decodeBase32, encodeBase32, totpCode, verifyTotp } from "./totp.js";

test("base32 secrets round-trip", () => {
  const value = Buffer.from("12345678901234567890");
  assert.deepEqual(decodeBase32(encodeBase32(value)), value);
});
test("TOTP follows the RFC 6238 SHA-1 test vector after six-digit truncation", () => {
  const secret = encodeBase32(Buffer.from("12345678901234567890"));
  assert.equal(totpCode(secret, 59_000), "287082");
  assert.equal(verifyTotp(secret, "287082", 59_000), true);
  assert.equal(verifyTotp(secret, "000000", 59_000), false);
});
