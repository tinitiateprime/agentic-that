const environment = process.env;
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
required("NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG");
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
if (String(environment.NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG || "").includes("-qa.")) {
  errors.push("NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG must reference a stable signed release.");
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
