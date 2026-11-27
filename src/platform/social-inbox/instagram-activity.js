// Reads Instagram's activity data (the graphql PolarisActivityFeedStoriesViewQuery
// response instagram.com/notifications loads while signed in) into inbox items:
// comments on your posts, replies to your comments, and mentions. Likes,
// follows, suggestions and Instagram's own notices are left out.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// notif_name values that can need an answer; "comment_like" is someone liking a comment.
const ANSWERABLE = /^(comment|comment_reply|reply|mention|mentioned_comment|comment_mention|tagged_comment|comment_on_tag)/i;
const NOT_ANSWERABLE = /like/i;

/** "ahhaha commented: hi there" → "hi there" (also "replied to your comment:", "mentioned you in a comment:"). */
export function instagramCommentText(text, username) {
  const raw = clean(text);
  const prefix = username ? raw.startsWith(`${username} `) ? raw.slice(username.length + 1) : raw : raw;
  const match = /^(?:commented|replied(?: to your comment)?|mentioned you(?: in a comment)?(?: on [^:]+)?|left a comment)[^:]*:\s*(.+)$/i.exec(prefix);
  return clean(match ? match[1] : prefix);
}

function queryParam(destination, name) {
  return new RegExp(`[?&]${name}=([^&]+)`).exec(String(destination || ""))?.[1] || "";
}

/** Inbox items from an activity response (new and earlier notifications). */
export function instagramItemsFromActivity(body) {
  const inbox = body?.data?.xdt_activity_inbox || body?.data?.activity_inbox || {};
  const stories = [...(inbox.new_stories || []), ...(inbox.old_stories || [])];
  const items = [];
  const seen = new Set();
  for (const story of stories) {
    const kind = String(story?.notif_name || "");
    if (!ANSWERABLE.test(kind) || NOT_ANSWERABLE.test(kind)) continue;
    const args = story.args || {};
    const user = args.users?.[0] || {};
    const username = clean(user.username || args.profile_name);
    const commentId = queryParam(args.destination, "target_comment_id") || queryParam(args.destination, "comment_id");
    const shortcode = clean(args.media?.shortcode);
    const body = instagramCommentText(args.text, username);
    const externalId = commentId ? `ig:c:${commentId}` : "";
    if (!username || !body || !/^ig:c:\d{5,30}$/.test(externalId) || seen.has(externalId)) continue;
    seen.add(externalId);
    const isMention = /mention|tag/i.test(kind);
    const isReply = /reply/i.test(kind);
    const timestamp = Number(args.timestamp);
    items.push({
      platform: "instagram",
      kind: isMention ? "mention" : isReply ? "reply" : "comment",
      externalId,
      authorName: username,
      authorUrl: /^[A-Za-z0-9._]{1,30}$/.test(username) ? `https://www.instagram.com/${username}/` : "",
      body: body.slice(0, 4000),
      contextText: isMention ? "Mentioned you" : isReply ? "Reply to your comment" : "Comment on your post",
      permalink: shortcode ? `https://www.instagram.com/p/${shortcode}/c/${commentId}/` : "",
      receivedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null,
    });
  }
  return items;
}
