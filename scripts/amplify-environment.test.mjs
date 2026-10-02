import assert from "node:assert/strict";
import test from "node:test";
import nextEnvironment from "@next/env";
import { amplifyEnvironment, serializeEnvironment, workerEnvironment } from "./amplify-environment.mjs";

test("Amplify forwards app configuration and excludes AWS build credentials and old provider state", () => {
  const values = amplifyEnvironment({ DATABASE_URL: "postgres://host/db", DATA_STORE: "netlify-blobs", RUN_DATABASE_MIGRATIONS: "true", AWS_SECRET_ACCESS_KEY: "secret", NETLIFY_AUTH_TOKEN: "old-token", NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co" });
  assert.equal(values.DATA_STORE, "postgres");
  assert.equal(values.RUN_DATABASE_MIGRATIONS, "false");
  assert.equal(values.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(values.NETLIFY_AUTH_TOKEN, undefined);
  assert.equal(values.NEXT_PUBLIC_SUPABASE_URL, "https://test.supabase.co");
});

test("AWS retains supported legacy keys and limits worker secrets to its services", () => {
  const values = amplifyEnvironment({ SUPABASE_SERVICE_ROLE_KEY: "legacy-key", GOOGLE_API_KEY: "ai-key", GEMINI_BACKGROUND_TIMEOUT_MS: "180000", SESSION_ENCRYPTION_KEY: "session-key", DATABASE_URL: "postgres://host/db" });
  assert.equal(values.SUPABASE_SERVICE_ROLE_KEY, "legacy-key");
  const worker = workerEnvironment(values);
  assert.equal(worker.GOOGLE_API_KEY, "ai-key");
  assert.equal(worker.GEMINI_BACKGROUND_TIMEOUT_MS, "180000");
  assert.equal(worker.DATABASE_URL, "postgres://host/db");
  assert.equal(worker.SESSION_ENCRYPTION_KEY, undefined);
  assert.equal(worker.SUPABASE_SERVICE_ROLE_KEY, undefined);
});

test("Next.js reads PEM newlines and literal dollar signs from the AWS runtime file", () => {
  const values = { TEST_AWS_PEM: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n", TEST_AWS_URL: "postgres://user:pass$NO_SUCH_VARIABLE@host/db" };
  const [, parsed] = nextEnvironment.processEnv([{ path: ".env.production", contents: serializeEnvironment(values), env: {} }], undefined, console, true);
  assert.equal(parsed.TEST_AWS_PEM, values.TEST_AWS_PEM);
  assert.equal(parsed.TEST_AWS_URL, values.TEST_AWS_URL);
});
