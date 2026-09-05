import dotenv from "dotenv";
import { readFile } from "node:fs/promises";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

if (!process.env.DATABASE_URL?.trim() && !process.env.SUPABASE_DB_URL?.trim()) {
  throw new Error("DATABASE_URL or SUPABASE_DB_URL is required for the platform migration.");
}

process.env.RUN_DATABASE_MIGRATIONS = "true";
const { getPlatformSql } = await import("../src/platform/server/auth-store.js");
const sql = await getPlatformSql();

try {
  const jobControlMigrations = [
    "../supabase/migrations/202609020001_companion_job_control.sql",
    "../supabase/migrations/202609030001_external_browser_session_status.sql",
    "../supabase/migrations/202609040001_companion_legacy_session_recovery.sql",
    "../supabase/migrations/202609040002_chunked_publishing_artifacts.sql",
    "../supabase/migrations/202609040003_instagram_media_compatibility.sql",
    "../supabase/migrations/202609040004_facebook_session_persistence.sql",
    "../supabase/migrations/202609050001_youtube_options_and_facebook_scraping.sql",
    "../supabase/migrations/202609050002_companion_duplicate_account_recovery.sql",
  ];
  for (const migrationPath of jobControlMigrations) {
    await sql.unsafe(await readFile(new URL(migrationPath, import.meta.url), "utf8"));
  }
  const [documentRelation] = await sql`SELECT to_regclass('agentic_that.app_document_store') AS relation`;
  if (documentRelation?.relation) {
    const [legacy] = await sql`
      SELECT value FROM agentic_that.app_document_store
       WHERE key = 'platform.publishing-central.v1' LIMIT 1`;
    if (legacy?.value) {
      const { synchronizePublishingJobs } = await import("../src/platform/server/supabase-job-control.js");
      const value = legacy.value;
      const accounts = Array.isArray(value.accounts) ? value.accounts : [];
      const uploads = Array.isArray(value.uploads) ? value.uploads : [];
      const jobs = Array.isArray(value.jobs) ? value.jobs : [];
      const workspaceIds = [...new Set(accounts.map((item) => item.workspaceId).filter(Boolean))];
      for (const workspaceId of workspaceIds) {
        await synchronizePublishingJobs(
          workspaceId,
          jobs.filter((item) => item.workspaceId === workspaceId),
          uploads.filter((item) => item.workspaceId === workspaceId),
          accounts.filter((item) => item.workspaceId === workspaceId),
        );
      }
    }
  }
  const [status] = await sql`
    SELECT
      to_regclass('public.platform_users') IS NOT NULL AS platform_users_ready,
      to_regclass('public.workspace_memberships') IS NOT NULL AS memberships_ready,
      to_regclass('public.rbac_roles') IS NOT NULL AS roles_ready,
      to_regclass('public.companion_devices') IS NOT NULL AS companion_devices_ready,
      to_regclass('public.jobs') IS NOT NULL AS jobs_ready,
      to_regprocedure('public.companion_claim_jobs(text,text,integer)') IS NOT NULL AS companion_rpc_ready,
      (SELECT value FROM public.job_control_settings WHERE key = 'minimum_companion_version') AS minimum_companion_version`;
  if (!status?.platform_users_ready || !status?.memberships_ready || !status?.roles_ready
      || !status?.companion_devices_ready || !status?.jobs_ready || !status?.companion_rpc_ready
      || status?.minimum_companion_version !== "2.1.7") {
    throw new Error("The platform database migration did not create every required table.");
  }
  process.stdout.write("Platform and Companion job-control database migrations are ready.\n");
} finally {
  await sql.end();
}
