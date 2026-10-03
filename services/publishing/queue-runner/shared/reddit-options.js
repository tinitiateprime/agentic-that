const subredditPattern = /^[A-Za-z0-9_]{2,21}$/;
export const REDDIT_TITLE_LIMIT = 300;

export function normalizeSubreddit(value) {
  return String(value || "").trim().replace(/^\/?r\//i, "").replace(/\/+$/, "");
}

// Reddit rejects posts without a community and title. Validate at intake and
// again before publishing so an old or edited job never posts to the wrong place.
export function requireRedditOptions(platform, platformOptions) {
  if (platform !== "reddit") return undefined;
  const options = platformOptions?.reddit;
  const subreddit = normalizeSubreddit(options?.subreddit);
  if (!subredditPattern.test(subreddit)) {
    throw new Error("Choose the subreddit for this Reddit post, such as r/marketing.");
  }
  const title = String(options?.title || "").replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Reddit posts need a title.");
  if (title.length > REDDIT_TITLE_LIMIT) throw new Error(`Reddit titles must be ${REDDIT_TITLE_LIMIT} characters or fewer.`);
  return { reddit: { subreddit, title, nsfw: options?.nsfw === true, spoiler: options?.spoiler === true } };
}
