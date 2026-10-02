import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { parseAwsEnvironmentInput, usableAwsEnvironmentValues } from "./aws-environment-input.mjs";
import { serializeEnvironment } from "./amplify-environment.mjs";

test("AWS imports complete unquoted PEMs without consuming the next environment value", () => {
  const keys = generateKeyPairSync("ed25519", { privateKeyEncoding: { format: "pem", type: "pkcs8" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const parsed = parseAwsEnvironmentInput(`SERVICE_TOKEN_PRIVATE_KEY=${keys.privateKey}\nSERVICE_TOKEN_PUBLIC_KEY=${keys.publicKey}\nPLATFORM_PUBLIC_URL=https://example.test\n`);
  assert.equal(parsed.SERVICE_TOKEN_PRIVATE_KEY.trim(), keys.privateKey.trim());
  assert.equal(parsed.SERVICE_TOKEN_PUBLIC_KEY.trim(), keys.publicKey.trim());
  assert.equal(parsed.PLATFORM_PUBLIC_URL, "https://example.test");
  assert.equal(parseAwsEnvironmentInput(`SERVICE_TOKEN_PRIVATE_KEY="${keys.privateKey}"`).SERVICE_TOKEN_PRIVATE_KEY, keys.privateKey);
});

test("AWS SDK import preserves literal dollar signs and complete PEM newlines", () => {
  const keys = generateKeyPairSync("ed25519", { privateKeyEncoding: { format: "pem", type: "pkcs8" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const values = { DATABASE_URL: "postgres://user:pass$LITERAL@host/db", SERVICE_TOKEN_PRIVATE_KEY: keys.privateKey, SERVICE_TOKEN_PUBLIC_KEY: keys.publicKey };
  assert.deepEqual(parseAwsEnvironmentInput(serializeEnvironment(values, { escapeDollar: false })), values);
});

test("masked and placeholder source values cannot replace usable AWS configuration", () => {
  assert.deepEqual(usableAwsEnvironmentValues({ PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY: "********2a03", NEXT_PUBLIC_SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co", AUTH_EMAIL_FROM: "AgenticThat <accounts@example.test>", DATABASE_URL: "postgres://host/db", BLANK: "", API_KEY: "<original-key>" }), { AUTH_EMAIL_FROM: "AgenticThat <accounts@example.test>", DATABASE_URL: "postgres://host/db" });
});
