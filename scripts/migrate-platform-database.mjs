import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

if (!process.env.DATABASE_URL?.trim() && !process.env.SUPABASE_DB_URL?.trim()) {
  throw new Error("DATABASE_URL or SUPABASE_DB_URL is required for the platform migration.");
}

const { getPlatformSql } = await import("../src/platform/server/auth-store.js");
const sql = await getPlatformSql();

try {
  const [status] = await sql`
    SELECT
      to_regclass('public.platform_users') IS NOT NULL AS platform_users_ready,
      to_regclass('public.workspace_memberships') IS NOT NULL AS memberships_ready,
      to_regclass('public.rbac_roles') IS NOT NULL AS roles_ready`;
  if (!status?.platform_users_ready || !status?.memberships_ready || !status?.roles_ready) {
    throw new Error("The platform database migration did not create every required table.");
  }
  process.stdout.write("Platform database migration is ready.\n");
} finally {
  await sql.end();
}
