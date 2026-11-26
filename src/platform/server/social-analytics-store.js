import crypto from "node:crypto";
import { ANALYTICS_PLATFORMS, METRICS, readAnalyticsExport } from "../social-analytics/parse-export.js";
import { matchKeys } from "../social-analytics/from-scrape.js";
import { buildInsights } from "../social-analytics/insights.js";
import { getPlatformSql } from "./auth-store.js";

const RANGES = new Set([7, 30, 90, 365]);
const DAY_MS = 24 * 60 * 60 * 1000;
const LABELS = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", linkedin: "LinkedIn", x: "X" };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYPARTS = [
  { id: "morning", label: "Morning", from: 5, to: 12 },
  { id: "afternoon", label: "Afternoon", from: 12, to: 17 },
  { id: "evening", label: "Evening", from: 17, to: 22 },
  { id: "night", label: "Night", from: 22, to: 29 },
];
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const ENGAGEMENT_METRICS = ["likes", "comments", "shares", "saves"];

/** Likes, comments, shares and saves: what people did with the post. */
export function engagementOf(metrics = {}) {
  return ENGAGEMENT_METRICS.reduce((sum, key) => sum + (Number(metrics[key]) || 0), 0);
}

/** Whether the export had any engagement number for this post (a blank is not a zero). */
export function hasEngagement(metrics = {}) {
  return ENGAGEMENT_METRICS.some((key) => metrics[key] !== undefined && metrics[key] !== null);
}

/**
 * Which numbers the posts' exports actually contained. A metric no export
 * gave is "Unavailable" on the page, not 0.
 */
export function availableMetrics(posts) {
  const available = Object.fromEntries(METRICS.map((metric) => [metric, false]));
  for (const post of posts) {
    for (const metric of METRICS) if (post.metrics[metric] !== undefined && post.metrics[metric] !== null) available[metric] = true;
  }
  available.engagement = ENGAGEMENT_METRICS.some((metric) => available[metric]);
  available.audience = available.reach || available.impressions || available.views;
  return available;
}

