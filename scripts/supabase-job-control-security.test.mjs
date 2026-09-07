import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/202609020001_companion_job_control.sql", import.meta.url);
const duplicateAccountRecoveryUrl = new URL("../supabase/migrations/202609050002_companion_duplicate_account_recovery.sql", import.meta.url);
const runnerUrl = new URL("../services/publishing/queue-runner/server/index.ts", import.meta.url);
const instagramClientUrl = new URL("../services/scraping/instagram/console/src/companionClient.js", import.meta.url);
const facebookClientUrl = new URL("../services/scraping/facebook/console/src/companionClient.js", import.meta.url);
const scrapingRouteUrl = new URL("../app/api/job-control/scraping/[...path]/route.js", import.meta.url);
const publishingRouteUrl = new URL("../app/api/publishing/[...path]/route.js", import.meta.url);

test("Supabase control tables are RLS locked and only scoped RPCs are granted", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["companion_devices", "social_accounts", "jobs", "job_events", "job_results", "job_artifacts"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"));
  }
  for (const fn of ["companion_redeem_pairing", "companion_heartbeat", "companion_claim_jobs", "companion_update_job"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}`, "i"));
  }
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /final_action_started_at/i);
  assert.match(sql, /p_final_action boolean/i);
  assert.match(sql, /p_instance_id text/i);
  assert.match(sql, /token belongs to a different installation/i);
  assert.doesNotMatch(sql, /account - array/i);
});

test("Companion uses Supabase RPC and never embeds an elevated Supabase key", async () => {
  const runner = await readFile(runnerUrl, "utf8");
  assert.match(runner, /\/rest\/v1\/rpc\/\$\{encodeURIComponent\(name\)\}/);
  assert.doesNotMatch(runner, /SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY/);
  assert.doesNotMatch(runner, /X-AgenticThat-Companion-Token/);
  assert.doesNotMatch(runner, /\/api\/publishing\/companion\/jobs/);
});

test("duplicate account handles cannot block Companion heartbeat session updates", async () => {
  const [schema, recovery] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(duplicateAccountRecoveryUrl, "utf8"),
  ]);
  assert.doesNotMatch(schema, /create unique index if not exists social_accounts_workspace_platform_handle_nonempty_idx/i);
  assert.match(schema, /create index if not exists social_accounts_workspace_platform_handle_lookup_idx/i);
  assert.match(recovery, /drop index if exists public\.social_accounts_workspace_platform_handle_nonempty_idx/i);
  assert.match(recovery, /create index if not exists social_accounts_workspace_platform_handle_lookup_idx/i);
});

test("scraping clients no longer require the Chrome extension or loopback transport", async () => {
  const clients = `${await readFile(instagramClientUrl, "utf8")}\n${await readFile(facebookClientUrl, "utf8")}`;
  assert.match(clients, /\/api\/job-control\/scraping\//);
  assert.doesNotMatch(clients, /publishingExtension/);
  assert.doesNotMatch(clients, /127\.0\.0\.1:8792/);
});

test("web job creation remains workspace-authorized and rejects session material", async () => {
  const route = await readFile(scrapingRouteUrl, "utf8");
  assert.match(route, /authorizeApiCapability\("scraping\.run"\)/);
  assert.match(route, /principal\.workspaceId/);
  for (const sensitive of ["password", "secret", "apiKey", "cookies", "storageState", "accessToken", "refreshToken", "session"]) {
    assert.match(route, new RegExp(sensitive, "i"));
  }
});

test("legacy website-to-Companion polling endpoints are retired", async () => {
  const route = await readFile(publishingRouteUrl, "utf8");
  assert.doesNotMatch(route, /x-agenticthat-companion-token/i);
  assert.match(route, /Companion job transport moved to Supabase RPC/);
  assert.match(route, /status: 410/);
});
