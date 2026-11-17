const subredditPattern = /^[A-Za-z0-9_]{2,21}$/;
const profilePattern = /^u_[A-Za-z0-9_-]{3,20}$/i;
export const REDDIT_MY_PROFILE = "u/me";
export const REDDIT_TITLE_LIMIT = 300;

export function normalizeSubreddit(value) {
  const name = String(value || "").trim().replace(/^\/?r\//i, "").replace(/\/+$/, "");
  if (/^\/?u\/me$/i.test(name)) return REDDIT_MY_PROFILE;
  return name.replace(/^\/?u\//i, "u_");
}

export function isValidRedditDestination(value) {
  const name = normalizeSubreddit(value);
  if (name === REDDIT_MY_PROFILE) return true;
  return /^u_/i.test(name) ? profilePattern.test(name) : subredditPattern.test(name);
}

export function redditDestinationLabel(value) {
  const name = normalizeSubreddit(value);
  if (name === REDDIT_MY_PROFILE) return "My profile";
  return /^u_/i.test(name) ? `u/${name.slice(2)}` : `r/${name}`;
}

// Resolve only from the account executing this job, never a saved UI username.
export function resolveRedditDestination(value, username = "") {
  let name = normalizeSubreddit(value);
  if (name === REDDIT_MY_PROFILE) {
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(username)) throw new Error("Couldn't identify the logged-in Reddit account for My profile. Reconnect Reddit and try again.");
    name = `u_${username}`;
  }
  if (!isValidRedditDestination(name)) throw new Error("Choose a subreddit such as r/marketing or your profile such as u/yourname.");
  if (/^u_/i.test(name) && username && name.slice(2).toLowerCase() !== username.toLowerCase()) {
    throw new Error(`This Reddit account is u/${username}. You can only publish to its own profile. Choose My profile or connect the matching account.`);
  }
  return name;
}

// Reddit rejects posts without a community and title. Validate at intake and
// again before publishing so an old or edited job never posts to the wrong place.
export function requireRedditOptions(platform, platformOptions) {
  if (platform !== "reddit") return undefined;
  const options = platformOptions?.reddit;
  // Reddit posts always go to the posting account's own profile (u/<name>),
  // whatever an older form or job may have saved as a community.
  const subreddit = REDDIT_MY_PROFILE;
  const title = String(options?.title || "").replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Reddit posts need a title.");
  if (title.length > REDDIT_TITLE_LIMIT) throw new Error(`Reddit titles must be ${REDDIT_TITLE_LIMIT} characters or fewer.`);
  return { reddit: { subreddit, title, nsfw: options?.nsfw === true, spoiler: options?.spoiler === true } };
}
