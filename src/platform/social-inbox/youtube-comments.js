// Reads YouTube Studio's own comments data (the youtubei/v1/comment/get_comments
// response the Studio comments page loads while signed in) into inbox items.
// No page scraping: every field comes from the data YouTube sends its page.

const text = (value) => {
  if (!value) return "";
  if (typeof value.simpleText === "string") return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((run) => run?.text || "").join("");
  return "";
};
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const UNITS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };

/** "23 seconds ago", "2 hours ago (edited)" → an approximate time (Studio only gives relative times). */
export function relativeTime(value, now = Date.now()) {
  const match = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(String(value || ""));
  if (!match) return null;
  return new Date(now - Number(match[1]) * UNITS[match[2].toLowerCase()] * 1000).toISOString();
}

function commentLink(renderer) {
  const button = renderer.videoThumbnail?.commentVideoThumbnailRenderer?.viewCommentButton?.buttonRenderer?.navigationEndpoint;
  const url = button?.urlEndpoint?.url || button?.commandMetadata?.webCommandMetadata?.url || "";
  return /^https:\/\/(www\.)?youtube\.com\//.test(url) ? url : "";
}

function authorLink(renderer) {
  const url = renderer.authorEndpoint?.urlEndpoint?.url || renderer.authorEndpoint?.commandMetadata?.webCommandMetadata?.url || "";
  return url.replace(/^http:\/\//, "https://");
}

/**
 * Inbox items from a get_comments response. The channel's own comments are
 * left out unless includeOwn (they are answers, not things to answer).
 */
export function youtubeCommentsFromStudio(body, { now = Date.now(), includeOwn = false } = {}) {
  const threads = body?.contents?.itemSectionRenderer?.contents;
  if (!Array.isArray(threads)) return [];
  const items = [];
  for (const entry of threads) {
    const renderer = entry?.commentThreadRenderer?.comment?.commentRenderer;
    if (!renderer?.commentId) continue;
    const own = renderer.authorIsChannelOwner === true;
    if (own && !includeOwn) continue;
    const message = clean(text(renderer.contentText));
    if (!message) continue;
    items.push({
      platform: "youtube",
      kind: "comment",
      externalId: `yt:${renderer.commentId}`,
      authorName: clean(text(renderer.authorText)) || "YouTube viewer",
      authorUrl: authorLink(renderer),
      body: message.slice(0, 4000),
      contextText: clean(text(renderer.videoThumbnail?.commentVideoThumbnailRenderer?.title)).slice(0, 500),
      permalink: commentLink(renderer),
      receivedAt: relativeTime(text(renderer.publishedTimeText), now),
      ownComment: own,
    });
  }
  return items;
}

/**
 * The Studio comments page for a channel, newest first, only comments the
 * channel hasn't answered yet.
 */
export function studioCommentsUrl(channelId, { unansweredOnly = true } = {}) {
  const filters = [{ isDisabled: false, isPinned: true, name: "SORT_BY", value: "SORT_BY_NEWEST" }];
  if (unansweredOnly) filters.push({ name: "ENGAGED_STATUS", value: ["COMMENT_CATEGORY_NOT_ENGAGED"] });
  const path = channelId ? `/channel/${encodeURIComponent(channelId)}/comments/inbox` : "/comments/inbox";
  return `https://studio.youtube.com${path}?filter=${encodeURIComponent(JSON.stringify(filters))}`;
}
