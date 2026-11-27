// Social Manager inbox → comments collected by the Companion (YouTube, and
// LinkedIn profiles and Pages). A company turns it on per connected account;
// the database queues a read-only check every 20 minutes for the Companion
// holding that account (migrations 202611270002 and 202611270003), and this
// module adds what it found to the inbox when the inbox is opened.
import crypto from "node:crypto";
import { getPlatformSql } from "./auth-store.js";
import { cleanCollectedItems, INBOX_VERSIONS, versionAtLeast } from "../social-inbox/collected.js";
import { addInboxItems } from "./social-inbox-store.js";

export const INBOX_PLATFORMS = Object.keys(INBOX_VERSIONS);
const LABELS = { youtube: "YouTube", linkedin: "LinkedIn" };
const ACTIVE = new Set(["queued", "waiting_for_companion", "claimed", "running", "cancel_requested"]);
const FAILED = new Set(["failed", "uncertain", "cancelled", "reconnect_required"]);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const sourceKey = (platform, accountId) => `${platform}:${accountId}`;

// Comments answered on YouTube drop out of Studio's "unanswered" list. When
// the Companion saw the whole list, anything of ours not in it is answered;
// otherwise only items newer than the oldest one it saw can be judged.
async function closeAnswered(sql, workspaceId, accountId, result, items) {
  const seenIds = items.map((item) => item.externalId);
  const dated = items.map((item) => Date.parse(item.receivedAt || "")).filter(Number.isFinite);
  const oldest = dated.length ? new Date(Math.min(...dated)).toISOString() : null;
  const wholeList = result?.complete === true && Number(result?.seen) < 10;
  if (!wholeList && !oldest) return 0;
  const closed = await sql`
    UPDATE public.social_inbox_items SET
      status = 'done', done_at = now(), done_by = NULL, snoozed_until = NULL,
      note = CASE WHEN note = '' THEN 'Answered on YouTube.' ELSE note END,
      updated_at = now()
    WHERE workspace_id = ${workspaceId}
      AND source = ${sourceKey("youtube", accountId)}
      AND status = 'open'
      AND NOT (external_id = ANY(${seenIds}::text[]))
      AND (${wholeList} OR received_at >= ${oldest}::timestamptz)
    RETURNING id`;
  return closed.length;
}

/** Brings each source's status up to date and adds finished checks to the inbox (once per job). */
export async function refreshInboxCollections(workspaceId) {
  const sql = await getPlatformSql();
  const sources = await sql`
    SELECT s.*, j.status AS job_status, j.message AS job_message, j.error AS job_error,
           r.result AS job_result, r.error AS result_error
      FROM public.social_inbox_sources s
      LEFT JOIN public.jobs j ON j.id = s.last_job_id AND j.workspace_id = s.workspace_id
      LEFT JOIN public.job_results r ON r.job_id = j.id
     WHERE s.workspace_id = ${workspaceId}
       AND s.last_job_id IS NOT NULL
       AND s.last_imported_job_id IS DISTINCT FROM s.last_job_id`;
  for (const source of sources) {
    const status = source.job_status;
    let next;
    if (!status) {
      next = { last_status: "failed", last_message: "The check went missing. It will run again shortly.", imported: true };
    } else if (ACTIVE.has(status)) {
      const running = status === "claimed" || status === "running";
      next = { last_status: running ? "running" : "queued", last_message: running ? "The Companion is reading new comments." : "Waiting for the Companion.", imported: false };
    } else if (status === "success") {
      const items = cleanCollectedItems(source.job_result, source.platform);
      const { added } = await addInboxItems(workspaceId, items, sourceKey(source.platform, source.account_id));
      // Only YouTube says which comments are still unanswered.
      const answered = source.platform === "youtube" ? await closeAnswered(sql, workspaceId, source.account_id, source.job_result, items) : 0;
      const parts = [added ? `${added} new ${added === 1 ? "item" : "items"}` : "Nothing new", answered ? `${answered} answered on YouTube` : ""].filter(Boolean);
      next = { last_status: "collected", last_message: `${parts.join(", ")}.`, imported: true, collected: true };
    } else if (FAILED.has(status)) {
      const error = source.job_error || source.result_error || {};
      const busy = error.code === "account_busy";
      next = {
        last_status: busy ? "queued" : "failed",
        last_message: busy ? "The account was busy publishing; it will check again shortly." : String(error.message || source.job_message || "The check didn't finish. It will try again.").slice(0, 400),
        imported: true,
      };
    } else {
      continue;
    }
    if (!next.imported && next.last_status === source.last_status && next.last_message === source.last_message) continue;
    await sql`
      UPDATE public.social_inbox_sources SET
        last_status = ${next.last_status},
        last_message = ${next.last_message},
        last_imported_job_id = CASE WHEN ${next.imported} THEN last_job_id ELSE last_imported_job_id END,
        last_collected_at = CASE WHEN ${Boolean(next.collected)} THEN now() ELSE last_collected_at END,
        updated_at = now()
      WHERE id = ${source.id} AND last_job_id = ${source.last_job_id}`;
  }
}