/** Who saw it: reach, else impressions, else views. */
export function audienceOf(metrics = {}) {
  return Number(metrics.reach) || Number(metrics.impressions) || Number(metrics.views) || 0;
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

// Saves posts for one platform. A post already stored under another key (the
// same post from an export and from an automatic update) is updated in place.
async function savePosts(tx, workspaceId, platform, posts, importId) {
  const existing = await tx`
    SELECT id, post_key, permalink FROM social_analytics_posts
     WHERE workspace_id = ${workspaceId} AND platform = ${platform}`;
  const byKey = new Map();
  const remember = (keys, id) => { for (const key of keys) if (!byKey.has(key)) byKey.set(key, id); };
  for (const row of existing) remember(matchKeys(platform, row.post_key, row.permalink), row.id);

  let updated = 0;
  for (const post of posts) {
    const keys = matchKeys(platform, post.postKey, post.permalink);
    const matchId = keys.map((key) => byKey.get(key)).find(Boolean);
    const values = {
      account: post.account.slice(0, 200), permalink: post.permalink.slice(0, 1000), text: post.text,
      type: post.type.slice(0, 100), publishedAt: post.publishedAt, metrics: tx.json(post.metrics),
    };
    if (matchId) {
      await tx`
        UPDATE social_analytics_posts SET
          account = COALESCE(NULLIF(${values.account}, ''), account),
          permalink = COALESCE(NULLIF(${values.permalink}, ''), permalink),
          post_text = COALESCE(NULLIF(${values.text}, ''), post_text),
          post_type = COALESCE(NULLIF(${values.type}, ''), post_type),
          published_at = COALESCE(${values.publishedAt}::timestamptz, published_at),
          metrics = metrics || ${values.metrics},
          import_id = ${importId},
          updated_at = now()
        WHERE id = ${matchId}`;
      updated += 1;
      continue;
    }
    const [row] = await tx`
      INSERT INTO social_analytics_posts
        (id, workspace_id, platform, post_key, account, permalink, post_text, post_type, published_at, metrics, import_id, updated_at)
      VALUES
        (${`post_${crypto.randomUUID()}`}, ${workspaceId}, ${platform}, ${post.postKey.slice(0, 500)},
         ${values.account}, ${values.permalink}, ${values.text}, ${values.type},
         ${values.publishedAt}, ${values.metrics}, ${importId}, now())
      ON CONFLICT (workspace_id, platform, post_key) DO UPDATE SET
        account = COALESCE(NULLIF(EXCLUDED.account, ''), social_analytics_posts.account),
        permalink = COALESCE(NULLIF(EXCLUDED.permalink, ''), social_analytics_posts.permalink),
        post_text = COALESCE(NULLIF(EXCLUDED.post_text, ''), social_analytics_posts.post_text),
        post_type = COALESCE(NULLIF(EXCLUDED.post_type, ''), social_analytics_posts.post_type),
        published_at = COALESCE(EXCLUDED.published_at, social_analytics_posts.published_at),
        metrics = social_analytics_posts.metrics || EXCLUDED.metrics,
        import_id = EXCLUDED.import_id,
        updated_at = now()
      RETURNING id, (xmax <> 0) AS was_update`;
    if (row?.was_update) updated += 1;
    remember(keys, row.id);
  }
  return { added: posts.length - updated, updated };
}

/** Saves one uploaded export. Newer numbers replace older ones for the same post. */
export async function importAnalyticsFile(principal, { fileName, bytes, platform }) {
  if (!bytes?.length) throw new Error("The file is empty.");
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error("The file is larger than 5 MB. Export a shorter date range.");
  const parsed = await readAnalyticsExport({ fileName, bytes, platform });
  const sql = await getPlatformSql();
  const importId = `import_${crypto.randomUUID()}`;
  return sql.begin(async (tx) => {
    await tx`
      INSERT INTO social_analytics_imports (id, workspace_id, platform, file_name, post_count, imported_by)
      VALUES (${importId}, ${principal.workspaceId}, ${parsed.platform}, ${String(fileName).slice(0, 200)}, ${parsed.posts.length}, ${principal.userId})`;
    const { added, updated } = await savePosts(tx, principal.workspaceId, parsed.platform, parsed.posts, importId);
    return { importId, platform: parsed.platform, posts: parsed.posts.length, added, updated };
  });
}

/**
 * Saves the posts an automatic update collected, once per job (the import id
 * is derived from the job, so a second call for the same job does nothing).
 */
export async function importScrapedPosts(workspaceId, { jobId, platform, posts, label }) {
  const sql = await getPlatformSql();
  const importId = `import_sync_${jobId}`;
  return sql.begin(async (tx) => {
    const [created] = await tx`
      INSERT INTO social_analytics_imports (id, workspace_id, platform, file_name, post_count, imported_by)
      VALUES (${importId}, ${workspaceId}, ${platform}, ${String(label).slice(0, 200)}, ${posts.length}, NULL)
      ON CONFLICT (id) DO NOTHING
      RETURNING id`;
    if (!created) return { skipped: true, added: 0, updated: 0 };
    return { skipped: false, ...(await savePosts(tx, workspaceId, platform, posts, importId)) };
  });
}

/** Removes an upload and the posts whose numbers came from it last. */
export async function deleteAnalyticsImport(principal, importId) {
  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    // Automatic updates are not uploads and are not listed, so they can't be removed here.
    const [found] = await tx`SELECT id FROM social_analytics_imports WHERE id = ${String(importId)} AND workspace_id = ${principal.workspaceId} AND left(id, 12) <> 'import_sync_'`;
    if (!found) throw new Error("That upload was not found.");
    const removed = await tx`DELETE FROM social_analytics_posts WHERE import_id = ${found.id} AND workspace_id = ${principal.workspaceId} RETURNING id`;
    await tx`DELETE FROM social_analytics_imports WHERE id = ${found.id}`;
    return { removedPosts: removed.length };
  });
}

function emptyTotals() {
  return { posts: 0, ...Object.fromEntries(METRICS.map((metric) => [metric, 0])), engagement: 0, audience: 0 };
}

function addTo(totals, post) {
  totals.posts += 1;
  for (const metric of METRICS) totals[metric] += Number(post.metrics[metric]) || 0;
  totals.engagement += post.engagement;
  totals.audience += post.audience;
}

