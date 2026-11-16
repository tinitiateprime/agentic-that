import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import nextEnvironment from "@next/env";
import { amplifyEnvironment, normalizeEnvironmentAliases, serializeEnvironment, workerEnvironment } from "./amplify-environment.mjs";

test("Amplify forwards app configuration and excludes AWS build credentials and old provider state", () => {
  const values = amplifyEnvironment({ DATABASE_URL: "postgres://host/db", DATA_STORE: "netlify-blobs", RUN_DATABASE_MIGRATIONS: "true", AWS_SECRET_ACCESS_KEY: "secret", NETLIFY_AUTH_TOKEN: "old-token", MEDIA_S3_BUCKET: "agenticthat-media", NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co" });
  assert.equal(values.DATA_STORE, "postgres");
  assert.equal(values.RUN_DATABASE_MIGRATIONS, "false");
  assert.equal(values.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(values.NETLIFY_AUTH_TOKEN, undefined);
  assert.equal(values.MEDIA_S3_BUCKET, "agenticthat-media");
  assert.equal(values.NEXT_PUBLIC_SUPABASE_URL, undefined, "media no longer uses Supabase");
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

test("Amplify preserves the PostgreSQL Companion transport in the server runtime", () => {
  const values = amplifyEnvironment({ COMPANION_RPC_TRANSPORT: "postgres" });
  assert.equal(values.COMPANION_RPC_TRANSPORT, "postgres");
});

test("Next.js reads PEM newlines and literal dollar signs from the AWS runtime file", () => {
  const values = { TEST_AWS_PEM: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n", TEST_AWS_URL: "postgres://user:pass$NO_SUCH_VARIABLE@host/db" };
  const [, parsed] = nextEnvironment.processEnv([{ path: ".env.production", contents: serializeEnvironment(values), env: {} }], undefined, console, true);
  assert.equal(parsed.TEST_AWS_PEM, values.TEST_AWS_PEM);
  assert.equal(parsed.TEST_AWS_URL, values.TEST_AWS_URL);
});

test("escaped console signing keys remain a usable matching pair after Next loads them", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const values = {
    TEST_AWS_PRIVATE_SIGNING_KEY: privatePem.replaceAll("\n", "\\n"),
    TEST_AWS_PUBLIC_SIGNING_KEY: publicPem.replaceAll("\n", "\\n"),
  };
  const [, parsed] = nextEnvironment.processEnv([{ path: ".env.production", contents: serializeEnvironment(values), env: {} }], undefined, console, true);
  const payload = Buffer.from("AWS service identity validation");
  const signature = crypto.sign(null, payload, crypto.createPrivateKey(parsed.TEST_AWS_PRIVATE_SIGNING_KEY));
  assert.equal(crypto.verify(null, payload, crypto.createPublicKey(parsed.TEST_AWS_PUBLIC_SIGNING_KEY), signature), true);
});

test("Amplify keeps paired Companions' identifier and defaults the worker region", () => {
  const values = amplifyEnvironment({ SUPABASE_DATABASE_URL: "postgres://host/db", SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "public-key", SUPABASE_SERVICE_ROLE_KEY: "server-key", AWS_REGION: "eu-west-1" });
  assert.equal(values.DATABASE_URL, "postgres://host/db");
  // Companions paired earlier send the old publishable key; it becomes COMPANION_RPC_API_KEY.
  assert.equal(values.COMPANION_RPC_API_KEY, "public-key");
  assert.equal(amplifyEnvironment({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_live" }).COMPANION_RPC_API_KEY, "sb_publishable_live");
  assert.equal(amplifyEnvironment({ COMPANION_RPC_API_KEY: "explicit", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_live" }).COMPANION_RPC_API_KEY, "explicit");
  assert.equal(values.BACKGROUND_JOB_REGION, "eu-west-1");
  assert.equal(values.AWS_REGION, undefined);
  assert.equal(amplifyEnvironment({}).BACKGROUND_JOB_REGION, "us-east-1");
  assert.equal(amplifyEnvironment({ BACKGROUND_JOB_REGION: "ap-south-1", AWS_REGION: "us-east-1" }).BACKGROUND_JOB_REGION, "ap-south-1");
});

test("AWS production links use www while preserving explicitly configured preview domains", () => {
  for (const origin of [undefined, "https://agenticthat.com", "https://agentic-that.netlify.app", "https://www.agenticthat.com/"]) {
    assert.equal(amplifyEnvironment({ PLATFORM_PUBLIC_URL: origin }).PLATFORM_PUBLIC_URL, "https://www.agenticthat.com");
  }
  assert.equal(amplifyEnvironment({ PLATFORM_PUBLIC_URL: "https://preview.example.test" }).PLATFORM_PUBLIC_URL, "https://preview.example.test");
});

test("canonicalizing each layer preserves newer cloud aliases over a private export", () => {
  const values = amplifyEnvironment({
    ...normalizeEnvironmentAliases({ COMPANION_RPC_API_KEY: "old-local-key", RESEND_API_KEY: "old-email-key" }),
    ...normalizeEnvironmentAliases({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "cloud-public-key", RESEND_API_KEY: "cloud-email-key" }),
  });
  assert.equal(values.COMPANION_RPC_API_KEY, "cloud-public-key");
  assert.equal(values.RESEND_API_KEY, "cloud-email-key");
});
