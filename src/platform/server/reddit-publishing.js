import { Zernio, ZernioApiError } from "@zernio/node";
import { getDatabaseSql } from "../../../lib/database-document-store.js";
import { requireRedditOptions } from "../../../services/publishing/queue-runner/shared/reddit-options.js";
import { openSupabaseJobArtifactStream } from "./supabase-job-control.js";

// Reddit publishing through Zernio (https://zernio.com), a hosted social
// publishing API. Zernio owns the Reddit app registration, OAuth, token refresh
// and Reddit's API access. AgenticThat stores only Zernio profile and account
// ids: no Reddit tokens are held here.
const IN_FLIGHT_LEASE = "30 minutes";
const IN_FLIGHT_GIVE_UP_MS = 2 * 60 * 60 * 1000;
const MEDIA_CONTENT_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/mpeg", "video/quicktime", "video/webm", "video/x-m4v",
]);

function redditError(message, status = 503, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export function redditConnectionConfiguration() {
  return { configured: Boolean(String(process.env.ZERNIO_API_KEY || "").trim()), provider: "zernio" };
}

let client = null;
function zernio() {
  if (!redditConnectionConfiguration().configured) {
    throw redditError("Reddit publishing is not configured. Add ZERNIO_API_KEY.");
  }
  client ||= new Zernio({ apiKey: process.env.ZERNIO_API_KEY.trim(), timeout: 120_000 });
  return client;
}

export function redditCallbackUrl(requestUrl) {
  const incoming = new URL(requestUrl);
  const local = ["localhost", "127.0.0.1"].includes(incoming.hostname);
  const base = local ? incoming.origin : String(process.env.PLATFORM_PUBLIC_URL || process.env.URL || "").trim();
  if (!base) throw redditError("Set PLATFORM_PUBLIC_URL before connecting Reddit.");
  const parsed = new URL(base);
  if (!local && parsed.protocol !== "https:") throw redditError("Reddit connections require an HTTPS public URL.");
  return new URL("/api/publishing/reddit/callback", parsed).toString();
}

// --- Zernio profile per workspace -------------------------------------------

async function workspaceProfileId(workspaceId) {
  const sql = await getDatabaseSql();
  const [existing] = await sql`SELECT profile_id FROM public.publishing_zernio_profiles WHERE workspace_id = ${String(workspaceId)}`;
  if (existing) return existing.profile_id;
  // The idempotency key makes concurrent first connections share one profile.
  const { data } = await zernio().profiles.createProfile({
    body: { name: `AgenticThat ${workspaceId}`.slice(0, 100), description: "Managed by AgenticThat publishing" },
    headers: { "Idempotency-Key": `agenticthat-profile-${workspaceId}` },
  });
  const profileId = data?.profile?._id;
  if (!profileId) throw redditError("Zernio did not create a publishing profile for this workspace.", 502);
  await sql`
    INSERT INTO public.publishing_zernio_profiles (workspace_id, profile_id)
    VALUES (${String(workspaceId)}, ${profileId})
    ON CONFLICT (workspace_id) DO NOTHING`;
  const [stored] = await sql`SELECT profile_id FROM public.publishing_zernio_profiles WHERE workspace_id = ${String(workspaceId)}`;
  return stored.profile_id;
}

async function connectionRow(workspaceId, accountId) {
  const sql = await getDatabaseSql();
  const [row] = await sql`
    SELECT * FROM public.publishing_reddit_connections
     WHERE workspace_id = ${String(workspaceId)} AND account_id = ${String(accountId)}`;
  return row || null;
}

// Returns Zernio's hosted Reddit authorization URL. Zernio sends the browser
// back to our callback with connected=reddit&accountId=…&username=… (or error=…).
export async function createRedditAuthorization({ workspaceId, accountId, state, requestUrl }) {
  const profileId = await workspaceProfileId(workspaceId);
  const existing = await connectionRow(workspaceId, accountId);
  const redirect = new URL(redditCallbackUrl(requestUrl));
  redirect.searchParams.set("state", state);
  const { data } = await zernio().connect.getConnectUrl({
    path: { platform: "reddit" },
    query: {
      profileId,
      redirect_url: redirect.toString(),
      ...(existing?.zernio_account_id ? { reconnectAccountId: existing.zernio_account_id } : {}),
    },
  });
  if (!data?.authUrl) throw redditError("Zernio did not return a Reddit authorization link.", 502);
  return { url: data.authUrl, profileId };
}

// Trust only an account Zernio lists under this workspace's own profile; the
// accountId in the redirect URL is user-controlled.
export async function completeRedditConnection(workspaceId, accountId, zernioAccountId) {
  const profileId = await workspaceProfileId(workspaceId);
  const { data } = await zernio().accounts.listAccounts({ query: { profileId, platform: "reddit" } });
  const account = (data?.accounts || []).find((item) => item._id === String(zernioAccountId || ""));
  if (!account) throw redditError("Zernio did not confirm this Reddit account for the workspace.", 403);
  const username = String(account.username || account.displayName || "").replace(/^u\//i, "");
  const sql = await getDatabaseSql();
  await sql`
    INSERT INTO public.publishing_reddit_connections
      (workspace_id, account_id, zernio_profile_id, zernio_account_id, reddit_username)
    VALUES (${String(workspaceId)}, ${String(accountId)}, ${profileId}, ${account._id}, ${username})
    ON CONFLICT (workspace_id, account_id) DO UPDATE SET
      zernio_profile_id = excluded.zernio_profile_id,
      zernio_account_id = excluded.zernio_account_id,
      reddit_username = excluded.reddit_username,
      connected_at = now(), updated_at = now()`;
  return { username };
}

export async function redditConnectionSummaries(workspaceId) {
  const sql = await getDatabaseSql();
  const rows = await sql`
    SELECT account_id, reddit_username, connected_at
      FROM public.publishing_reddit_connections
     WHERE workspace_id = ${String(workspaceId)}`;
  return rows.map((row) => ({ accountId: row.account_id, username: row.reddit_username, connectedAt: row.connected_at }));
}

export async function disconnectRedditConnection(workspaceId, accountId) {
  const row = await connectionRow(workspaceId, accountId);
  if (!row) return;
  const sql = await getDatabaseSql();
  await sql`DELETE FROM public.publishing_reddit_connections WHERE workspace_id = ${String(workspaceId)} AND account_id = ${String(accountId)}`;
  // Best effort: removing it at Zernio revokes the grant and stops billing.
  try { await zernio().accounts.deleteAccount({ path: { accountId: row.zernio_account_id } }); } catch { /* row is gone either way */ }
}

// --- Publishing ---------------------------------------------------------------

export function buildZernioRedditPost(upload, { zernioAccountId, mediaUrl = "" }) {
  const { reddit } = requireRedditOptions("reddit", upload?.platformOptions);
  const format = upload.postFormat || "text";
  if (format !== "text" && !mediaUrl) throw redditError("The Reddit media was not uploaded.", 502);
  const mimeType = String(upload.artifact?.mimeType || upload.mimeType || "").toLowerCase();
  return {
    content: String(upload.caption || "").trim(),
    ...(format === "text" ? {} : {
      mediaItems: [{ type: format === "video" ? "video" : "image", url: mediaUrl, mimeType, filename: upload.originalName || undefined }],
    }),
    platforms: [{
      platform: "reddit",
      accountId: zernioAccountId,
      platformSpecificData: {
        subreddit: reddit.subreddit,
        title: reddit.title,
        nsfw: reddit.nsfw,
        spoiler: reddit.spoiler,
        ...(format === "text" ? { forceSelf: true } : {}),
      },
    }],
    publishNow: true,
  };
}

async function uploadMediaToZernio(upload) {
  const mimeType = String(upload.artifact?.mimeType || upload.mimeType || "").toLowerCase();
  if (!MEDIA_CONTENT_TYPES.has(mimeType)) throw redditError("Reddit API posts support JPEG, PNG, GIF, WebP, MP4, MOV, or WebM media.", 400);
  const { stream, byteSize } = await openSupabaseJobArtifactStream(upload.artifact);
  const { data } = await zernio().media.getMediaPresignedUrl({
    body: { filename: upload.originalName || upload.artifact?.originalName || "media", contentType: mimeType, size: byteSize },
  });
  if (!data?.uploadUrl || !data?.publicUrl) throw redditError("Zernio did not provide a media upload link.", 502);
  const stored = await fetch(data.uploadUrl, {
    method: "PUT",
    body: stream,
    duplex: "half",
    headers: { "content-type": mimeType, "content-length": String(byteSize) },
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!stored.ok) throw redditError(`Zernio media storage rejected the file (${stored.status}).`, 502, { retryAfterMs: 2 * 60_000 });
  return data.publicUrl;
}

const RETRY_CATEGORIES = new Set(["platform_rate_limit", "platform_error", "quota_exhausted"]);

// Maps one Zernio platform target to a job outcome.
export function redditTargetOutcome(target) {
  const status = String(target?.status || "");
  if (status === "published") return { state: "success", url: target.platformPostUrl || "", id: target.platformPostId || "" };
  if (["pending", "processing", "uploading"].includes(status)) return { state: "in_flight" };
  const message = target?.errorMessage || (status === "cancelled" ? "The Reddit post was cancelled." : "Reddit did not publish the post.");
  if (target?.errorCategory === "auth_expired") return { state: "reconnect_required", message: `Reddit access expired or was revoked. Reconnect the Reddit account. (${message})` };
  if (RETRY_CATEGORIES.has(target?.errorCategory) || target?.errorCategory === "user_abuse" && /rate|too much|try again/i.test(message)) {
    return { state: "retry", message: `Reddit asked to wait before posting: ${message}`, retryAfterMs: 10 * 60_000 };
  }
  return { state: "failed", message: `Reddit rejected the post: ${message}` };
}

// SDK errors before Zernio accepted the post. The request carries the job id as
// its Idempotency-Key, so timeouts and 5xx responses are safe to retry.
export function redditRequestErrorOutcome(error) {
  if (error instanceof ZernioApiError) {
    const message = error.body?.error || error.message;
    if (error.statusCode === 401) return { state: "failed", message: "Zernio rejected the AgenticThat API key. Check ZERNIO_API_KEY." };
    if (error.code === "ACCOUNT_DISCONNECTED" || error.code === "ACCOUNT_NOT_ENABLED_FOR_POSTING") {
      return { state: "reconnect_required", message: "The Reddit account is disconnected at Zernio. Reconnect the Reddit account." };
    }
    if (error.statusCode === 429) return { state: "retry", message: "Zernio rate limited publishing. It will retry automatically.", retryAfterMs: 5 * 60_000 };
    if (error.statusCode >= 500) return { state: "retry", message: `Zernio is unavailable (${error.statusCode}). It will retry automatically.`, retryAfterMs: 2 * 60_000 };
    if (error.statusCode === 402) return { state: "failed", message: `Zernio billing blocked this post: ${message}` };
    return { state: "failed", message: `Zernio rejected the post: ${message}` };
  }
  if (error?.reconnect) return { state: "reconnect_required", message: error.message };
  if (error?.retryAfterMs) return { state: "retry", message: error.message, retryAfterMs: error.retryAfterMs };
  if (error?.status && error.status < 500) return { state: "failed", message: error.message };
  return { state: "retry", message: "Zernio could not be reached. Publishing will retry automatically.", retryAfterMs: 2 * 60_000 };
}

async function publishRedditJob(job, idempotencyAttempt) {
  const upload = job.payload?.upload;
  if (!upload || upload.platform !== "reddit") throw redditError("This Reddit job has no post to publish.", 400);
  const connection = await connectionRow(job.workspace_id, job.account_id);
  if (!connection) throw redditError("Connect this Reddit account first.", 409, { reconnect: true });
  const mediaUrl = upload.postFormat && upload.postFormat !== "text" ? await uploadMediaToZernio(upload) : "";
  const body = buildZernioRedditPost(upload, { zernioAccountId: connection.zernio_account_id, mediaUrl });
  const { data } = await zernio().posts.createPost({
    body: { ...body, metadata: { agenticthatJobId: job.id, agenticthatWorkspaceId: job.workspace_id } },
    headers: { "Idempotency-Key": `agenticthat-${job.id}-${idempotencyAttempt}` },
  });
  const post = data?.post;
  if (!post?._id) throw redditError("Zernio did not return the created post.", 502, { retryAfterMs: 2 * 60_000 });
  return { zernioPostId: post._id, outcome: redditTargetOutcome(post.platforms?.find((item) => item.platform === "reddit")) };
}

// --- Job control ----------------------------------------------------------------

async function recoverStaleRedditJobs(sql, workspaceId) {
  // A run that died mid-request left its job leased. createPost is idempotent
  // per job, so it is safe to queue again; in-flight posts are polled instead.
  await sql`
    UPDATE public.jobs SET
      status = CASE WHEN attempt_count < max_attempts THEN 'queued' ELSE 'failed' END,
      message = CASE WHEN attempt_count < max_attempts
        THEN 'Recovered after an interrupted Reddit API run.'
        ELSE 'The Reddit API publisher stopped repeatedly before completing this job.' END,
      completed_at = CASE WHEN attempt_count < max_attempts THEN NULL ELSE now() END,
      lease_expires_at = NULL, updated_at = now()
    WHERE job_type = 'publish' AND platform = 'reddit' AND status = 'publishing'
      AND lease_expires_at <= now() AND progress->>'zernioPostId' IS NULL
      AND (${workspaceId}::text IS NULL OR workspace_id = ${workspaceId}::text)`;
}

async function claimDueRedditJobs(sql, { workspaceId = null, limit = 5 } = {}) {
  const maximum = Math.max(1, Math.min(Number(limit) || 5, 20));
  return sql.begin(async (tx) => {
    const rows = await tx`
      WITH candidates AS (
        SELECT j.id
          FROM public.jobs j
          JOIN public.social_accounts account
            ON account.id = j.account_id AND account.workspace_id = j.workspace_id
         WHERE j.job_type = 'publish' AND j.platform = 'reddit'
           AND j.status IN ('queued', 'waiting_for_companion')
           AND j.not_before <= now()
           AND j.attempt_count < j.max_attempts
           AND account.enabled AND account.credential_configured
           AND account.metadata->>'executionEngine' = 'api'
           AND (${workspaceId}::text IS NULL OR j.workspace_id = ${workspaceId}::text)
         ORDER BY j.priority DESC, j.created_at
         FOR UPDATE OF j SKIP LOCKED
         LIMIT ${maximum}
      )
      UPDATE public.jobs j SET
        status = 'publishing', assigned_device_id = NULL,
        lease_expires_at = now() + interval '5 minutes',
        attempt_count = j.attempt_count + 1,
        message = 'Publishing through the Reddit API.',
        started_at = coalesce(j.started_at, now()), updated_at = now()
      FROM candidates WHERE j.id = candidates.id
      RETURNING j.*`;
    if (rows.length) {
      await tx`
        INSERT INTO public.job_events(job_id, workspace_id, event_type, status, message)
        SELECT id, workspace_id, 'job.claimed', 'publishing', 'Claimed by the Reddit API publisher.'
          FROM jsonb_to_recordset(${tx.json(rows.map((row) => ({ id: row.id, workspace_id: row.workspace_id })))}::jsonb)
            AS item(id text, workspace_id text)`;
    }
    return rows;
  });
}

async function finishRedditJob(sql, job, { status, message, outcome = null, result = {}, error = null, retryAt = null }) {
  const terminal = ["success", "failed", "uncertain"].includes(status);
  await sql.begin(async (tx) => {
    await tx`
      UPDATE public.jobs SET
        status = ${status}, message = ${message}, lease_expires_at = NULL,
        progress = coalesce(progress, '{}'::jsonb) || ${tx.json(result)},
        error = ${error ? tx.json(error) : null},
        not_before = coalesce(${retryAt}::timestamptz, not_before),
        completed_at = CASE WHEN ${terminal} THEN now() ELSE NULL END, updated_at = now()
      WHERE id = ${job.id} AND status = 'publishing'`;
    await tx`
      INSERT INTO public.job_events(job_id, workspace_id, event_type, status, message)
      VALUES (${job.id}, ${job.workspace_id}, ${terminal ? "job.completed" : "job.updated"}, ${status}, ${message})`;
    if (outcome) {
      await tx`
        INSERT INTO public.job_results(job_id, workspace_id, outcome, result, error)
        VALUES (${job.id}, ${job.workspace_id}, ${outcome}, ${tx.json(result)}, ${error ? tx.json(error) : null})
        ON CONFLICT (job_id) DO UPDATE SET outcome = excluded.outcome, result = excluded.result, error = excluded.error, updated_at = now()`;
    }
  });
}

async function applyRedditOutcome(sql, job, outcome, result = {}) {
  const subreddit = job.payload?.upload?.platformOptions?.reddit?.subreddit;
  if (outcome.state === "success") {
    await finishRedditJob(sql, job, {
      status: "success", outcome: "SUCCESS",
      message: `Posted to r/${subreddit}${outcome.url ? `: ${outcome.url}` : "."}`,
      result: { ...result, redditUrl: outcome.url, redditId: outcome.id },
    });
  } else if (outcome.state === "in_flight") {
    // Native video is transcoded by Reddit; keep the lease while Zernio finishes.
    await sql`
      UPDATE public.jobs SET
        lease_expires_at = now() + ${IN_FLIGHT_LEASE}::interval,
        final_action_started_at = coalesce(final_action_started_at, now()),
        progress = coalesce(progress, '{}'::jsonb) || ${sql.json(result)},
        message = 'Reddit is processing the post.', updated_at = now()
      WHERE id = ${job.id} AND status = 'publishing'`;
  } else if (outcome.state === "reconnect_required") {
    await finishRedditJob(sql, job, { status: "reconnect_required", message: outcome.message, result, error: { message: outcome.message, code: "reddit_reconnect" } });
    await sql`
      UPDATE public.social_accounts SET credential_configured = false, session_status = 'reconnect_required', updated_at = now()
       WHERE id = ${job.account_id} AND workspace_id = ${job.workspace_id}`;
  } else if (outcome.state === "retry" && job.attempt_count < job.max_attempts) {
    await finishRedditJob(sql, job, {
      status: "queued", message: outcome.message, result, error: { message: outcome.message, code: "reddit_retry" },
      retryAt: new Date(Date.now() + outcome.retryAfterMs).toISOString(),
    });
  } else {
    await finishRedditJob(sql, job, { status: "failed", outcome: "FAILED", message: outcome.message, result, error: { message: outcome.message, code: "reddit_failed" } });
  }
  return outcome.state;
}

// The Idempotency-Key stays the same after an unknown result (timeout, 5xx), so
// Zernio replays rather than duplicates. After Zernio reported a definite
// retryable failure, the next attempt needs a new key or it replays the failure.
async function runClaimedRedditJob(sql, job) {
  const attempt = Number(job.progress?.idempotencyAttempt || 0);
  let published;
  try {
    published = await publishRedditJob(job, attempt);
  } catch (error) {
    return applyRedditOutcome(sql, job, redditRequestErrorOutcome(error));
  }
  const { zernioPostId, outcome } = published;
  const result = outcome.state === "success" || outcome.state === "in_flight"
    ? { zernioPostId }
    : { lastZernioPostId: zernioPostId, ...(outcome.state === "retry" ? { idempotencyAttempt: attempt + 1 } : {}) };
  return applyRedditOutcome(sql, job, outcome, result);
}

async function pollInFlightRedditJobs(sql, workspaceId) {
  const jobs = await sql`
    SELECT * FROM public.jobs
     WHERE job_type = 'publish' AND platform = 'reddit' AND status = 'publishing'
       AND progress->>'zernioPostId' IS NOT NULL
       AND (${workspaceId}::text IS NULL OR workspace_id = ${workspaceId}::text)
     ORDER BY updated_at LIMIT 20`;
  const outcomes = [];
  for (const job of jobs) {
    let outcome;
    try {
      const { data } = await zernio().posts.getPost({ path: { postId: job.progress.zernioPostId } });
      outcome = redditTargetOutcome(data?.post?.platforms?.find((item) => item.platform === "reddit"));
    } catch {
      outcome = { state: "in_flight" };
    }
    const startedAt = Date.parse(job.final_action_started_at || job.started_at || job.updated_at);
    if (outcome.state === "in_flight" && Date.now() - startedAt > IN_FLIGHT_GIVE_UP_MS) {
      await finishRedditJob(sql, job, {
        status: "uncertain", outcome: "UNCERTAIN",
        message: "Reddit has not confirmed the post after two hours. Check the subreddit before retrying.",
        error: { message: "Reddit publish not confirmed", code: "reddit_uncertain" },
      });
      outcomes.push({ jobId: job.id, workspaceId: job.workspace_id, outcome: "uncertain" });
      continue;
    }
    // A failed in-flight post was accepted by Reddit's pipeline; never resubmit it blindly.
    const settled = outcome.state === "retry" ? { state: "failed", message: outcome.message } : outcome;
    outcomes.push({ jobId: job.id, workspaceId: job.workspace_id, outcome: await applyRedditOutcome(sql, job, settled) });
  }
  return outcomes;
}

// Publishes due Reddit API jobs. Called right after posts are queued and on a
// schedule, so exact-time and template posts go out on time.
export async function runDueRedditApiJobs({ workspaceId = null, limit = 5 } = {}) {
  if (!redditConnectionConfiguration().configured) return { processed: 0, outcomes: [] };
  const sql = await getDatabaseSql();
  await recoverStaleRedditJobs(sql, workspaceId);
  const outcomes = await pollInFlightRedditJobs(sql, workspaceId);
  const jobs = await claimDueRedditJobs(sql, { workspaceId, limit });
  for (const job of jobs) outcomes.push({ jobId: job.id, workspaceId: job.workspace_id, outcome: await runClaimedRedditJob(sql, job) });
  return { processed: outcomes.length, outcomes };
}
