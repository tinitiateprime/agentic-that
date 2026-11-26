import crypto from "node:crypto";
import { ANALYTICS_PLATFORMS, METRICS, readAnalyticsExport } from "../social-analytics/parse-export.js";
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

/** Likes, comments, shares and saves: what people did with the post. */
export function engagementOf(metrics = {}) {
  return ["likes", "comments", "shares", "saves"].reduce((sum, key) => sum + (Number(metrics[key]) || 0), 0);
}

/** Who saw it: reach, else impressions, else views. */
export function audienceOf(metrics = {}) {
  return Number(metrics.reach) || Number(metrics.impressions) || Number(metrics.views) || 0;
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

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
    let updated = 0;
    for (const post of parsed.posts) {
      const [row] = await tx`
        INSERT INTO social_analytics_posts
          (id, workspace_id, platform, post_key, account, permalink, post_text, post_type, published_at, metrics, import_id, updated_at)
        VALUES
          (${`post_${crypto.randomUUID()}`}, ${principal.workspaceId}, ${parsed.platform}, ${post.postKey.slice(0, 500)},
           ${post.account.slice(0, 200)}, ${post.permalink.slice(0, 1000)}, ${post.text}, ${post.type.slice(0, 100)},
           ${post.publishedAt}, ${tx.json(post.metrics)}, ${importId}, now())
        ON CONFLICT (workspace_id, platform, post_key) DO UPDATE SET
          account = COALESCE(NULLIF(EXCLUDED.account, ''), social_analytics_posts.account),
          permalink = COALESCE(NULLIF(EXCLUDED.permalink, ''), social_analytics_posts.permalink),
          post_text = COALESCE(NULLIF(EXCLUDED.post_text, ''), social_analytics_posts.post_text),
          post_type = COALESCE(NULLIF(EXCLUDED.post_type, ''), social_analytics_posts.post_type),
          published_at = COALESCE(EXCLUDED.published_at, social_analytics_posts.published_at),
          metrics = social_analytics_posts.metrics || EXCLUDED.metrics,
          import_id = EXCLUDED.import_id,
          updated_at = now()
        RETURNING (xmax <> 0) AS was_update`;
      if (row?.was_update) updated += 1;
    }
    return { importId, platform: parsed.platform, posts: parsed.posts.length, added: parsed.posts.length - updated, updated };
  });
}

/** Removes an upload and the posts whose numbers came from it last. */
export async function deleteAnalyticsImport(principal, importId) {
  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    const [found] = await tx`SELECT id FROM social_analytics_imports WHERE id = ${String(importId)} AND workspace_id = ${principal.workspaceId}`;
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

  const posts = rows.map((row) => {
    const metrics = row.metrics || {};
    const engagement = engagementOf(metrics);
    const audience = audienceOf(metrics);
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
      engagementRate: audience ? Math.round((engagement / audience) * 1000) / 10 : null,
    };
  });

  const totals = emptyTotals();
  const byPlatform = new Map();
  for (const post of posts) {
    addTo(totals, post);
    if (!byPlatform.has(post.platform)) byPlatform.set(post.platform, { platform: post.platform, label: post.platformLabel, ...emptyTotals() });
    addTo(byPlatform.get(post.platform), post);
  }

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
    .sort((left, right) => right.averageRate - left.averageRate)
    .slice(0, 3);

  return {
    rangeDays,
    platform: chosen,
    since: since ? since.toISOString() : null,
    until: until.toISOString(),
    totals: { ...totals, engagementRate: rate(totals) },
    platforms: [...byPlatform.values()].map((entry) => ({ ...entry, engagementRate: rate(entry) })).sort((a, b) => b.engagement - a.engagement),
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
