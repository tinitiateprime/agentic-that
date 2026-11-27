// Reads the comments Facebook sends with a reel (the graphql
// FBUnifiedVideoFeedbackRightRailWithCommentPreloadingQuery response a reel's
// page loads while signed in) into inbox items. Facebook doesn't always send a
// notification for a comment (it often holds back ones from new accounts), so
// the Companion reads the recent reels themselves.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Facebook streams several JSON documents, one per line. */
export function facebookDocuments(text) {
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function* commentNodes(node, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (node.legacy_fbid && typeof node.body?.text === "string" && node.author && node.created_time) yield node;
  for (const value of Object.values(node)) yield* commentNodes(value, seen);
}

/**
 * Inbox items from one reel's comment data.
 * @param {object[]} documents the parsed response documents
 * @param {{ reelId: string, ownerId?: string }} options ownerId: the account itself, whose comments are answers
 */
export function facebookItemsFromReel(documents, { reelId, ownerId = "" }) {
  const items = [];
  const seen = new Set();
  for (const comment of commentNodes(documents)) {
    const id = String(comment.legacy_fbid);
    if (seen.has(id) || !/^\d{5,30}$/.test(id)) continue;
    seen.add(id);
    const authorId = String(comment.author?.id || "");
    if (ownerId && authorId === String(ownerId)) continue;
    const body = clean(comment.body.text);
    if (!body) continue;
    items.push({
      platform: "facebook",
      kind: Number(comment.depth) > 0 ? "reply" : "comment",
      externalId: `fb:${id}`,
      authorName: clean(comment.author?.name) || "Facebook user",
      authorUrl: /^\d{5,30}$/.test(authorId) ? `https://www.facebook.com/${authorId}` : "",
      body: body.slice(0, 4000),
      contextText: "Comment on your reel",
      permalink: `https://www.facebook.com/reel/${reelId}/?comment_id=${id}`,
      receivedAt: Number.isFinite(Number(comment.created_time)) ? new Date(Number(comment.created_time) * 1000).toISOString() : null,
    });
  }
  return items;
}

/** "/reel/1160929579819299/?s=…" → "1160929579819299", newest first as the page lists them. */
export function reelIdsFromLinks(hrefs, limit = 6) {
  const ids = [];
  for (const href of hrefs || []) {
    const id = /\/reel\/(\d{5,30})/.exec(String(href || ""))?.[1];
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}
