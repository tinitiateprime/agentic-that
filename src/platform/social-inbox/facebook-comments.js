// Reads the comments Facebook sends with a reel or a photo post (the graphql
// responses their pages load while signed in: a reel's
// FBUnifiedVideoFeedbackRightRailWithCommentPreloadingQuery, a photo's
// CometPhotoRootContentQuery) into inbox items. Facebook doesn't always send a
// notification for a comment (it often holds back ones from new accounts), so
// the Companion reads the recent reels and posts themselves.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Facebook streams several JSON documents, one per line. */
export function facebookDocuments(text) {
  const source = String(text || "");
  // A page's own data block is one JSON document; responses stream one per line.
  try { return [JSON.parse(source)]; } catch { /* several documents */ }
  return source.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function* commentNodes(node, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (node.legacy_fbid && typeof node.body?.text === "string" && node.author && node.created_time) yield node;
  for (const value of Object.values(node)) yield* commentNodes(value, seen);
}

const PLACES = {
  reel: { context: "Comment on your reel", link: (id, commentId) => `https://www.facebook.com/reel/${id}/?comment_id=${commentId}` },
  photo: { context: "Comment on your post", link: (id, commentId) => `https://www.facebook.com/photo.php?fbid=${id}&comment_id=${commentId}` },
};

/**
 * Inbox items from one reel's or photo post's comment data.
 * @param {object[]} documents the parsed response documents
 * @param {{ reelId?: string, photoId?: string, ownerId?: string }} options ownerId: the account itself, whose comments are answers
 */
export function facebookItemsFromReel(documents, { reelId = "", photoId = "", ownerId = "" }) {
  const place = photoId ? PLACES.photo : PLACES.reel;
  const postId = photoId || reelId;
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
      contextText: place.context,
      permalink: place.link(postId, id),
      receivedAt: Number.isFinite(Number(comment.created_time)) ? new Date(Number(comment.created_time) * 1000).toISOString() : null,
    });
  }
  return items;
}

/** The same reader, for a photo post. */
export const facebookItemsFromPost = (documents, { photoId, ownerId = "" }) => facebookItemsFromReel(documents, { photoId, ownerId });

/** "photo.php?fbid=122137358895319647&set=…" → "122137358895319647", newest first as the page lists them. */
export function photoIdsFromLinks(hrefs, limit = 6) {
  const ids = [];
  for (const href of hrefs || []) {
    const id = /[?&]fbid=(\d{5,30})/.exec(String(href || ""))?.[1] || /\/photos\/[^/]+\/(\d{5,30})/.exec(String(href || ""))?.[1];
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
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
