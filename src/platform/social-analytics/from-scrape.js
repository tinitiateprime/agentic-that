// Turns what the Companion's Instagram and Facebook scrapers collect from a
// company's own profile into Social Manager posts, and works out when a
// scraped post and an exported post are the same post, so the numbers land
// on one row instead of two.
//
// Scrapers see what anyone can see on the page: likes, comments and views.
// Reach, impressions and saves stay with the platform exports.

const clean = (value) => String(value ?? "").trim();
const count = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

/** https://www.instagram.com/p/abc/?igsh=x → instagram.com/p/abc */
export function normalizeLink(value) {
  const text = clean(value);
  if (!/^https?:\/\//i.test(text)) return "";
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
    const keep = ["story_fbid", "fbid", "id", "v"].filter((name) => url.searchParams.has(name)).map((name) => `${name}=${url.searchParams.get(name)}`);
    return `${host}${url.pathname.replace(/\/+$/, "")}${keep.length ? `?${keep.join("&")}` : ""}`;
  } catch {
    return "";
  }
}

const instagramCode = (value) => /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(clean(value))?.[1] || "";

function facebookIds(value) {
  const text = clean(value);
  const ids = new Set();
  // Export "Post ID" values are "pageId_postId" or just the post id.
  const pair = /^(\d+)_(\d+)$/.exec(text);
  if (pair) ids.add(pair[2]);
  else if (/^\d{6,}$/.test(text)) ids.add(text);
  for (const pattern of [/\/(?:posts|videos|reel|permalink|photos\/[^/]+)\/(pfbid[A-Za-z0-9]+|\d{6,})/gi, /[?&](?:story_fbid|fbid|v)=(pfbid[A-Za-z0-9]+|\d{6,})/gi]) {
    for (const match of text.matchAll(pattern)) ids.add(match[1]);
  }
  return [...ids];
}

/** Every way the same post can be recognised, for one platform. */
export function matchKeys(platform, postKey, permalink) {
  const keys = new Set();
  if (clean(postKey)) keys.add(`key:${clean(postKey)}`);
  const link = normalizeLink(permalink) || normalizeLink(postKey);
  if (link) keys.add(`link:${link}`);
  if (platform === "instagram") {
    const code = instagramCode(permalink) || instagramCode(postKey);
    if (code) keys.add(`ig:${code}`);
  }
  if (platform === "facebook") {
    for (const id of [...facebookIds(postKey), ...facebookIds(permalink)]) keys.add(`fb:${id}`);
  }
  return [...keys];
}

const title = (value) => (clean(value) ? clean(value)[0].toUpperCase() + clean(value).slice(1) : "");

function instagramPost(item) {
  const code = instagramCode(item.post_url);
  if (!code) return null;
  const metrics = {};
  if (!item.likes_hidden && count(item.likes) !== null) metrics.likes = item.likes;
  if (!item.comments_hidden && count(item.comments_count) !== null) metrics.comments = item.comments_count;
  if (count(item.views) !== null) metrics.views = item.views;
  return {
    postKey: `https://www.instagram.com/p/${code}/`,
    account: clean(item.username),
    permalink: clean(item.post_url),
    text: clean(item.caption).slice(0, 2000),
    type: /\/(reel|reels)\//i.test(item.post_url) ? "Reel" : "Post",
    publishedAt: item.timestamp && Number.isFinite(Date.parse(item.timestamp)) ? new Date(item.timestamp).toISOString() : null,
    metrics,
  };
}

function facebookPost(item) {
  const permalink = clean(item.post_url);
  const postKey = clean(item.post_id) || permalink;
  if (!postKey) return null;
  const metrics = {};
  if (count(item.reactions_count) !== null) metrics.likes = item.reactions_count;
  if (count(item.comments_count) !== null) metrics.comments = item.comments_count;
  if (count(item.views_count) !== null) metrics.views = item.views_count;
  return {
    postKey,
    account: clean(item.author_name),
    permalink: /^https?:\/\//i.test(permalink) ? permalink : "",
    text: clean(item.content).slice(0, 2000),
    type: title(item.media_type),
    publishedAt: item.timestamp && Number.isFinite(Date.parse(item.timestamp)) ? new Date(item.timestamp).toISOString() : null,
    metrics,
  };
}

/**
 * Posts from a finished scrape job's stored result (what the Companion
 * reported: { run: { results } } or { results }).
 */
export function postsFromScrape(platform, stored) {
  const results = Array.isArray(stored?.run?.results) ? stored.run.results : Array.isArray(stored?.results) ? stored.results : [];
  const convert = platform === "instagram" ? instagramPost : platform === "facebook" ? facebookPost : null;
  if (!convert) return [];
  const seen = new Set();
  const posts = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const post = convert(item);
    if (!post || seen.has(post.postKey)) continue;
    seen.add(post.postKey);
    posts.push(post);
  }
  return posts;
}

/** A link to the company's own profile, or a reason it isn't one. */
export function checkProfileLink(platform, value) {
  let text = clean(value);
  if (platform === "instagram" && /^@?[A-Za-z0-9._]{1,30}$/.test(text)) text = `https://www.instagram.com/${text.replace(/^@/, "")}/`;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try { url = new URL(text); } catch { return { error: "Paste the full link to your profile." }; }
  const host = url.hostname.toLowerCase().replace(/^(www|m|web)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (platform === "instagram") {
    if (host !== "instagram.com" || parts.length !== 1 || ["p", "reel", "reels", "tv", "stories", "explore", "accounts"].includes(parts[0].toLowerCase())) {
      return { error: "Paste your Instagram profile link, like https://www.instagram.com/yourcompany/." };
    }
    return { url: `https://www.instagram.com/${parts[0]}/` };
  }
  if (platform === "facebook") {
    if (!["facebook.com", "fb.com"].includes(host) || !parts.length || ["groups", "watch", "events", "marketplace", "share", "photo", "photo.php", "story.php"].includes(parts[0].toLowerCase())) {
      return { error: "Paste your Facebook Page link, like https://www.facebook.com/yourcompany." };
    }
    if (parts[0] === "profile.php") {
      const id = url.searchParams.get("id");
      return id && /^\d+$/.test(id) ? { url: `https://www.facebook.com/profile.php?id=${id}` } : { error: "Paste your Facebook Page link." };
    }
    return { url: `https://www.facebook.com/${parts.slice(0, parts[0] === "pages" ? 3 : 1).join("/")}` };
  }
  return { error: "Automatic updates work for Instagram and Facebook." };
}