/** The company's YouTube and LinkedIn accounts, which ones are on, and whether their Companion can do it. */
export async function inboxSources(workspaceId) {
  const sql = await getPlatformSql();
  const accounts = await sql`
    SELECT a.id, a.platform, a.handle, a.display_name, a.enabled, a.credential_configured, a.metadata,
           d.version AS device_version, d.last_seen_at AS device_seen_at,
           s.enabled AS on, s.last_status, s.last_message, s.last_collected_at
      FROM public.social_accounts a
      LEFT JOIN public.companion_devices d ON d.id = a.companion_device_id AND d.revoked_at IS NULL
      LEFT JOIN public.social_inbox_sources s ON s.account_id = a.id AND s.workspace_id = a.workspace_id
     WHERE a.workspace_id = ${workspaceId} AND a.platform IN ('youtube', 'linkedin') AND a.enabled
     ORDER BY a.platform DESC, lower(coalesce(nullif(a.display_name, ''), a.handle))`;
  return accounts.map((account) => ({
    accountId: account.id,
    platform: account.platform,
    label: LABELS[account.platform],
    name: account.display_name || account.handle,
    // LinkedIn: the Pages this member manages are read too.
    pages: account.platform === "linkedin" && Array.isArray(account.metadata?.linkedinManagedPages)
      ? account.metadata.linkedinManagedPages.map((page) => String(page?.name || "")).filter(Boolean)
      : [],
    requiredVersion: INBOX_VERSIONS[account.platform],
    handle: account.handle,
    connected: Boolean(account.credential_configured),
    enabled: Boolean(account.on),
    status: account.on ? account.last_status : "off",
    message: account.last_message || "",
    lastCollectedAt: account.last_collected_at ? new Date(account.last_collected_at).toISOString() : null,
    companionVersion: account.device_version || null,
    companionReady: versionAtLeast(account.device_version, INBOX_VERSIONS[account.platform]),
    companionOnline: Boolean(account.device_seen_at && Date.now() - Date.parse(account.device_seen_at) < 5 * 60 * 1000),
  }));
}

/** Turns comment checks on or off for one YouTube or LinkedIn account, or asks for a check now. */
export async function updateInboxSource(principal, { accountId, enabled = true, checkNow = false }) {
  const sql = await getPlatformSql();
  const [account] = await sql`
    SELECT id, platform FROM public.social_accounts
     WHERE id = ${String(accountId || "")} AND workspace_id = ${principal.workspaceId} AND platform IN ('youtube', 'linkedin')`;
  if (!account) throw fail("Choose one of this company's YouTube or LinkedIn accounts.");
  if (checkNow) {
    // The Companion queues the check the next time it asks for work (seconds).
    await sql`UPDATE public.social_inbox_sources SET last_queued_at = NULL, updated_at = now() WHERE workspace_id = ${principal.workspaceId} AND account_id = ${account.id} AND enabled`;
    return;
  }
  await sql`
    INSERT INTO public.social_inbox_sources (id, workspace_id, platform, account_id, enabled, created_by)
    VALUES (${`inboxsrc_${crypto.randomUUID()}`}, ${principal.workspaceId}, ${account.platform}, ${account.id}, ${Boolean(enabled)}, ${principal.userId || null})
    ON CONFLICT (workspace_id, account_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      last_queued_at = CASE WHEN EXCLUDED.enabled THEN NULL ELSE social_inbox_sources.last_queued_at END,
      last_status = CASE WHEN EXCLUDED.enabled AND social_inbox_sources.last_status = 'failed' THEN 'never' ELSE social_inbox_sources.last_status END,
      updated_at = now()`;
}