const rate = (totals) => (totals.audience ? Math.round((totals.engagement / totals.audience) * 1000) / 10 : null);

/** The Analytics dashboard: totals, a daily series, platforms, best times and the posts. */
export async function socialAnalyticsReport(principal, { days, platform } = {}) {
  const rangeDays = days === "all" ? "all" : RANGES.has(Number(days)) ? Number(days) : 30;
  const chosen = ANALYTICS_PLATFORMS.includes(platform) ? platform : "all";
  const until = new Date();
  const since = rangeDays === "all" ? null : new Date(until.getTime() - rangeDays * DAY_MS);
  const sql = await getPlatformSql();
  const rows = await sql`
    SELECT id, platform, account, permalink, post_text, post_type, published_at, metrics, updated_at
      FROM social_analytics_posts
     WHERE workspace_id = ${principal.workspaceId}
       AND (${chosen} = 'all' OR platform = ${chosen})
       AND (${since ? since.toISOString() : null}::timestamptz IS NULL OR published_at >= ${since ? since.toISOString() : null}::timestamptz)
     ORDER BY published_at DESC NULLS LAST
     LIMIT 5000`;
  const imports = await sql`
    SELECT i.id, i.platform, i.file_name, i.post_count, i.created_at, u.name AS imported_by
      FROM social_analytics_imports i
      LEFT JOIN platform_users u ON u.id = i.imported_by
     WHERE i.workspace_id = ${principal.workspaceId}
       AND left(i.id, 12) <> 'import_sync_'
     ORDER BY i.created_at DESC
     LIMIT 30`;
  const [counts] = await sql`
    SELECT count(*)::int AS total, min(published_at) AS first_post, max(updated_at) AS last_update
      FROM social_analytics_posts WHERE workspace_id = ${principal.workspaceId}`;
  // Posts of the chosen platform left out only because they were published
  // before the range (or have no date), so the page can offer "Show all time".
  const [outside] = since ? await sql`
    SELECT count(*)::int AS hidden
      FROM social_analytics_posts
     WHERE workspace_id = ${principal.workspaceId}
       AND (${chosen} = 'all' OR platform = ${chosen})
       AND (published_at IS NULL OR published_at < ${since.toISOString()}::timestamptz)` : [{ hidden: 0 }];

  // The same length of time just before the range, for "vs the period before".
  const previousRows = since ? await sql`
    SELECT metrics
      FROM social_analytics_posts
     WHERE workspace_id = ${principal.workspaceId}
       AND (${chosen} = 'all' OR platform = ${chosen})
       AND published_at >= ${new Date(since.getTime() - rangeDays * DAY_MS).toISOString()}::timestamptz
       AND published_at < ${since.toISOString()}::timestamptz` : [];
  const previousTotals = emptyTotals();
  for (const row of previousRows) {
    const metrics = row.metrics || {};
    addTo(previousTotals, { metrics, engagement: engagementOf(metrics), audience: audienceOf(metrics) });
  }
  const previous = since ? { ...previousTotals, engagementRate: rate(previousTotals) } : null;

  const posts = rows.map((row) => {
    const metrics = row.metrics || {};
    const engagement = engagementOf(metrics);
    const audience = audienceOf(metrics);
    const rated = audience && hasEngagement(metrics);
    return {
      id: String(row.id),
      platform: row.platform,
      platformLabel: LABELS[row.platform] || row.platform,
      account: row.account,
      permalink: row.permalink,
      text: row.post_text,
      type: row.post_type,
      publishedAt: iso(row.published_at),
      metrics,
      engagement,
      audience,
      engagementRate: rated ? Math.round((engagement / audience) * 1000) / 10 : null,
    };
  });

  const totals = emptyTotals();
  const byPlatform = new Map();
  for (const post of posts) {
    addTo(totals, post);
    if (!byPlatform.has(post.platform)) byPlatform.set(post.platform, { platform: post.platform, label: post.platformLabel, ...emptyTotals(), list: [] });
    const entry = byPlatform.get(post.platform);
    addTo(entry, post);
    entry.list.push(post);
  }
  const available = availableMetrics(posts);

  // Engagement per day, oldest first (only days inside the range).
  const daily = [];
  const dated = posts.filter((post) => post.publishedAt);
  if (dated.length) {
    const first = since || new Date(dated[dated.length - 1].publishedAt);
    const start = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
    const index = new Map();
    for (let time = start; time <= until.getTime(); time += DAY_MS) {
      const date = new Date(time).toISOString().slice(0, 10);
      index.set(date, daily.length);
      daily.push({ date, engagement: 0, posts: 0 });
    }
    for (const post of dated) {
      const position = index.get(post.publishedAt.slice(0, 10));
      if (position === undefined) continue;
      daily[position].engagement += post.engagement;
      daily[position].posts += 1;
    }
  }

  // When posts do best: average engagement rate by weekday and by part of day.
  // Times are as each platform exported them (the account's own time).
  const slot = () => ({ posts: 0, rateSum: 0, rated: 0 });
  const weekdays = WEEKDAYS.map((label) => ({ label, ...slot() }));
  const dayparts = DAYPARTS.map((part) => ({ id: part.id, label: part.label, ...slot() }));
  const grid = new Map();
  for (const post of dated) {
    const date = new Date(post.publishedAt);
    const hour = date.getUTCHours();
    const weekday = weekdays[date.getUTCDay()];
    const part = dayparts[DAYPARTS.findIndex((entry) => (hour >= entry.from && hour < entry.to) || (hour + 24 >= entry.from && hour + 24 < entry.to))];
    for (const bucket of [weekday, part]) {
      bucket.posts += 1;
      if (post.engagementRate !== null) { bucket.rateSum += post.engagementRate; bucket.rated += 1; }
    }
    const key = `${weekday.label}|${part.label}`;
    const cell = grid.get(key) || { weekday: weekday.label, daypart: part.label, ...slot() };
    cell.posts += 1;
    if (post.engagementRate !== null) { cell.rateSum += post.engagementRate; cell.rated += 1; }
    grid.set(key, cell);
  }
  const average = (bucket) => (bucket.rated ? Math.round((bucket.rateSum / bucket.rated) * 10) / 10 : null);
  const finish = (bucket) => ({ label: bucket.label, posts: bucket.posts, averageRate: average(bucket) });
  // A best time needs at least two posts in that slot to mean anything.
  const bestSlots = [...grid.values()]
    .filter((cell) => cell.rated >= 2)
    .map((cell) => ({ weekday: cell.weekday, daypart: cell.daypart, posts: cell.posts, averageRate: average(cell) }))
    .filter((cell) => cell.averageRate > 0) // a slot nobody engaged with is not a "best" time
    .sort((left, right) => right.averageRate - left.averageRate)
    .slice(0, 3);

  const totalsWithRate = { ...totals, engagementRate: available.engagement ? rate(totals) : null };
  return {
    rangeDays,
    platform: chosen,
    since: since ? since.toISOString() : null,
    until: until.toISOString(),
    totals: totalsWithRate,
    previous,
    available,
    insights: buildInsights({ posts, totals: totalsWithRate, previous, bestSlots, available }),
    platforms: [...byPlatform.values()].map(({ list, ...entry }) => {
      const has = availableMetrics(list);
      return { ...entry, available: has, engagementRate: has.engagement ? rate(entry) : null };
    }).sort((a, b) => b.engagement - a.engagement),
    daily,
    bestTimes: { weekdays: weekdays.map(finish), dayparts: dayparts.map(finish), bestSlots },
    topPosts: [...posts].sort((a, b) => b.engagement - a.engagement).slice(0, 10),
    posts: posts.slice(0, 1000),
    imports: imports.map((entry) => ({
      id: String(entry.id), platform: entry.platform, platformLabel: LABELS[entry.platform] || entry.platform,
      fileName: entry.file_name, posts: entry.post_count, importedBy: entry.imported_by || "", at: iso(entry.created_at),
    })),
    library: { totalPosts: counts?.total || 0, firstPost: iso(counts?.first_post), lastUpdate: iso(counts?.last_update) },
    hiddenByRange: outside?.hidden || 0,
  };
}
