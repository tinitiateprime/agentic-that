// The ready-to-post text one AI wrote for one app, shaped for posting and kept
// within that app's limit (the AI is told the limits but doesn't always keep them).
import { REDDIT_MY_PROFILE } from "../../../services/publishing/queue-runner/shared/reddit-options.js";

const withTags = (text, tags) => [String(text || "").trim(), (tags || []).filter(Boolean).join(" ")].filter(Boolean).join("\n\n");

/** Each app's post text limit, as in Publishing's composer. */
export const TEXT_LIMITS = { instagram: 2_200, facebook: 63_206, linkedin: 3_000, youtube: 5_000, x: 280, reddit: 40_000 };
export const YOUTUBE_TITLE_LIMIT = 100;
const LABELS = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", youtube: "YouTube", x: "X", reddit: "Reddit" };

const URL_PATTERN = /https?:\/\/\S+/g;
/**
 * Length the way X counts it: links always count 23; Latin and common
 * punctuation count 1; emoji and most other scripts (CJK, Indic) count 2.
 */
export function xLength(text) {
  const value = String(text || "");
  const links = value.match(URL_PATTERN) || [];
  let length = links.length * 23;
  for (const char of value.replace(URL_PATTERN, "")) {
    const code = char.codePointAt(0);
    const light = code <= 4351 || (code >= 8192 && code <= 8205) || (code >= 8208 && code <= 8223) || (code >= 8242 && code <= 8247);
    length += light ? 1 : 2;
  }
  return length;
}

export function textLength(platform, text) {
  return platform === "x" ? xLength(text) : String(text || "").length;
}

/** Cuts text to fit, at the last full sentence if one ends late enough, else at a word, with "…". */
function shorten(platform, text, limit) {
  const fits = (value) => textLength(platform, value) <= limit;
  const words = String(text).trim().split(/(\s+)/);
  let cut = "";
  for (const piece of words) {
    if (!fits(`${cut}${piece}`.trimEnd() + "…")) break;
    cut += piece;
  }
  cut = cut.trimEnd();
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf(".\n"), cut.lastIndexOf("!\n"), cut.lastIndexOf("?\n"));
  if (sentenceEnd >= 0 && textLength(platform, cut.slice(0, sentenceEnd + 1)) >= limit * 0.6) return cut.slice(0, sentenceEnd + 1);
  if (/[.!?]$/.test(cut)) return cut;
  return cut ? `${cut.replace(/[,;:\-–—]+$/, "")}…` : "";
}

/**
 * Post text with hashtags, within the app's limit: hashtags are dropped from
 * the end first; only if the text alone is still too long is it shortened.
 * `note` says what was changed, when anything was.
 */
export function fitToLimit(platform, body, tags = []) {
  const limit = TEXT_LIMITS[platform];
  const kept = (tags || []).filter(Boolean);
  if (!limit || textLength(platform, withTags(body, kept)) <= limit) return { text: withTags(body, kept) };
  const allTags = kept.length;
  while (kept.length && textLength(platform, withTags(body, kept)) > limit) kept.pop();
  const dropped = allTags - kept.length;
  const unit = platform === "x" ? "characters as X counts them" : "characters";
  if (textLength(platform, withTags(body, kept)) <= limit) {
    return { text: withTags(body, kept), note: `${dropped} hashtag${dropped === 1 ? "" : "s"} removed to fit ${LABELS[platform]}'s ${limit} ${unit}.` };
  }
  const short = shorten(platform, body, limit);
  return {
    text: short,
    note: `Shortened to fit ${LABELS[platform]}'s ${limit} ${unit}${allTags ? " (hashtags removed)" : ""}. Check it reads well before posting.`,
  };
}

/** { text, title?, subreddit?, note? } for one app from one AI's result, or null when it wrote nothing for it. */
export function postTextFor(platform, result, kind) {
  if (!result) return null;
  const withNote = (value, fitted) => (fitted.note ? { ...value, note: fitted.note } : value);
  if (platform === "instagram") {
    const fitted = fitToLimit("instagram", result.caption, result.hashtags);
    return withNote({ text: fitted.text }, fitted);
  }
  if (platform === "youtube") {
    const fitted = fitToLimit("youtube", result.description, []);
    const title = kind === "video" ? String(result.title || "").trim().slice(0, YOUTUBE_TITLE_LIMIT) : "";
    return withNote({ text: fitted.text, title }, fitted);
  }
  if (platform === "reddit") {
    // Reddit posts always go to the account's own profile.
    const fitted = fitToLimit("reddit", result.post, []);
    return withNote({ text: fitted.text, title: String(result.title || "").trim().slice(0, 300), subreddit: REDDIT_MY_PROFILE }, fitted);
  }
  const fitted = fitToLimit(platform, result.post, result.hashtags);
  return withNote({ text: fitted.text }, fitted);
}
