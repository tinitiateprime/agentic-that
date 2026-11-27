// Turns the comments the Companion's Instagram and Facebook scrapers saw on
// the company's own posts into inbox items. The company's own replies are
// left out: they are answers, not things to answer.
import crypto from "node:crypto";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fingerprint = (...parts) => crypto.createHash("sha1").update(parts.map(clean).join("\u0001")).digest("hex").slice(0, 32);
const isoOrNull = (value) => (value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null);

/** https://www.instagram.com/tinitiate.ai/ → "tinitiate.ai" */
export function instagramHandle(profileUrl) {
  return /instagram\.com\/([A-Za-z0-9._]+)/i.exec(String(profileUrl || ""))?.[1]?.toLowerCase() || "";
}

function instagramItems(post, ownHandle) {
  const postUrl = clean(post.post_url);
  if (!postUrl) return [];
  return (Array.isArray(post.top_comments) ? post.top_comments : []).flatMap((comment) => {
    const author = clean(comment?.username);
    const body = clean(comment?.text);
    if (!author || !body) return [];
    const owner = (ownHandle || clean(post.username)).toLowerCase();
    if (owner && author.toLowerCase() === owner) return [];
    return [{
      platform: "instagram",
      kind: "comment",
      externalId: `ig:${fingerprint(postUrl, author, body)}`,
      authorName: author,
      authorUrl: `https://www.instagram.com/${author}/`,
      body: body.slice(0, 4000),
      contextText: clean(post.caption).slice(0, 500),
      permalink: postUrl,
      receivedAt: isoOrNull(comment.timestamp),
    }];
  });
}

function facebookItems(post) {
  const postUrl = clean(post.post_url);
  if (!postUrl) return [];
  const page = clean(post.author_name).toLowerCase();
  return (Array.isArray(post.top_comments) ? post.top_comments : []).flatMap((comment) => {
    const author = clean(comment?.author_name);
    const body = clean(comment?.text);
    if (!author || !body || (page && author.toLowerCase() === page)) return [];
    return [{
      platform: "facebook",
      kind: "comment",
      externalId: `fb:${fingerprint(postUrl, author, body)}`,
      authorName: author,
      authorUrl: "",
      body: body.slice(0, 4000),
      contextText: clean(post.content).slice(0, 500),
      permalink: postUrl,
      receivedAt: isoOrNull(comment.timestamp),
    }];
  });
}

/** Inbox items from a finished scrape job's stored result. */
export function commentsFromScrape(platform, stored, { profileUrl = "" } = {}) {
  const results = Array.isArray(stored?.run?.results) ? stored.run.results : Array.isArray(stored?.results) ? stored.results : [];
  const ownHandle = platform === "instagram" ? instagramHandle(profileUrl) : "";
  const seen = new Set();
  const items = [];
  for (const post of results) {
    if (!post || typeof post !== "object") continue;
    const found = platform === "instagram" ? instagramItems(post, ownHandle) : platform === "facebook" ? facebookItems(post) : [];
    for (const item of found) {
      if (seen.has(item.externalId)) continue;
      seen.add(item.externalId);
      items.push(item);
    }
  }
  return items;
}

/** Which list an item belongs in right now. */
export function inboxView(item, userId, now = Date.now()) {
  if (item.status === "done") return "done";
  if (item.snoozedUntil && Date.parse(item.snoozedUntil) > now) return "snoozed";
  return item.assignedTo && item.assignedTo === userId ? "mine" : "open";
}

/** "1h", "tomorrow", "week" → when a snooze ends (tomorrow and next week at 9 am local). */
export function snoozeUntil(choice, now = new Date(), timezoneOffsetMinutes = 0) {
  if (choice === "1h") return new Date(now.getTime() + 60 * 60 * 1000);
  if (choice === "3h") return new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const days = choice === "tomorrow" ? 1 : choice === "week" ? 7 : 0;
  if (!days) return null;
  // Local midnight today, then 9 am `days` later, back in UTC.
  const local = new Date(now.getTime() - timezoneOffsetMinutes * 60000);
  const nineLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, 9);
  return new Date(nineLocal + timezoneOffsetMinutes * 60000);
}
