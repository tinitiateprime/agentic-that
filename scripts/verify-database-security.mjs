import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const url = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
if (!url) throw new Error("DATABASE_URL or SUPABASE_DB_URL is required for database security verification.");
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15 });

try {
  const unrestricted = await sql`
    SELECT namespace.nspname AS schema_name, relation.relname AS table_name
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
       AND NOT relation.relrowsecurity
     ORDER BY relation.relname`;
  if (unrestricted.length) {
    throw new Error(`Public tables without RLS: ${unrestricted.map((row) => row.table_name).join(", ")}`);
  }

  const directGrants = await sql`
    SELECT grantee, table_name, privilege_type
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND grantee IN ('PUBLIC', 'anon', 'authenticated')
     ORDER BY grantee, table_name, privilege_type`;
  if (directGrants.length) {
    throw new Error(`Browser roles still have direct table grants: ${directGrants.map((row) => `${row.grantee}.${row.table_name}.${row.privilege_type}`).join(", ")}`);
  }

  const sequenceGrants = await sql`
    SELECT grantee, object_name, privilege_type
      FROM information_schema.usage_privileges
     WHERE object_schema = 'public' AND object_type = 'SEQUENCE'
       AND grantee IN ('PUBLIC', 'anon', 'authenticated')
     ORDER BY grantee, object_name, privilege_type`;
  if (sequenceGrants.length) {
    throw new Error(`Browser roles still have sequence grants: ${sequenceGrants.map((row) => `${row.grantee}.${row.object_name}.${row.privilege_type}`).join(", ")}`);
  }

  const unexpectedFunctions = await sql`
    SELECT grantee, routine_name
      FROM information_schema.routine_privileges
     WHERE routine_schema = 'public'
       AND grantee IN ('PUBLIC', 'anon', 'authenticated')
       AND routine_name NOT IN (
         'companion_redeem_pairing', 'companion_heartbeat',
         'companion_claim_jobs', 'companion_update_job'
       )
     ORDER BY grantee, routine_name`;
  if (unexpectedFunctions.length) {
    throw new Error(`Browser roles can execute unexpected public functions: ${unexpectedFunctions.map((row) => `${row.grantee}.${row.routine_name}`).join(", ")}`);
  }

  const [tables] = await sql`
    SELECT
      to_regclass('agentic_that.telegram_accounts') IS NOT NULL AS telegram,
      to_regclass('agentic_that.publishing_uploads') IS NOT NULL AS publishing,
      to_regclass('public.platform_auth_rate_limits') IS NOT NULL AS auth_security`;
  if (!tables?.telegram || !tables?.publishing || !tables?.auth_security) {
    throw new Error("Normalized Telegram, Publishing, or authentication security tables are missing.");
  }
  process.stdout.write("Database RLS, grants, and normalized security tables are verified.\n");
} finally {
  await sql.end();
}
