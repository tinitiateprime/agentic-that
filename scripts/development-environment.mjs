import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const databaseUrl = (environment) => (
  environment.DATABASE_URL || environment.SUPABASE_DB_URL || environment.SUPABASE_DATABASE_URL || ""
).trim();

export function nextDevelopmentEnvironment(projectRoot, inherited = process.env) {
  const serviceRoot = path.join(projectRoot, "services", "messaging", "whatsapp");
  const serviceFile = [".env.local", ".env"]
    .map((name) => path.join(serviceRoot, name))
    .find((file) => existsSync(file));
  const serviceEnvironment = serviceFile ? parseEnv(readFileSync(serviceFile, "utf8")) : {};
  const rootEnvironment = {};
  for (const name of [".env", ".env.local"]) {
    const file = path.join(projectRoot, name);
    if (existsSync(file)) Object.assign(rootEnvironment, parseEnv(readFileSync(file, "utf8")));
  }

  // Next.js keeps inherited variables ahead of .env.local. Resolve the shared
  // database first so the WhatsApp fallback cannot pin the app to an old host.
  const sharedUrl = databaseUrl(inherited) || databaseUrl(rootEnvironment) || databaseUrl(serviceEnvironment);
  return {
    ...serviceEnvironment,
    ...inherited,
    ...(sharedUrl ? { DATABASE_URL: sharedUrl } : {}),
  };
}
