import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

const keys = generateKeyPairSync("ed25519", { privateKeyEncoding: { format: "pem", type: "pkcs8" }, publicKeyEncoding: { format: "pem", type: "spki" } });
const environment = {
  DATABASE_URL: "postgres://test:test@localhost/test",
  SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  USER_PROVISIONING_KEY: "test-provisioning-key",
  CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  SERVICE_TOKEN_PRIVATE_KEY: keys.privateKey,
  SERVICE_TOKEN_PUBLIC_KEY: keys.publicKey,
  PLATFORM_SUPER_ADMIN_EMAILS: "admin@example.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  PLATFORM_PUBLIC_URL: "https://example.test",
  AUTH_EMAIL_FROM: "AgenticThat <accounts@example.test>",
  RESEND_API_KEY: "test-email-key",
  AUTH_RATE_LIMIT_PEPPER: "test-pepper",
  BACKGROUND_JOB_FUNCTION_NAME: "test-worker",
  META_APP_SECRET: "test-app-secret",
};
function check(overrides = {}) {
  return spawnSync(process.execPath, ["scripts/check-production-config.mjs", "--amplify"], { env: { ...process.env, ...environment, ...overrides }, encoding: "utf8" });
}

test("AWS production validation accepts the PEM encodings supported by runtime", () => {
  for (const encode of [value => value, value => value.replaceAll("\n", "\\n"), value => Buffer.from(value).toString("base64")]) {
    const result = check({ SERVICE_TOKEN_PRIVATE_KEY: encode(keys.privateKey), SERVICE_TOKEN_PUBLIC_KEY: encode(keys.publicKey) });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("missing original credentials, mismatched keys and incomplete explicit Lambda mode stop production configuration", () => {
  const missing = check({ SESSION_ENCRYPTION_KEY: "", BACKGROUND_JOB_FUNCTION_NAME: "", BACKGROUND_JOB_MODE: "lambda" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SESSION_ENCRYPTION_KEY is required/);
  assert.match(missing.stderr, /BACKGROUND_JOB_FUNCTION_NAME is required/);
  const other = generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" });
  const mismatched = check({ SERVICE_TOKEN_PUBLIC_KEY: other });
  assert.equal(mismatched.status, 1);
  assert.match(mismatched.stderr, /matching Ed25519 pair/);
  assert.equal(check({ PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY: "********2a03" }).status, 1);
});

test("Amplify can deploy with private project-key persistence and request-driven AI", () => {
  const result = check({ PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY: "", BACKGROUND_JOB_FUNCTION_NAME: "", BACKGROUND_JOB_MODE: "auto" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(check({ BACKGROUND_JOB_MODE: "detached" }).status, 1);
});
