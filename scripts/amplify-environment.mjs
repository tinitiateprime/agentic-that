import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
export const environmentNames = new Set([...sample.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]));
for (const key of ["BACKGROUND_JOB_FUNCTION_NAME", "BACKGROUND_JOB_REGION", "HOSTING_PROVIDER", "SERVERLESS", "PG_POOL_MAX", "PG_IDLE_TIMEOUT_SECONDS", "RUN_DATABASE_MIGRATIONS", "SUPABASE_DB_URL", "SUPABASE_DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "GOOGLE_API_KEY", "GEMINI_BACKGROUND_TIMEOUT_MS", "GEMINI_WEBSITE_EMERGENCY_MODEL", "TELEGRAM_MEDIA_DOWNLOAD_TIMEOUT_MS", "TELEGRAM_MEDIA_MAX_BYTES", "COMPANION_RELEASE_TAG", "NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG", "MINIMUM_COMPANION_VERSION"]) environmentNames.add(key);

export function amplifyEnvironment(source) {
  const values = {};
  for (const key of environmentNames) if (source[key]?.trim()) values[key] = source[key];
  return {
    ...values,
    HOSTING_PROVIDER: "aws-amplify",
    SERVERLESS: "true",
    DATA_STORE: "postgres",
    TELEGRAM_DATA_STORE: "postgres",
    SESSION_COOKIE_SECURE: "true",
    RBAC_ENFORCEMENT_MODE: "enforce",
    NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS: "false",
    NEXT_DIST_DIR: ".next",
    PG_POOL_MAX: "1",
    PG_IDLE_TIMEOUT_SECONDS: "5",
    RUN_DATABASE_MIGRATIONS: "false",
  };
}

export function workerEnvironment(values) {
  const names = new Set(["DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_DATABASE_URL", "PLATFORM_PUBLIC_URL", "AUTH_EMAIL_FROM", "RESEND_API_KEY", "AUTH_EMAIL_WEBHOOK_URL", "AUTH_EMAIL_WEBHOOK_SECRET", "EMAIL_STUDIO_SENDERS", "EMAIL_STUDIO_DEFAULT_SENDER", "PEXELS_API_KEY", "GOOGLE_API_KEY", "SERVERLESS", "DATA_STORE", "PG_POOL_MAX", "PG_IDLE_TIMEOUT_SECONDS"]);
  return Object.fromEntries(Object.entries(values).filter(([name]) => names.has(name) || /^(GEMINI_|INSTAGRAM_|FACEBOOK_)/.test(name)));
}

export function serializeEnvironment(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value).replaceAll("$", "\\$")}`).join("\n") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const values = amplifyEnvironment(process.env);
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  // A private allowlist preserves PEM newlines and excludes CI/AWS credentials.
  // This file is a server artifact and is never committed or served publicly.
  writeFileSync(".env.production", serializeEnvironment(values), { mode: 0o600 });
  console.log(`Prepared ${Object.keys(values).length} Amplify runtime variables; values hidden.`);
}
