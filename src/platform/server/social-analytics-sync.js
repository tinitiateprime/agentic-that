// Social Manager → automatic updates. A company saves its own Instagram
// profile and Facebook Page link once. Every night the paired Companion
// collects those posts' public numbers with the scrapers it already has (the
// database queues that job when the Companion asks for work; see
// supabase/migrations/202611260001_social_analytics_auto_sync.sql), and this
// module adds the finished results to the analytics when the page is opened.
import crypto from "node:crypto";
import { checkProfileLink, postsFromScrape } from "../social-analytics/from-scrape.js";
import { getPlatformSql } from "./auth-store.js";
import { importScrapedPosts } from "./social-analytics-store.js";
import { createSupabaseJob, latestSupabaseCompanion } from "./supabase-job-control.js";

export const SYNC_PLATFORMS = ["instagram", "facebook"];
const LABELS = { instagram: "Instagram", facebook: "Facebook" };
const ACTIVE = new Set(["queued", "waiting_for_companion", "claimed", "running", "cancel_requested"]);
const FAILED = new Set(["failed", "uncertain", "cancelled", "reconnect_required"]);

/** The scrape request; the same as private.social_analytics_sync_payload in SQL. */
export function syncPayload(source) {
  return {
    source: "social-analytics",
    sourceId: source.id,
    mode: "profile_url",
    query: source.profile_url,
    profile_type: "page",
    collection_mode: "latest",
    max_results: 50,
    recent_days: 365,
    skip_comments: true,
    timezone_offset_minutes: source.timezone_offset_minutes,
  };
}

function publicSource(platform, row) {
  return {
    platform,
    label: LABELS[platform],
    profileUrl: row?.profile_url || "",
    enabled: Boolean(row?.enabled),
    status: row ? row.last_status : "never",
    message: row?.last_message || "",
    lastSyncedAt: row?.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
    lastQueuedAt: row?.last_queued_at ? new Date(row.last_queued_at).toISOString() : null,
  };
}

const failureText = (job, error) => {
  const message = String(error?.message || job.message || "").trim();
  return message || "The Companion couldn't collect the posts. It will try again tonight.";
};

/** Brings each source's status up to date and imports finished results (once per job). */
export async function refreshSyncResults(workspaceId) {
  const sql = await getPlatformSql();
  const sources = await sql`
    SELECT s.*, j.status AS job_status, j.message AS job_message, j.error AS job_error,
           r.result AS job_result, r.error AS result_error
      FROM public.social_analytics_sources s
      LEFT JOIN public.jobs j ON j.id = s.last_job_id AND j.workspace_id = s.workspace_id
      LEFT JOIN public.job_results r ON r.job_id = j.id
     WHERE s.workspace_id = ${workspaceId}
       AND s.last_job_id IS NOT NULL
       AND s.last_imported_job_id IS DISTINCT FROM s.last_job_id`;

  for (const source of sources) {
    const status = source.job_status;
    let next;
    if (!status) {
      next = { last_status: "failed", last_message: "The update job is missing. It will be queued again tonight.", imported: true };
    } else if (ACTIVE.has(status)) {
      const running = status === "claimed" || status === "running";
      next = { last_status: running ? "running" : "queued", last_message: running ? "The Companion is collecting your posts." : "Waiting for the Companion.", imported: false };
    } else if (status === "success") {
      const posts = postsFromScrape(source.platform, source.job_result || {});
      if (!posts.length) {
        next = { last_status: "failed", last_message: `No posts were found at ${source.profile_url}. Check that the link is your ${LABELS[source.platform]} profile and that it is public.`, imported: true };
      } else {
        const saved = await importScrapedPosts(workspaceId, {
          jobId: source.last_job_id,
          platform: source.platform,
          posts,
          label: `Automatic update · ${LABELS[source.platform]}`,
        });
        next = { last_status: "synced", last_message: `${posts.length} posts updated${saved.added ? `, ${saved.added} new` : ""}.`, imported: true, synced: true };
      }
    } else if (FAILED.has(status)) {
      next = { last_status: "failed", last_message: failureText({ message: source.job_message }, source.job_error || source.result_error), imported: true };
    } else {
      continue;
    }
    if (next.last_status === source.last_status && next.last_message === source.last_message && !next.imported) continue;
    await sql`
      UPDATE public.social_analytics_sources SET
        last_status = ${next.last_status},
        last_message = ${next.last_message.slice(0, 500)},
        last_imported_job_id = CASE WHEN ${next.imported} THEN last_job_id ELSE last_imported_job_id END,
        last_synced_at = CASE WHEN ${Boolean(next.synced)} THEN now() ELSE last_synced_at END,
        updated_at = now()
      WHERE id = ${source.id} AND last_job_id = ${source.last_job_id}`;
  }
}

