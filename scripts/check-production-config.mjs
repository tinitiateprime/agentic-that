import crypto from "node:crypto";
import { amplifyEnvironment } from "./amplify-environment.mjs";

const environment = process.argv.includes("--amplify") ? amplifyEnvironment(process.env) : process.env;
const errors = [];

function required(name, alternatives = []) {
  const names = [name, ...alternatives];
  if (!names.some((key) => String(environment[key] || "").trim())) {
    errors.push(`${names.join(" or ")} is required.`);
  }
}

function falseValue(name) {
  if (["1", "true", "yes", "on", "enabled"].includes(String(environment[name] || "").trim().toLowerCase())) {
    errors.push(`${name} must be false in production.`);
  }
}

required("DATABASE_URL", ["SUPABASE_DB_URL"]);
required("SESSION_ENCRYPTION_KEY");
required("USER_PROVISIONING_KEY");
required("CREDENTIAL_ENCRYPTION_KEY");
required("PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY");
required("SERVICE_TOKEN_PRIVATE_KEY");
required("SERVICE_TOKEN_PUBLIC_KEY");
required("PLATFORM_SUPER_ADMIN_EMAILS");
required("NEXT_PUBLIC_SUPABASE_URL");
required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
required("SUPABASE_SECRET_KEY", ["SUPABASE_SERVICE_ROLE_KEY"]);
required("PLATFORM_PUBLIC_URL");
required("AUTH_EMAIL_FROM");
required("RESEND_API_KEY", ["AUTH_EMAIL_WEBHOOK_URL"]);
required("AUTH_RATE_LIMIT_PEPPER");
falseValue("NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS");

if (String(environment.RBAC_ENFORCEMENT_MODE || "enforce").trim().toLowerCase() !== "enforce") {
  errors.push("RBAC_ENFORCEMENT_MODE must be enforce in production.");
}
if (String(environment.SESSION_COOKIE_SECURE || "true").trim().toLowerCase() === "false") {
  errors.push("SESSION_COOKIE_SECURE must not be false in production.");
}
if (String(environment.TELEGRAM_DATA_STORE || "").trim().toLowerCase() !== "postgres") {
  errors.push("TELEGRAM_DATA_STORE must be postgres in production.");
}
if (String(environment.COMPANION_RELEASE_TAG || environment.NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG || "").includes("-qa.")) {
  errors.push("The Companion release tag must reference a stable signed release.");
}

for (const name of ["CREDENTIAL_ENCRYPTION_KEY", "PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY"]) {
  const value = environment[name]?.trim();
  if (value && (!/^[a-f0-9]{64}$/i.test(value) && Buffer.from(value, "base64").length !== 32)) errors.push(`${name} must encode exactly 32 bytes.`);
}
if (environment.SESSION_ENCRYPTION_KEY && Buffer.from(environment.SESSION_ENCRYPTION_KEY, "base64url").length !== 32) errors.push("SESSION_ENCRYPTION_KEY must encode exactly 32 bytes.");
for (const [name, value] of Object.entries(environment)) {
  if (value && /^\*{3,}/.test(value)) errors.push(`${name} contains a masked value instead of its original value.`);
}
if (environment.SERVICE_TOKEN_PRIVATE_KEY && environment.SERVICE_TOKEN_PUBLIC_KEY) {
  try {
    const privateKey = crypto.createPrivateKey(environment.SERVICE_TOKEN_PRIVATE_KEY);
    const publicKey = crypto.createPublicKey(environment.SERVICE_TOKEN_PUBLIC_KEY);
    if (privateKey.asymmetricKeyType !== "ed25519" || !crypto.createPublicKey(privateKey).equals(publicKey)) throw new Error();
  } catch { errors.push("SERVICE_TOKEN_PRIVATE_KEY and SERVICE_TOKEN_PUBLIC_KEY must be a matching Ed25519 pair."); }
}
if (environment.HOSTING_PROVIDER === "aws-amplify") {
  required("BACKGROUND_JOB_FUNCTION_NAME");
  required("BACKGROUND_JOB_REGION");
  if (environment.DATA_STORE !== "postgres") errors.push("DATA_STORE must be postgres on AWS.");
  if (environment.RUN_DATABASE_MIGRATIONS === "true") errors.push("Apply database migrations separately; RUN_DATABASE_MIGRATIONS must be false on AWS.");
}
const whatsappProvider = String(environment.WA_PROVIDER || "meta").trim().toLowerCase();
if (whatsappProvider === "meta") required("META_APP_SECRET");
if (whatsappProvider === "wati") required("WATI_WEBHOOK_SECRET");
if (whatsappProvider === "baileys") required("BAILEYS_WEBHOOK_SECRET");

if (errors.length) {
  process.stderr.write(`${errors.map((item) => `ERROR: ${item}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("Production configuration is fail-closed and complete.\n");
