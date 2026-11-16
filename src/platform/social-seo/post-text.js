// The ready-to-post text one AI wrote for one app, shaped for posting.

const withTags = (text, tags) => [String(text || "").trim(), (tags || []).filter(Boolean).join(" ")].filter(Boolean).join("\n\n");

/** { text, title?, subreddit? } for one app from one AI's result, or null when it wrote nothing for it. */
export function postTextFor(platform, result, kind) {
  if (!result) return null;
  if (platform === "instagram") return { text: withTags(result.caption, result.hashtags) };
  if (platform === "youtube") return { text: String(result.description || "").trim(), title: kind === "video" ? String(result.title || "").trim() : "" };
  if (platform === "reddit") {
    const subreddit = String(result.subreddits?.[0] || "").replace(/^\/?r\//i, "").trim();
    return { text: String(result.post || "").trim(), title: String(result.title || "").trim(), subreddit };
  }
  return { text: withTags(result.post, result.hashtags) };
}