// Until the auto-sync migration is applied, Social Manager works as before.
const missingTable = (error) => error?.code === "42P01" || /social_analytics_sources/.test(String(error?.message || "")) && /does not exist/.test(String(error?.message || ""));

/** refreshSyncResults + syncOverview for the page; null when automatic updates aren't set up on this database. */
export async function autoSyncState(workspaceId) {
  try {
    await refreshSyncResults(workspaceId);
    return await syncOverview(workspaceId);
  } catch (error) {
    if (missingTable(error)) return null;
    console.error("Social Manager automatic updates could not be read", error);
    return null;
  }
}

/** Both sources (saved or not) and whether a Companion is there to run them. */
export async function syncOverview(workspaceId) {
  const sql = await getPlatformSql();
  const rows = await sql`SELECT * FROM public.social_analytics_sources WHERE workspace_id = ${workspaceId}`;
  const companion = await latestSupabaseCompanion(workspaceId).catch(() => null);
  return {
    companion: { status: !companion ? "unpaired" : companion.status === "offline" ? "offline" : "online" },
    sources: SYNC_PLATFORMS.map((platform) => publicSource(platform, rows.find((row) => row.platform === platform))),
  };
}

async function queueNow(sql, principal, source) {
  const job = await createSupabaseJob({
    workspaceId: principal.workspaceId,
    userId: principal.userId,
    type: `scrape.${source.platform}`,
    platform: source.platform,
    idempotencyKey: `social-analytics:${source.id}:now:${crypto.randomUUID()}`,
    payload: syncPayload(source),
    priority: 120,
    maxAttempts: 2,
  });
  await sql`
    UPDATE public.social_analytics_sources SET
      last_job_id = ${job.id}, last_queued_at = now(), last_status = 'queued',
      last_message = 'Waiting for the Companion.', updated_at = now()
    WHERE id = ${source.id}`;
}

/** Saves (or turns off) a profile link, then collects its posts straight away. */
export async function saveSyncSource(principal, { platform, profileUrl, enabled = true, timezoneOffsetMinutes = 0 }) {
  if (!SYNC_PLATFORMS.includes(platform)) throw Object.assign(new Error("Automatic updates work for Instagram and Facebook."), { status: 400 });
  const sql = await getPlatformSql();
  const offset = Math.max(-840, Math.min(840, Math.round(Number(timezoneOffsetMinutes) || 0)));
  if (!enabled) {
    await sql`UPDATE public.social_analytics_sources SET enabled = false, updated_at = now() WHERE workspace_id = ${principal.workspaceId} AND platform = ${platform}`;
    return syncOverview(principal.workspaceId);
  }
  const checked = checkProfileLink(platform, profileUrl);
  if (checked.error) throw Object.assign(new Error(checked.error), { status: 400 });
  const [source] = await sql`
    INSERT INTO public.social_analytics_sources (id, workspace_id, platform, profile_url, enabled, timezone_offset_minutes, created_by)
    VALUES (${`sync_${crypto.randomUUID()}`}, ${principal.workspaceId}, ${platform}, ${checked.url}, true, ${offset}, ${principal.userId || null})
    ON CONFLICT (workspace_id, platform) DO UPDATE SET
      profile_url = EXCLUDED.profile_url, enabled = true,
      timezone_offset_minutes = EXCLUDED.timezone_offset_minutes, updated_at = now()
    RETURNING *`;
  await queueNow(sql, principal, source);
  return syncOverview(principal.workspaceId);
}

/** "Update now": collects every saved source that isn't already being collected. */
export async function runSyncNow(principal) {
  await refreshSyncResults(principal.workspaceId);
  const sql = await getPlatformSql();
  const sources = await sql`
    SELECT * FROM public.social_analytics_sources
     WHERE workspace_id = ${principal.workspaceId} AND enabled AND last_status NOT IN ('queued', 'running')`;
  for (const source of sources) await queueNow(sql, principal, source);
  return syncOverview(principal.workspaceId);
}
