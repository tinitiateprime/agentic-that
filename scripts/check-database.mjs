import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

let sql;
try {
  const url = (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
  if (!url) throw Object.assign(new Error(), { code: "DATABASE_URL_MISSING" });
  const target = new URL(url);
  sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, onnotice: () => {} });
  const status = await sql.begin("read only", async (transaction) => {
    await transaction`SET LOCAL statement_timeout = '10s'`;
    const [server] = await transaction`
      SELECT current_database() AS database, current_user AS username,
             current_setting('server_version') AS version`;
    const required = [
      "public.platform_users", "public.platform_sessions", "public.platform_workspaces",
      "public.workspace_memberships", "public.rbac_roles", "public.rbac_role_grants",
      "public.user_role_assignments", "public.user_role_entitlements",
      "public.users", "public.businesses", "public.contacts", "public.messages",
      "public.platform_auth_migrations", "public.app_schema_migrations",
      "agentic_that.app_document_store",
    ];
    const relations = await transaction`
      SELECT name, to_regclass(name) IS NOT NULL AS present
        FROM unnest(${required}::text[]) AS name`;
    const missing = relations.filter((relation) => !relation.present).map((relation) => relation.name);
    if (!missing.includes("public.platform_auth_migrations")) {
      const [migration] = await transaction`
        SELECT key FROM public.platform_auth_migrations WHERE key = 'platform-rbac-schema-v2'`;
      if (!migration) missing.push("platform-rbac-schema-v2 migration");
    }
    if (!missing.includes("public.app_schema_migrations")) {
      const [migration] = await transaction`
        SELECT key FROM public.app_schema_migrations WHERE key = 'whatsapp-schema-v2-reactions'`;
      if (!migration) missing.push("whatsapp-schema-v2-reactions migration");
    }
    if (process.env.COMPANION_RPC_TRANSPORT === "postgres") {
      const signatures = [
        "public.companion_redeem_pairing(text,text,text,text,text,boolean)",
        "public.companion_heartbeat(text,text,text,text,text,text,text,text,boolean,jsonb)",
        "public.companion_claim_jobs(text,text,integer)",
        "public.companion_update_job(text,text,text,text,jsonb,text,boolean,jsonb,jsonb,boolean)",
      ];
      const functions = await transaction`
        SELECT name, to_regprocedure(name) IS NOT NULL AS present
          FROM unnest(${signatures}::text[]) AS name`;
      missing.push(...functions.filter((routine) => !routine.present).map((routine) => routine.name));
    }
    const [connection] = await transaction`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
    return { ...server, ssl: connection?.ssl ?? null, missing };
  });
  console.log(JSON.stringify({ ok: status.missing.length === 0, host: target.hostname, ...status }, null, 2));
  if (status.missing.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || "DATABASE_CHECK_FAILED",
    message: "Check the database URL, credentials, network access, and schema permissions.",
  }, null, 2));
  process.exitCode = 1;
} finally {
  await sql?.end({ timeout: 2 });
}
