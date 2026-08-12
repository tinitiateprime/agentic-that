import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Response,
} from "playwright-core";

export type FacebookInputMode = "profile" | "keyword" | "profile_url" | "post_url";
export type FacebookProfileType = "page" | "public_profile";
export type FacebookCollectionMode = "latest" | "range" | "engagement";
export type FacebookRangeType = "date" | "month" | "year";
export type FacebookDiscoveryStatus =
  | "ok"
  | "partial"
  | "temporarily_unavailable"
  | "login_required"
  | "not_found";

export type FacebookScrapeInput = {
  query: string;
  inputMode?: FacebookInputMode;
  profileType?: FacebookProfileType;
  maxResults?: number;
  collectionMode?: FacebookCollectionMode;
  recentDays?: number;
  rangeType?: FacebookRangeType;
  rangeFrom?: string;
  rangeTo?: string;
  timezoneOffsetMinutes?: number;
  skipComments?: boolean;
};

export type FacebookMetricSource = "current_page_payload" | "visible_page" | "visible_reels_grid" | "visible_embed";

export type FacebookComment = {
  author_name: string;
  text: string;
  timestamp: string | null;
  time: string | null;
};

export type FacebookPost = {
  post_id: string | null;
  post_url: string;
  author_name: string | null;
  author_url: string | null;
  profile_type: FacebookProfileType | null;
  content: string | null;
  media_type: "text" | "image" | "video" | "reel" | "mixed" | null;
  thumbnail_url: string | null;
  timestamp: string | null;
  reactions_count: number | null;
  reactions_display: string | null;
  reactions_exact: boolean;
  comments_count: number | null;
  comments_display: string | null;
  comments_exact: boolean;
  top_comments: FacebookComment[];
  views_count: number | null;
  views_display: string | null;
  views_exact: boolean;
  follower_count: number | null;
  follower_count_display: string | null;
  follower_count_exact: boolean;
  engagement_score: number | null;
  metric_source: FacebookMetricSource | null;
  captured_at: string;
};

export type FacebookProfileAnalysis = {
  profile_name: string | null;
  profile_url: string | null;
  profile_type: FacebookProfileType;
  follower_count: number | null;
  follower_count_display: string | null;
  captured_at: string;
  analyzed_posts: number;
  analyzed_reels: number;
  averages: {
    reactions: number | null;
    comments: number | null;
    views: number | null;
  };
  engagement_rate: number | null;
  posting_frequency: {
    posts_last_30_days: number;
    posts_per_week: number;
  };
  top_reacted: FacebookPost[];
  top_discussed: FacebookPost[];
  top_viewed: FacebookPost[];
  patterns: {
    formats: { label: string; count: number }[];
    hashtags: { label: string; count: number }[];
    keywords: { label: string; count: number }[];
    posting_days: { label: string; count: number }[];
    posting_hours: { label: string; count: number }[];
  };
  accuracy: {
    source: string;
    followers: string;
    reactions: string;
    comments: string;
    views: string;
  };
};

export type FacebookScrapeDiagnostics = {
  attempts: number;
  browser_session?: "anonymous" | "connected" | "local_chrome";
  page_visibility?: string;
  scroll_rounds: number;
  dom_candidates: number;
  payload_candidates: number;
  timeline_plugin_candidates?: number;
  reels_grid_candidates: number;
  unique_candidates: number;
  accepted_results: number;
  comments_opened: number;
  comments_scraped: number;
  rejected: {
    missing_url: number;
    unexpected_post: number;
    owner_mismatch: number;
    missing_timestamp: number;
    out_of_range: number;
  };
  final_url: string;
  page_title: string;
  discovery_path?: string[];
  stage_failures?: Partial<Record<"all" | "timeline" | "reels" | "details" | "comments", string>>;
};

export type FacebookScrapeResult = {
  query: string;
  results: FacebookPost[];
  analysis?: FacebookProfileAnalysis;
  discoveryStatus: FacebookDiscoveryStatus;
  diagnostics: FacebookScrapeDiagnostics;
};

export type FacebookBrowserSession = {
  context: BrowserContext;
  page: Page;
  userAgent: string;
  sessionMode?: "anonymous" | "connected" | "local_chrome";
  close(): Promise<void>;
};

export type FacebookBrowserSessionFactory = {
  create(): Promise<FacebookBrowserSession>;
};

export type FacebookAccessSnapshot = {
  url: string;
  articleCount: number;
  postLinkCount: number;
  visibleLoginInputCount: number;
  bodyText: string;
};

type NormalizedFacebookQuery = {
  mode: "profile" | "keyword" | "post";
  label: string;
  startUrl: string;
  profileType: FacebookProfileType;
  targetProfileUrl?: string;
  fallbackStartUrl?: string;
};

type RawCandidate = Partial<FacebookPost> & {
  metric_text?: string | null;
  _source?: FacebookMetricSource;
};

type RangeWindow = {
  active: boolean;
  start: number;
  end: number;
  direction: "ascending" | "descending";
};

export type FacebookDiscoveryPlan = {
  initialTab: "all" | "reels" | null;
  collectAll: boolean;
  collectTimelinePlugin: boolean;
  collectReels: boolean;
  reelsArePrimary: boolean;
};

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACEBOOK_ORIGIN = "https://www.facebook.com";
const POST_PATH_PATTERN = /\/(?:posts|videos|reel|watch|photo|story\.php|permalink\.php)(?:\/|\?|$)/i;
const UNSUPPORTED_PROFILE_PATH_PATTERN = /^\/(?:groups|events|marketplace|gaming|watch|hashtag|plugins|share)(?:\/|$)/i;

export function facebookDiscoveryPlan(
  input: Pick<FacebookScrapeInput, "collectionMode">,
  mode: NormalizedFacebookQuery["mode"],
): FacebookDiscoveryPlan {
  const collectionMode = input.collectionMode || "latest";
  const reelsArePrimary = mode === "profile" && collectionMode === "engagement";
  return {
    initialTab: mode === "profile" ? (reelsArePrimary ? "reels" : "all") : null,
    collectAll: !reelsArePrimary,
    collectTimelinePlugin: mode === "profile" && !reelsArePrimary,
    collectReels: mode === "profile" || mode === "post",
    reelsArePrimary,
  };
}
const TRACKING_PARAMS = new Set(["__cft__", "__tn__", "mibextid", "ref", "refid", "rdid", "share_url"]);

export function facebookNavigationHeaders() {
  return { "Accept-Language": "en-US,en;q=0.9" };
}

export const facebookServiceInfo = {
  serviceRoot,
  dataDir: path.join(serviceRoot, "data"),
  platform: `${os.platform()}-${os.arch()}`,
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function facebookHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/^www\./, "");
  return value === "facebook.com" || value.endsWith(".facebook.com") || value === "fb.com" || value === "fb.watch";
}

function absoluteFacebookUrl(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `${FACEBOOK_ORIGIN}${raw.startsWith("/") ? "" : "/"}${raw}`);
    if (!facebookHostname(url.hostname)) return null;
    url.protocol = "https:";
    if (url.hostname.toLowerCase() !== "fb.watch") url.hostname = "www.facebook.com";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key) || key.startsWith("__cft__") || key.startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function facebookUrlType(value: string) {
  const urlValue = absoluteFacebookUrl(value);
  if (!urlValue) return null;
  const url = new URL(urlValue);
  if (url.hostname.toLowerCase() === "fb.watch") return "post" as const;
  const combined = `${url.pathname}${url.search}`;
  if (POST_PATH_PATTERN.test(combined) || /^\/share\/(?:p|r|v)\//i.test(url.pathname) || url.searchParams.has("story_fbid") || url.searchParams.has("fbid") || url.searchParams.has("v")) {
    return "post" as const;
  }
  if (/^\/(?:login|checkpoint|recover|help|search)(?:\/|$)/i.test(url.pathname)
    || UNSUPPORTED_PROFILE_PATH_PATTERN.test(url.pathname)) return null;
  return "profile" as const;
}

function normalizeProfileHandle(value: string) {
  return value
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

export function normalizeFacebookQuery(input: FacebookScrapeInput): NormalizedFacebookQuery {
  const query = text(input.query);
  if (!query) throw new Error("Query is required.");
  const requestedMode = input.inputMode || (/^https?:\/\//i.test(query) ? "profile_url" : "profile");
  const profileType = input.profileType === "public_profile" ? "public_profile" : "page";

  if (requestedMode === "keyword") {
    const hashtag = query.startsWith("#");
    const keyword = query.replace(/^#+/, "").trim();
    if (!keyword) throw new Error("Enter a Facebook keyword.");
    const tag = keyword.replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase();
    if (!tag) throw new Error("Enter a Facebook keyword or hashtag.");
    return {
      mode: "keyword",
      label: hashtag ? `#${tag}` : keyword,
      profileType,
      // Logged-out Facebook Search can close a serverless Chromium target before
      // it renders. The public hashtag surface is the stable anonymous source,
      // so use it first and retain general Search only as a best-effort fallback.
      startUrl: `${FACEBOOK_ORIGIN}/hashtag/${encodeURIComponent(tag)}`,
      fallbackStartUrl: hashtag ? undefined : `${FACEBOOK_ORIGIN}/search/posts/?q=${encodeURIComponent(keyword)}`,
    };
  }

  if (requestedMode === "post_url") {
    const postUrl = canonicalPostUrl(query);
    if (!postUrl || facebookUrlType(postUrl) !== "post") {
      throw new Error("Enter a Facebook post, Reel, photo, or video URL.");
    }
    return { mode: "post", label: postUrl, profileType, startUrl: postUrl };
  }

  if (requestedMode === "profile_url") {
    const profileUrl = absoluteFacebookUrl(query);
    if (!profileUrl || facebookUrlType(profileUrl) !== "profile") {
      throw new Error("Enter a Facebook Page or public profile URL.");
    }
    return {
      mode: "profile",
      label: profileUrl,
      profileType,
      startUrl: profileUrl,
      targetProfileUrl: profileUrl,
    };
  }

  const handle = normalizeProfileHandle(query);
  if (!handle || /\s/.test(handle) || !/^[A-Za-z0-9._-]+$/.test(handle)) {
    throw new Error("Enter a Facebook Page username or public profile username.");
  }
  const profileUrl = `${FACEBOOK_ORIGIN}/${encodeURIComponent(handle).replace(/%2E/gi, ".")}/`;
  return {
    mode: "profile",
    label: handle,
    profileType,
    startUrl: profileUrl,
    targetProfileUrl: profileUrl,
  };
}

export function classifyFacebookAccess(snapshot: FacebookAccessSnapshot): FacebookDiscoveryStatus | "public_content" | "unknown" {
  if (snapshot.articleCount > 0 || snapshot.postLinkCount > 0) return "public_content";
  const body = snapshot.bodyText.toLowerCase();
  if (/\/login|\/checkpoint/i.test(snapshot.url) || snapshot.visibleLoginInputCount > 0 || /log in to continue|you must log in/i.test(body)) {
    return "login_required";
  }
  if (/content isn't available|page isn't available|this page isn't available|may have been removed|couldn't find this page/i.test(body)) {
    return "not_found";
  }
  return "unknown";
}

export function parseFacebookCount(value: unknown) {
  const display = text(value).replace(/\u00a0/g, " ");
  if (!display) return null;
  const match = display.match(/([0-9][0-9,]*(?:\.[0-9]+)?)[ ]*([KMB])?/i);
  if (!match) return null;
  const numeric = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;
  const multiplier = match[2]?.toUpperCase() === "K"
    ? 1_000
    : match[2]?.toUpperCase() === "M"
      ? 1_000_000
      : match[2]?.toUpperCase() === "B"
        ? 1_000_000_000
        : 1;
  return Math.round(numeric * multiplier);
}

function metricFromText(value: string, labels: string[], allowReversed = true) {
  const label = labels.join("|");
  const patterns = [
    new RegExp(`([0-9][0-9,.]*\\s*[KMB]?)\\s*(?:${label})`, "i"),
    ...(allowReversed ? [new RegExp(`(?:${label})[^0-9]{0,12}([0-9][0-9,.]*\\s*[KMB]?)`, "i")] : []),
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const count = parseFacebookCount(match[1]);
    if (count !== null) return { count, display: match[1].trim() };
  }
  return { count: null, display: null };
}

function isoTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) return isoTimestamp(Number(raw));
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function facebookVisibleTimestamp(value: unknown, capturedAt = new Date().toISOString()) {
  const exact = isoTimestamp(value);
  if (exact) return exact;
  const raw = text(value).toLowerCase().replace(/\s+/g, " ");
  const captured = new Date(capturedAt).getTime();
  if (!raw || !Number.isFinite(captured)) return null;
  if (/^(?:just now|now)$/.test(raw)) return new Date(captured).toISOString();
  if (/^yesterday(?:\s+at\s+.*)?$/.test(raw)) return new Date(captured - 86_400_000).toISOString();
  const relative = raw.match(/^(\d+)\s*(s|sec(?:ond)?s?|m|min(?:ute)?s?|h|hr|hours?|d|days?|w|weeks?)$/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const multiplier = unit.startsWith("s")
      ? 1_000
      : unit === "m" || unit.startsWith("min")
        ? 60_000
        : unit === "h" || unit.startsWith("hr") || unit.startsWith("hour")
          ? 3_600_000
          : unit === "d" || unit.startsWith("day")
            ? 86_400_000
            : 7 * 86_400_000;
    return new Date(captured - amount * multiplier).toISOString();
  }
  const calendar = new Date(raw.replace(/\s+at\s+/i, " "));
  return Number.isFinite(calendar.getTime()) ? calendar.toISOString() : null;
}

function postIdFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.searchParams.get("story_fbid")
      || url.searchParams.get("fbid")
      || url.searchParams.get("v")
      || url.pathname.match(/\/(?:posts|videos|reel)\/([^/?]+)/i)?.[1]
      || null;
  } catch {
    return null;
  }
}

function canonicalPostUrl(value: string | null | undefined) {
  if (!value) return null;
  const urlValue = absoluteFacebookUrl(value);
  if (!urlValue || facebookUrlType(urlValue) !== "post") return null;
  const url = new URL(urlValue);
  const allowed = /\/(?:story\.php|permalink\.php)$/i.test(url.pathname)
    ? new Set(["story_fbid", "id"])
    : /\/photo\/?$/i.test(url.pathname)
      ? new Set(["fbid", "id", "set"])
      : /\/watch\/?$/i.test(url.pathname)
        ? new Set(["v"])
        : new Set<string>();
  for (const key of [...url.searchParams.keys()]) if (!allowed.has(key)) url.searchParams.delete(key);
  return url.toString();
}

export function facebookProfileTabUrl(value: string, tab: "all" | "reels") {
  const profileUrl = absoluteFacebookUrl(value);
  if (!profileUrl || facebookUrlType(profileUrl) !== "profile") return null;
  const url = new URL(profileUrl);
  if (/\/reels\/?$/i.test(url.pathname)) url.pathname = url.pathname.replace(/\/reels\/?$/i, "/");
  if (/\/profile\.php$/i.test(url.pathname)) {
    if (tab === "reels") url.searchParams.set("sk", "reels");
    else url.searchParams.delete("sk");
  } else if (tab === "reels") {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/reels/`;
  }
  return url.toString();
}

export function parseFacebookReelViewLabel(value: unknown) {
  const label = text(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  if (!label) return null;
  const labeled = label.match(/([0-9][0-9,]*(?:\.[0-9]+)?\s*[KMB]?)\s+views?\b/i);
  const bare = label.match(/^([0-9][0-9,]*(?:\.[0-9]+)?\s*[KMB]?)$/i);
  const display = (labeled?.[1] || bare?.[1] || "").replace(/\s+/g, "").toUpperCase();
  const count = parseFacebookCount(display);
  if (count === null) return null;
  return { count, display, exact: !/[KMB]$/i.test(display) };
}

export function facebookPostIdentity(post: Pick<FacebookPost, "post_id" | "post_url">) {
  return `url:${post.post_url}`;
}

function thumbnailIdentity(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const filename = url.pathname.split("/").filter(Boolean).at(-1) || "";
    return filename.length >= 12 ? filename.toLowerCase() : null;
  } catch {
    return null;
  }
}

function mergePostIntoMap(target: Map<string, FacebookPost>, post: FacebookPost) {
  const identity = facebookPostIdentity(post);
  const existing = target.get(identity);
  target.set(identity, existing ? mergePosts(existing, post) : post);
}

function formatMetric(value: number | null) {
  return value === null ? null : value.toLocaleString("en-US");
}

function candidateFromRaw(raw: RawCandidate, profileType: FacebookProfileType, capturedAt: string): FacebookPost | null {
  const postUrl = canonicalPostUrl(raw.post_url);
  if (!postUrl) return null;
  const metrics = raw.metric_text || "";
  const reactions = raw.reactions_count !== undefined && raw.reactions_count !== null
    ? { count: finiteNumber(raw.reactions_count), display: raw.reactions_display || formatMetric(finiteNumber(raw.reactions_count)) }
    : metricFromText(metrics, ["all\\s+reactions"]);
  const comments = raw.comments_count !== undefined && raw.comments_count !== null
    ? { count: finiteNumber(raw.comments_count), display: raw.comments_display || formatMetric(finiteNumber(raw.comments_count)) }
    : { count: null, display: null };
  const views = raw.views_count !== undefined && raw.views_count !== null
    ? { count: finiteNumber(raw.views_count), display: raw.views_display || formatMetric(finiteNumber(raw.views_count)) }
    : { count: null, display: null };
  const followers = raw.follower_count !== undefined && raw.follower_count !== null
    ? { count: finiteNumber(raw.follower_count), display: raw.follower_count_display || formatMetric(finiteNumber(raw.follower_count)) }
    : { count: null, display: null };
  const engagementValues = [reactions.count, comments.count].filter((item): item is number => item !== null);
  return {
    post_id: raw.post_id || postIdFromUrl(postUrl),
    post_url: postUrl,
    author_name: text(raw.author_name) || null,
    author_url: absoluteFacebookUrl(text(raw.author_url)) || null,
    profile_type: raw.profile_type || profileType,
    content: text(raw.content).slice(0, 20_000) || null,
    media_type: raw.media_type || "text",
    thumbnail_url: text(raw.thumbnail_url) || null,
    timestamp: facebookVisibleTimestamp(raw.timestamp, capturedAt),
    reactions_count: reactions.count,
    reactions_display: reactions.display,
    reactions_exact: Boolean(raw.reactions_exact),
    comments_count: comments.count,
    comments_display: comments.display,
    comments_exact: Boolean(raw.comments_exact),
    top_comments: Array.isArray(raw.top_comments) ? raw.top_comments.slice(0, 10) : [],
    views_count: views.count,
    views_display: views.display,
    views_exact: Boolean(raw.views_exact),
    follower_count: followers.count,
    follower_count_display: followers.display,
    follower_count_exact: Boolean(raw.follower_count_exact),
    engagement_score: engagementValues.length ? engagementValues.reduce((sum, item) => sum + item, 0) : null,
    metric_source: raw._source || "visible_page",
    captured_at: capturedAt,
  };
}

function mergeMetric(
  currentValue: number | null,
  currentDisplay: string | null,
  currentExact: boolean,
  incomingValue: number | null,
  incomingDisplay: string | null,
  incomingExact: boolean,
) {
  if (incomingValue === null) return { value: currentValue, display: currentDisplay, exact: currentExact };
  if (currentValue === null || (incomingExact && !currentExact)) {
    return { value: incomingValue, display: incomingDisplay, exact: incomingExact };
  }
  return { value: currentValue, display: currentDisplay, exact: currentExact };
}

function mergePosts(current: FacebookPost, incoming: FacebookPost) {
  const reactions = mergeMetric(current.reactions_count, current.reactions_display, current.reactions_exact, incoming.reactions_count, incoming.reactions_display, incoming.reactions_exact);
  const comments = mergeMetric(current.comments_count, current.comments_display, current.comments_exact, incoming.comments_count, incoming.comments_display, incoming.comments_exact);
  const views = mergeMetric(current.views_count, current.views_display, current.views_exact, incoming.views_count, incoming.views_display, incoming.views_exact);
  const followers = mergeMetric(current.follower_count, current.follower_count_display, current.follower_count_exact, incoming.follower_count, incoming.follower_count_display, incoming.follower_count_exact);
  const engagementValues = [reactions.value, comments.value].filter((item): item is number => item !== null);
  const sourceQuality = (source: FacebookMetricSource | null) => source === "visible_embed"
    ? 4
    : source === "visible_page"
      ? 3
      : source === "current_page_payload"
        ? 2
        : 1;
  const content = incoming.content && (!current.content || sourceQuality(incoming.metric_source) > sourceQuality(current.metric_source))
    ? incoming.content
    : current.content;
  return {
    ...current,
    post_id: current.post_id || incoming.post_id,
    author_name: current.author_name || incoming.author_name,
    author_url: current.author_url || incoming.author_url,
    content,
    media_type: current.media_type === "text" && incoming.media_type !== "text" ? incoming.media_type : current.media_type,
    thumbnail_url: current.thumbnail_url || incoming.thumbnail_url,
    timestamp: current.timestamp || incoming.timestamp,
    reactions_count: reactions.value,
    reactions_display: reactions.display,
    reactions_exact: reactions.exact,
    comments_count: comments.value,
    comments_display: comments.display,
    comments_exact: comments.exact,
    top_comments: incoming.top_comments.length > current.top_comments.length ? incoming.top_comments : current.top_comments,
    views_count: views.value,
    views_display: views.display,
    views_exact: views.exact,
    follower_count: followers.value,
    follower_count_display: followers.display,
    follower_count_exact: followers.exact,
    engagement_score: engagementValues.length ? engagementValues.reduce((sum, item) => sum + item, 0) : null,
    metric_source: incoming.metric_source === "visible_reels_grid"
      ? "visible_reels_grid"
      : incoming.metric_source === "current_page_payload"
        ? "current_page_payload"
        : current.metric_source,
  } satisfies FacebookPost;
}

function rangeBoundary(type: FacebookRangeType, value: string, end: boolean, timezoneOffsetMinutes: number) {
  const parts = value.split("-").map(Number);
  const year = parts[0];
  const month = type === "year" ? (end ? 12 : 1) : parts[1];
  let day = type === "date" ? parts[2] : 1;
  if (end && type !== "date") day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const hour = end ? 23 : 0;
  const minute = end ? 59 : 0;
  const second = end ? 59 : 0;
  const valueMs = Date.UTC(year, month - 1, day, hour, minute, second, end ? 999 : 0);
  return valueMs + timezoneOffsetMinutes * 60_000;
}

function scrapeRange(input: FacebookScrapeInput): RangeWindow {
  if (input.collectionMode !== "range") {
    const end = Date.now();
    return { active: false, start: end - Math.max(1, input.recentDays || 7) * 86_400_000, end, direction: "descending" };
  }
  const type = input.rangeType;
  const from = text(input.rangeFrom);
  const to = text(input.rangeTo);
  if (!type || !from || !to) throw new Error("Choose a valid range type, start, and end.");
  const offset = Math.max(-840, Math.min(840, Number(input.timezoneOffsetMinutes) || 0));
  const first = rangeBoundary(type, from, false, offset);
  const second = rangeBoundary(type, to, false, offset);
  if (!Number.isFinite(first) || !Number.isFinite(second)) throw new Error("Choose a valid Facebook post range.");
  const direction = first <= second ? "ascending" : "descending";
  const earlier = direction === "ascending" ? from : to;
  const later = direction === "ascending" ? to : from;
  return {
    active: true,
    start: rangeBoundary(type, earlier, false, offset),
    end: rangeBoundary(type, later, true, offset),
    direction,
  };
}

function timestampMs(post: FacebookPost) {
  const value = post.timestamp ? new Date(post.timestamp).getTime() : NaN;
  return Number.isFinite(value) ? value : null;
}

function targetProfileKey(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.pathname.toLowerCase() === "/profile.php") return `id:${url.searchParams.get("id") || ""}`;
    const numericProfile = url.pathname.match(/^\/people\/[^/]+\/(\d+)(?:\/|$)/i);
    if (numericProfile) return `id:${numericProfile[1]}`;
    return url.pathname.replace(/^\/+|\/+$/g, "").split("/")[0]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

function candidateMatchesProfile(post: FacebookPost, targetUrl: string | undefined) {
  const target = targetProfileKey(targetUrl);
  if (!target || !post.author_url) return true;
  return targetProfileKey(post.author_url) === target;
}

function rankMetric(posts: FacebookPost[], key: keyof FacebookPost, limit = 5) {
  return posts
    .filter(post => typeof post[key] === "number")
    .slice()
    .sort((left, right) => Number(right[key]) - Number(left[key]))
    .slice(0, limit);
}

export function selectFacebookPrimaryResults(
  posts: FacebookPost[],
  reels: FacebookPost[],
  collectionMode: FacebookCollectionMode,
  mode: "profile" | "keyword" | "post",
  limit: number,
) {
  return collectionMode === "engagement" && mode === "profile"
    ? rankMetric(reels, "views_count", limit)
    : posts.slice(0, limit);
}

function average(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
}

function frequency(items: string[], labels?: string[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || (labels ? labels.indexOf(left.label) - labels.indexOf(right.label) : left.label.localeCompare(right.label)));
}

const STOPWORDS = new Set(["about", "after", "again", "also", "and", "are", "been", "before", "being", "but", "can", "facebook", "for", "from", "have", "into", "just", "more", "our", "that", "the", "their", "there", "they", "this", "was", "were", "will", "with", "you", "your"]);

export function buildFacebookProfileAnalysis(
  posts: FacebookPost[],
  profileType: FacebookProfileType,
  profileUrl: string | null,
  profileName: string | null,
  followerCount: number | null,
  followerDisplay: string | null,
  capturedAt = new Date().toISOString(),
  reels: FacebookPost[] = posts.filter(post => post.metric_source === "visible_reels_grid" && post.views_count !== null),
): FacebookProfileAnalysis {
  const averages = {
    reactions: average(posts.map(post => post.reactions_count)),
    comments: average(posts.map(post => post.comments_count)),
    views: average(reels.map(post => post.views_count)),
  };
  const engagementParts = [averages.reactions, averages.comments].filter((value): value is number => value !== null);
  const engagementRate = followerCount && engagementParts.length
    ? Number(((engagementParts.reduce((sum, value) => sum + value, 0) / followerCount) * 100).toFixed(4))
    : null;
  const now = new Date(capturedAt).getTime();
  const recentPosts = posts.filter(post => {
    const time = timestampMs(post);
    return time !== null && now - time >= 0 && now - time <= 30 * 86_400_000;
  }).length;
  const hashtags = posts.flatMap(post => post.content?.match(/#[\p{L}\p{N}_]+/gu) || []).map(tag => tag.toLowerCase());
  const keywords = posts.flatMap(post => (post.content?.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) || []))
    .filter(word => !STOPWORDS.has(word) && !word.startsWith("http") && !/^\d+$/.test(word));
  const dated = posts.map(post => post.timestamp ? new Date(post.timestamp) : null).filter((date): date is Date => Boolean(date && Number.isFinite(date.getTime())));
  const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return {
    profile_name: profileName,
    profile_url: profileUrl,
    profile_type: profileType,
    follower_count: followerCount,
    follower_count_display: followerDisplay,
    captured_at: capturedAt,
    analyzed_posts: posts.length,
    analyzed_reels: reels.length,
    averages,
    engagement_rate: engagementRate,
    posting_frequency: { posts_last_30_days: recentPosts, posts_per_week: Number((recentPosts / (30 / 7)).toFixed(2)) },
    top_reacted: rankMetric(posts, "reactions_count"),
    top_discussed: rankMetric(posts, "comments_count"),
    top_viewed: rankMetric(reels, "views_count"),
    patterns: {
      formats: frequency(posts.map(post => post.media_type || "unknown")),
      hashtags: frequency(hashtags).slice(0, 12),
      keywords: frequency(keywords).slice(0, 12),
      posting_days: frequency(dated.map(date => dayLabels[date.getUTCDay()]), dayLabels),
      posting_hours: frequency(dated.map(date => `${String(date.getUTCHours()).padStart(2, "0")}:00`)),
    },
    accuracy: {
      source: "Fresh public Facebook browser pages and their current browser responses",
      followers: followerCount === null ? "Unavailable" : "Visible on the current public profile",
      reactions: `${posts.filter(post => post.reactions_exact).length}/${posts.length} exact`,
      comments: `${posts.filter(post => post.comments_exact).length}/${posts.length} exact`,
      views: `${reels.length}/${reels.length} collected directly from the visible Reels grid`,
    },
  };
}

async function accessSnapshot(page: Page): Promise<FacebookAccessSnapshot> {
  return page.evaluate<FacebookAccessSnapshot>(String.raw`(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const postLinkSelector = 'a[href*="/posts/"],a[href*="/videos/"],a[href*="/reel/"],a[href*="story_fbid="],a[href*="permalink.php"]';
    return {
      url: location.href,
      articleCount: document.querySelectorAll('[role="article"],article,[data-pagelet*="FeedUnit"]').length,
      postLinkCount: document.querySelectorAll(postLinkSelector).length,
      visibleLoginInputCount: [...document.querySelectorAll('input[name="email"],input[name="pass"],input[type="password"]')].filter(visible).length,
      bodyText: (document.body?.innerText || "").slice(0, 20_000),
    };
  })()`);
}

async function dismissFacebookPrompts(page: Page, pressEscape = true) {
  for (let round = 0; round < 3; round += 1) {
    if (pressEscape) await page.keyboard.press("Escape").catch(() => undefined);
    let clicked = false;
    for (const label of ["Only allow essential cookies", "Allow all cookies", "Decline optional cookies", "Not now"]) {
      const button = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 1_500 }).catch(() => undefined);
        clicked = true;
        break;
      }
    }
    if (!clicked) break;
    await page.waitForTimeout(300);
  }
}

export async function extractFacebookDomCandidates(page: Page): Promise<RawCandidate[]> {
  return page.evaluate<RawCandidate[]>(String.raw`(() => {
    const postPattern = /\/(?:posts|videos|reel)(?:\/|\?)|story_fbid=|permalink\.php|photo\/?\?|watch\/?\?v=/i;
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const compactCount = (value) => {
      const match = clean(value).match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*([KMB])?$/i);
      if (!match) return null;
      const number = Number(match[1].replace(/,/g, ""));
      const suffix = (match[2] || "").toUpperCase();
      const multiplier = suffix === "K" ? 1000 : suffix === "M" ? 1000000 : suffix === "B" ? 1000000000 : 1;
      return Number.isFinite(number) ? Math.round(number * multiplier) : null;
    };
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const absolute = (href) => {
      try { return new URL(href, location.href).toString(); } catch { return ""; }
    };
    const articles = [...document.querySelectorAll('[role="article"],article,[data-pagelet*="FeedUnit"]')].filter(visible).slice(0, 250);
    return articles.map(article => {
      const anchors = [...article.querySelectorAll("a[href]")];
      const postAnchor = anchors.find(anchor => postPattern.test(anchor.getAttribute("href") || ""));
      if (!postAnchor) return null;
      if (/[?&](?:comment_id|reply_comment_id)=/i.test(postAnchor.getAttribute("href") || "")) return null;
      const headings = [...article.querySelectorAll("h1,h2,h3,h4,strong")];
      const authorAnchor = headings.flatMap(heading => [...heading.querySelectorAll("a[href]")])[0]
        || anchors.find(anchor => !postPattern.test(anchor.getAttribute("href") || "") && clean(anchor.textContent).length > 1);
      const messageNodes = [...article.querySelectorAll('[data-ad-preview="message"],[data-ad-comet-preview="message"],[data-testid="post_message"]')]
        .filter(visible)
        .map(node => clean(node.innerText))
        .filter(value => value.length > 1 && value.length < 20_000);
      const fallbackNodes = [...article.querySelectorAll('div[dir="auto"]')]
        .filter(visible)
        .filter(node => !node.closest('[aria-label^="Comment by " i],[aria-label*=" comment by " i]'))
        .map(node => clean(node.innerText))
        .filter(value => value.length > 1 && value.length < 20_000);
      const preferred = messageNodes.length ? messageNodes : fallbackNodes;
      const content = [...new Set(preferred)].sort((left, right) => right.length - left.length)[0] || null;
      const timeNode = article.querySelector("time[datetime],abbr[data-utime],[data-utime]");
      const timeAnchor = anchors.find(anchor => {
        if (!postPattern.test(anchor.getAttribute("href") || "")) return false;
        const label = clean([anchor.getAttribute("aria-label"), anchor.getAttribute("title"), anchor.textContent].filter(Boolean).join(" "));
        return /^(?:just now|now|yesterday|\d+\s*(?:s|m|h|d|w)|(?:mon|tue|wed|thu|fri|sat|sun)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i.test(label);
      });
      const timestamp = timeNode?.getAttribute("datetime")
        || timeNode?.getAttribute("data-utime")
        || timeAnchor?.getAttribute("aria-label")
        || timeAnchor?.getAttribute("title")
        || clean(timeAnchor?.textContent)
        || null;
      const images = [...article.querySelectorAll("img[src]")].filter(visible).map(image => ({
        src: image.currentSrc || image.src,
        score: Math.max(image.naturalWidth * image.naturalHeight, image.width * image.height),
        alt: clean(image.alt),
      })).filter(image => image.src && !image.src.startsWith("data:") && !/emoji|staticxx|rsrc\.php/i.test(image.src) && image.score >= 2_500);
      images.sort((left, right) => right.score - left.score);
      const hasVideo = Boolean(article.querySelector("video"));
      const postUrl = absolute(postAnchor.getAttribute("href") || "");
      const mediaType = /\/reel\//i.test(postUrl) ? "reel" : hasVideo ? "video" : images.length ? "image" : "text";
      const labels = [...article.querySelectorAll("[aria-label],[title]")]
        .map(node => (node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || ""));
      const articleText = clean(article.innerText);
      const feedbackMatch = articleText.match(/all reactions\s*:?\s*([0-9][0-9,]*(?:\.[0-9]+)?(?:\s*[KMB])?)/i);
      const feedbackTail = feedbackMatch && feedbackMatch.index !== undefined
        ? articleText.slice(feedbackMatch.index + feedbackMatch[0].length, feedbackMatch.index + feedbackMatch[0].length + 160)
        : "";
      const commentMatch = feedbackTail.match(/([0-9][0-9,]*(?:\.[0-9]+)?(?:\s*[KMB])?)\s+comments?\b/i);
      const reactionDisplay = feedbackMatch?.[1] || null;
      const commentDisplay = commentMatch?.[1] || null;
      return {
        post_url: postUrl,
        author_name: clean(authorAnchor?.textContent) || null,
        author_url: authorAnchor ? absolute(authorAnchor.getAttribute("href") || "") : null,
        content,
        media_type: mediaType,
        thumbnail_url: images[0]?.src || null,
        timestamp,
        reactions_count: reactionDisplay ? compactCount(reactionDisplay) : null,
        reactions_display: reactionDisplay,
        reactions_exact: false,
        comments_count: commentDisplay ? compactCount(commentDisplay) : null,
        comments_display: commentDisplay,
        comments_exact: false,
        metric_text: (articleText + " " + labels.join(" ")).slice(0, 40_000),
        _source: "visible_page",
      };
    }).filter(Boolean);
  })()`);
}

export async function extractFacebookReelsGridCandidates(page: Page): Promise<RawCandidate[]> {
  const tiles = await page.evaluate<Array<{ post_url: string; thumbnail_url: string | null; labels: string[] }>>(String.raw`(() => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const anchors = [...document.querySelectorAll('a[href*="/reel/"]')].filter(visible).slice(0, 500);
    return anchors.map(anchor => {
      const labels = [];
      const add = (value) => {
        const normalized = clean(value);
        if (normalized && normalized.length <= 120 && !labels.includes(normalized)) labels.push(normalized);
      };
      add(anchor.getAttribute("aria-label"));
      add(anchor.getAttribute("title"));
      add(anchor.innerText);
      for (const node of anchor.querySelectorAll('[aria-label],[title]')) {
        const aria = node.getAttribute("aria-label") || "";
        const title = node.getAttribute("title") || "";
        if (/views?|plays?/i.test(aria + " " + title)) {
          add(aria);
          add(title);
          add(node.parentElement?.innerText);
        }
      }
      const parentText = clean(anchor.parentElement?.innerText);
      if (parentText.length <= 80) add(parentText);
      const image = [...anchor.querySelectorAll("img[src]")].find(visible);
      return {
        post_url: anchor.href,
        thumbnail_url: image ? image.currentSrc || image.src : null,
        labels,
      };
    });
  })()`);
  const candidates: RawCandidate[] = [];
  for (const tile of tiles) {
    const views = tile.labels.map(parseFacebookReelViewLabel).find(Boolean);
    if (!views) continue;
    candidates.push({
      post_id: postIdFromUrl(tile.post_url),
      post_url: tile.post_url,
      media_type: "reel",
      thumbnail_url: tile.thumbnail_url,
      views_count: views.count,
      views_display: views.display,
      views_exact: views.exact,
      _source: "visible_reels_grid",
    });
  }
  return candidates;
}

function normalizedFacebookHtml(value: string) {
  return String(value || "")
    .replace(/&quot;/gi, '"')
    // Reels data can be JSON nested inside another JSON string. Collapse every
    // escaping layer so one parser works on direct pages and serialized DOM.
    .replace(/\\+"/g, '"')
    .replace(/\\\//g, "/");
}

function facebookPostTimestampsFromNormalizedHtml(normalized: string) {
  const timestamps = new Map<string, string>();
  const capturedAt = Date.now();
  const patterns = [
    /"publish_time"\s*:\s*(\d{9,13})[\s\S]{0,500}?"story_fbid"\s*:\s*\[\s*"(\d+)"/g,
    /"story_fbid"\s*:\s*\[\s*"(\d+)"[\s\S]{0,500}?"publish_time"\s*:\s*(\d{9,13})/g,
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of normalized.matchAll(pattern)) {
      const postId = index === 0 ? match[2] : match[1];
      let timestamp = Number(index === 0 ? match[1] : match[2]);
      if (!postId || !Number.isFinite(timestamp)) continue;
      if (timestamp >= 1_000_000_000_000) timestamp /= 1_000;
      const milliseconds = timestamp * 1_000;
      if (milliseconds < Date.UTC(2004, 0, 1) || milliseconds > capturedAt + 366 * 86_400_000) continue;
      if (!timestamps.has(postId)) timestamps.set(postId, new Date(milliseconds).toISOString());
    }
  }
  return timestamps;
}

export function facebookPostTimestampsFromHtml(value: string) {
  return facebookPostTimestampsFromNormalizedHtml(normalizedFacebookHtml(value));
}

function facebookPostDetailsFromNormalizedHtml(
  normalized: string,
  postId: string | null | undefined,
  timestamps = facebookPostTimestampsFromNormalizedHtml(normalized),
) {
  const id = text(postId);
  const timestamp = id ? timestamps.get(id) || null : null;
  let reactionsCount: number | null = null;
  let commentsCount: number | null = null;
  if (/^\d+$/.test(id)) {
    const identity = new RegExp('"(?:top_level_post_id|video_id)"\\s*:\\s*"' + id + '"', "g");
    for (const match of normalized.matchAll(identity)) {
      const matchIndex = match.index ?? 0;
      // Facebook places the feedback object before the Reel identity in each
      // serialized story. Never look past the identity: the following bytes can
      // already belong to the next Reel and would cross-associate its metrics.
      const nearby = normalized.slice(Math.max(0, matchIndex - 4_000), matchIndex);
      const reactionMatches = [...nearby.matchAll(/"(?:unified_reactors|likers)"\s*:\s*\{\s*"count"\s*:\s*(\d+)/g)];
      const commentMatches = [...nearby.matchAll(/"total_comment_count"\s*:\s*(\d+)/g)];
      const reaction = finiteNumber(reactionMatches.at(-1)?.[1]);
      const comments = finiteNumber(commentMatches.at(-1)?.[1]);
      if (reaction !== null) reactionsCount = reaction;
      if (comments !== null) commentsCount = comments;
      if (timestamp && reactionsCount !== null && commentsCount !== null) break;
    }
  }
  return { timestamp, reactionsCount, commentsCount };
}

export function facebookPostDetailsFromHtml(value: string, postId: string | null | undefined) {
  const normalized = normalizedFacebookHtml(value);
  return facebookPostDetailsFromNormalizedHtml(normalized, postId);
}

export function facebookPostDetailsMapFromHtml(
  value: string,
  postIds: Array<string | null | undefined>,
) {
  const normalized = normalizedFacebookHtml(value);
  const timestamps = facebookPostTimestampsFromNormalizedHtml(normalized);
  const details = new Map<string, ReturnType<typeof facebookPostDetailsFromNormalizedHtml>>();
  for (const postId of new Set(postIds.map(text).filter(id => /^\d+$/.test(id)))) {
    details.set(postId, facebookPostDetailsFromNormalizedHtml(normalized, postId, timestamps));
  }
  return details;
}

export function facebookPageTimelinePluginUrl(value: string) {
  const profileUrl = facebookProfileTabUrl(value, "all");
  if (!profileUrl) return null;
  const params = new URLSearchParams({
    href: profileUrl,
    tabs: "timeline",
    width: "500",
    height: "1000",
    small_header: "false",
    adapt_container_width: "true",
    hide_cover: "false",
    show_facepile: "false",
  });
  return `${FACEBOOK_ORIGIN}/plugins/page.php?${params.toString()}`;
}

export async function extractFacebookPageTimelineCandidates(
  page: Page,
  targetProfileUrl: string,
): Promise<RawCandidate[]> {
  return page.evaluate<RawCandidate[]>(String.raw`((profileUrl) => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const compactCount = (value) => {
      const display = clean(value);
      const match = display.match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*([KMB])?$/i);
      if (!match) return null;
      const numeric = Number(match[1].replace(/,/g, ""));
      const suffix = (match[2] || "").toUpperCase();
      const multiplier = suffix === "K" ? 1000 : suffix === "M" ? 1000000 : suffix === "B" ? 1000000000 : 1;
      return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : null;
    };
    const absolute = (href) => {
      try { return new URL(href, location.href).toString(); } catch { return ""; }
    };
    const postPattern = /\/(?:posts|videos|reel)(?:\/|\?)|story_fbid=|permalink\.php|photo\/?\?|watch\/?\?v=/i;
    const pageText = document.body?.innerText || "";
    const followerDisplay = pageText.match(/([0-9][0-9,]*(?:\.[0-9]+)?\s*[KMB]?)\s+followers?\b/i)?.[1] || null;
    const followerCount = compactCount(followerDisplay);
    return [...document.querySelectorAll('._5pcr,[data-ft*="fbfeed_location"] .userContentWrapper')]
      .slice(0, 25)
      .map(wrapper => {
        const anchors = [...wrapper.querySelectorAll("a[href]")];
        const postAnchor = anchors.find(anchor => {
          const href = anchor.getAttribute("href") || "";
          return postPattern.test(href) && !/[?&](?:comment_id|reply_comment_id)=/i.test(href);
        });
        if (!postAnchor) return null;
        const postUrl = absolute(postAnchor.getAttribute("href") || "");
        const authorAnchor = anchors.find(anchor => {
          const href = absolute(anchor.getAttribute("href") || "");
          const label = clean(anchor.textContent || anchor.getAttribute("title"));
          return label.length > 1
            && /facebook\.com/i.test(href)
            && !postPattern.test(href)
            && !/\/(?:help|stories|hashtag|sharer|plugins)\//i.test(href);
        });
        const messageNode = wrapper.querySelector('[data-testid="post_message"],.userContent');
        const content = clean(messageNode?.textContent) || null;
        const timeNode = wrapper.querySelector("abbr[data-utime],[data-utime],time[datetime]");
        const timestamp = timeNode?.getAttribute("data-utime")
          || timeNode?.getAttribute("datetime")
          || clean(timeNode?.textContent)
          || null;
        const reactionDisplay = clean(wrapper.querySelector(".embeddedLikeButton")?.textContent) || null;
        const commentAnchor = anchors.find(anchor => {
          const href = anchor.getAttribute("href") || "";
          return postPattern.test(href)
            && !/\/sharer\//i.test(href)
            && compactCount(anchor.textContent) !== null;
        });
        const commentsDisplay = clean(commentAnchor?.textContent) || null;
        const images = [...wrapper.querySelectorAll("img[src]")].map(image => ({
          src: image.currentSrc || image.src,
          score: Math.max(image.naturalWidth * image.naturalHeight, image.width * image.height),
        })).filter(image => image.src && !image.src.startsWith("data:") && !/emoji|staticxx|rsrc\.php/i.test(image.src) && image.score >= 2_500)
          .sort((left, right) => right.score - left.score);
        const hasVideo = Boolean(wrapper.querySelector("video,iframe[src*='/plugins/video.php']"));
        return {
          post_url: postUrl,
          author_name: clean(authorAnchor?.textContent) || null,
          // Use the requested profile URL as the owner identity. The plugin can
          // rewrite numeric profile.php URLs to a username, but both represent
          // the same public Page and should not be rejected as an owner mismatch.
          author_url: profileUrl,
          content,
          media_type: /\/reel\//i.test(postUrl) ? "reel" : hasVideo ? "video" : images.length ? "image" : "text",
          thumbnail_url: images[0]?.src || null,
          timestamp,
          reactions_count: compactCount(reactionDisplay),
          reactions_display: reactionDisplay,
          reactions_exact: Boolean(reactionDisplay && !/[KMB]$/i.test(reactionDisplay)),
          comments_count: compactCount(commentsDisplay),
          comments_display: commentsDisplay,
          comments_exact: Boolean(commentsDisplay && !/[KMB]$/i.test(commentsDisplay)),
          follower_count: followerCount,
          follower_count_display: followerDisplay,
          follower_count_exact: Boolean(followerDisplay && !/[KMB]$/i.test(followerDisplay)),
          _source: "visible_page",
        };
      })
      .filter(Boolean);
  })(${JSON.stringify(targetProfileUrl)})`);
}

async function loadFacebookPageTimelineCandidates(page: Page, profileUrl: string) {
  const pluginUrl = facebookPageTimelinePluginUrl(profileUrl);
  if (!pluginUrl) return [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto(pluginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await dismissFacebookPrompts(page);
    await page.locator('._5pcr,[data-ft*="fbfeed_location"] .userContentWrapper').first()
      .waitFor({ state: "attached", timeout: attempt === 1 ? 8_000 : 12_000 })
      .catch(() => undefined);
    const candidates = await extractFacebookPageTimelineCandidates(page, profileUrl);
    if (candidates.length) return candidates;
    if (attempt === 1) await page.waitForTimeout(800);
  }
  const state = await page.evaluate(String.raw`(() => ({
    url: location.href,
    title: document.title,
    bodyLength: document.body?.innerText?.length || 0,
    loginInputs: document.querySelectorAll('input[name="email"],input[name="pass"],input[type="password"]').length,
    unavailable: /(?:content|page) (?:isn't|is not) available|temporarily unavailable/i.test(document.body?.innerText || ""),
  }))()`).catch(() => null);
  console.warn("Facebook public Page timeline exposed no posts", JSON.stringify(state));
  return [];
}

function facebookEmbedUrls(postUrl: string) {
  const href = encodeURIComponent(postUrl);
  const videoFirst = /\/(?:reel|videos|watch)(?:\/|\?|$)/i.test(postUrl);
  const video = `${FACEBOOK_ORIGIN}/plugins/video.php?show_text=true&width=500&href=${href}`;
  const post = `${FACEBOOK_ORIGIN}/plugins/post.php?show_text=true&width=500&href=${href}`;
  return videoFirst ? [video, post] : [post, video];
}

export async function extractFacebookEmbedCandidate(page: Page, postUrl: string): Promise<RawCandidate | null> {
  return page.evaluate<RawCandidate | null>(String.raw`((originalUrl) => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const absolute = (href) => {
      try { return new URL(href, location.href).toString(); } catch { return ""; }
    };
    const compactCount = (value) => {
      const match = clean(value).match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*([KMB])?$/i);
      if (!match) return null;
      const numeric = Number(match[1].replace(/,/g, ""));
      const suffix = (match[2] || "").toUpperCase();
      const multiplier = suffix === "K" ? 1000 : suffix === "M" ? 1000000 : suffix === "B" ? 1000000000 : 1;
      return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : null;
    };
    const metric = (title) => {
      const node = [...document.querySelectorAll("[title]")].filter(visible)
        .find(element => clean(element.getAttribute("title")).toLowerCase() === title.toLowerCase());
      const display = clean(node?.textContent);
      return { count: compactCount(display), display: display || null, exact: Boolean(display && !/[KMB]$/i.test(display)) };
    };
    const anchors = [...document.querySelectorAll("a[href]")].filter(visible);
    const authorAnchor = anchors.find(anchor => {
      const href = absolute(anchor.getAttribute("href") || "");
      const label = clean(anchor.getAttribute("title") || anchor.textContent);
      return label.length > 1
        && /facebook\.com/i.test(href)
        && !/\/plugins\/|\/sharer\/|\/help\/|\/developers\//i.test(href)
        && !/\/(?:posts|videos|reel|watch|photo)(?:\/|\?|$)|story_fbid=|permalink\.php/i.test(href);
    });
    const contentNodes = [...document.querySelectorAll('[data-testid="post_message"],.userContent')]
      .filter(visible)
      .map(node => clean(node.innerText))
      .filter(value => value.length > 0 && value.length < 20000);
    const images = [...document.querySelectorAll("img[src]")].filter(visible).map(image => ({
      src: image.currentSrc || image.src,
      score: Math.max(image.naturalWidth * image.naturalHeight, image.width * image.height),
    })).filter(image => image.src && !image.src.startsWith("data:") && !/emoji|staticxx|rsrc\.php/i.test(image.src) && image.score >= 2500);
    images.sort((left, right) => right.score - left.score);
    const reactions = metric("Like");
    const comments = metric("Comment");
    const hasVideo = Boolean(document.querySelector("video"));
    if (!authorAnchor && !contentNodes.length && reactions.count === null && comments.count === null && !images.length && !hasVideo) return null;
    return {
      post_url: originalUrl,
      author_name: clean(authorAnchor?.getAttribute("title") || authorAnchor?.textContent) || null,
      author_url: authorAnchor ? absolute(authorAnchor.getAttribute("href") || "") : null,
      content: contentNodes.sort((left, right) => right.length - left.length)[0] || null,
      media_type: /\/reel\//i.test(originalUrl) ? "reel" : hasVideo ? "video" : images.length ? "image" : "text",
      thumbnail_url: images[0]?.src || null,
      reactions_count: reactions.count,
      reactions_display: reactions.display,
      reactions_exact: reactions.exact,
      comments_count: comments.count,
      comments_display: comments.display,
      comments_exact: comments.exact,
      _source: "visible_embed",
    };
  })(${JSON.stringify(postUrl)})`);
}

async function loadFacebookEmbedCandidate(page: Page, postUrl: string) {
  for (const embedUrl of facebookEmbedUrls(postUrl)) {
    await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(1_200);
    const candidate = await extractFacebookEmbedCandidate(page, postUrl).catch(() => null);
    if (candidate) {
      const postId = postIdFromUrl(postUrl);
      const timestamps = facebookPostTimestampsFromHtml(await page.content().catch(() => ""));
      return { ...candidate, timestamp: postId ? timestamps.get(postId) || candidate.timestamp : candidate.timestamp };
    }
  }
  return null;
}

async function loadFacebookDirectPostCandidate(page: Page, postUrl: string): Promise<RawCandidate | null> {
  const postId = postIdFromUrl(postUrl);
  const response = await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (!response || response.status() >= 400) return null;
  const [html, title, description, image] = await Promise.all([
    response.text().catch(() => page.content().catch(() => "")),
    page.locator('meta[property="og:title"],meta[name="twitter:title"]').first().getAttribute("content").catch(() => null),
    page.locator('meta[property="og:description"],meta[name="description"],meta[name="twitter:description"]').first().getAttribute("content").catch(() => null),
    page.locator('meta[property="og:image"],meta[name="twitter:image"]').first().getAttribute("content").catch(() => null),
  ]);
  const details = facebookPostDetailsFromHtml(html, postId);
  const authorName = text(title).split("|").at(-1)?.trim() || null;
  if (!details.timestamp && details.reactionsCount === null && details.commentsCount === null
    && !text(description) && !text(image)) return null;
  return {
    post_id: postId,
    post_url: postUrl,
    author_name: authorName,
    content: text(description) || null,
    media_type: /\/reel\//i.test(postUrl) ? "reel" : "video",
    thumbnail_url: text(image) || null,
    timestamp: details.timestamp,
    reactions_count: details.reactionsCount,
    reactions_display: formatMetric(details.reactionsCount),
    reactions_exact: details.reactionsCount !== null,
    comments_count: details.commentsCount,
    comments_display: formatMetric(details.commentsCount),
    comments_exact: details.commentsCount !== null,
    top_comments: [],
    _source: "visible_page",
  };
}

function directObject(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function nestedNumber(object: Record<string, unknown>, paths: string[][]) {
  for (const segments of paths) {
    let current: unknown = object;
    for (const segment of segments) current = directObject(current)?.[segment];
    const value = finiteNumber(current);
    if (value !== null) return value;
  }
  return null;
}

function nestedString(object: Record<string, unknown>, paths: string[][]) {
  for (const segments of paths) {
    let current: unknown = object;
    for (const segment of segments) current = directObject(current)?.[segment];
    const value = text(current);
    if (value) return value;
  }
  return null;
}

export function facebookPayloadCandidates(payload: unknown): RawCandidate[] {
  const results: RawCandidate[] = [];
  const seen = new WeakSet<object>();
  let visited = 0;
  const visit = (value: unknown) => {
    const object = directObject(value);
    if (!object || seen.has(object) || visited >= 30_000) return;
    seen.add(object);
    visited += 1;
    const permalink = nestedString(object, [
      ["permalink_url"], ["permalinkUrl"], ["wwwURL"], ["url"], ["story", "url"], ["shareable", "url"],
    ]);
    const postUrl = permalink && !/[?&](?:comment_id|reply_comment_id)=/i.test(permalink)
      ? canonicalPostUrl(permalink)
      : null;
    const creationTime = object.creation_time ?? object.publish_time ?? object.created_time ?? object.creationTime;
    const message = nestedString(object, [
      ["message", "text"], ["message"], ["story", "message", "text"], ["comet_sections", "content", "story", "message", "text"],
    ]);
    if (postUrl && (creationTime !== undefined || message || object.feedback || object.actors)) {
      const actor = Array.isArray(object.actors) ? directObject(object.actors[0]) : directObject(object.author) || directObject(object.owner) || directObject(object.from);
      const reactions = nestedNumber(object, [["feedback", "reaction_count", "count"], ["feedback", "reaction_count"], ["reaction_count", "count"], ["reaction_count"]]);
      const comments = nestedNumber(object, [
        ["feedback", "comment_rendering_instance", "comments", "total_count"],
        ["feedback", "comment_count", "total_count"],
        ["feedback", "comment_count"],
        ["comments", "total_count"],
        ["comment_count"],
      ]);
      results.push({
        post_id: text(object.post_id || object.id) || postIdFromUrl(postUrl),
        post_url: postUrl,
        author_name: actor ? nestedString(actor, [["name"], ["title", "text"]]) : null,
        author_url: actor ? nestedString(actor, [["url"], ["profile_url"]]) : null,
        content: message,
        timestamp: isoTimestamp(creationTime),
        reactions_count: reactions,
        reactions_display: formatMetric(reactions),
        reactions_exact: reactions !== null,
        comments_count: comments,
        comments_display: formatMetric(comments),
        comments_exact: comments !== null,
        _source: "current_page_payload",
      });
    }
    for (const child of Object.values(object)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(payload);
  return results;
}

function responseCollector() {
  const candidates: RawCandidate[] = [];
  const pending = new Set<Promise<void>>();
  const listener = (response: Response) => {
    if (!/facebook\.com/i.test(response.url())) return;
    const contentType = response.headers()["content-type"] || "";
    if (!/json|javascript|text\/plain/i.test(contentType) && !/graphql|api/i.test(response.url())) return;
    const operation = response.text().then(body => {
      if (!body || body.length > 12_000_000) return;
      const chunks = body.split("\n").map(value => value.trim()).filter(Boolean).slice(0, 100);
      for (const chunk of chunks) {
        try { candidates.push(...facebookPayloadCandidates(JSON.parse(chunk))); } catch { /* Non-JSON browser response. */ }
      }
    }).catch(() => undefined).finally(() => pending.delete(operation));
    pending.add(operation);
  };
  return {
    candidates,
    listener,
    async settle() { await Promise.allSettled([...pending]); },
  };
}

function localChromeCandidates() {
  if (process.platform === "win32") {
    return [
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
      process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    ].filter((value): value is string => Boolean(value));
  }
  if (process.platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

function localChromiumExecutablePath() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH;
  if (configured && existsSync(configured)) return configured;
  for (const candidate of localChromeCandidates()) if (existsSync(candidate)) return candidate;
  return null;
}

async function launchBrowserOnce() {
  const localExecutable = localChromiumExecutablePath();
  if (localExecutable) {
    return chromium.launch({
      args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
      executablePath: localExecutable,
      headless: true,
    });
  }
  const chromiumPack = (await import("@sparticuz/chromium")).default;
  return chromium.launch({
    args: [...chromiumPack.args, "--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
    executablePath: await chromiumPack.executablePath(),
    headless: true,
  });
}

async function launchBrowser() {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await launchBrowserOnce();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 600));
    }
  }
  throw lastError;
}

function recoverableBrowserRuntimeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /browser.*(?:closed|disconnected)|Target page, context or browser has been closed|newContext|ECONNRESET|ERR_CONNECTION|navigation.*timeout/i.test(message);
}

async function createPage(browser: Browser): Promise<FacebookBrowserSession> {
  const options: BrowserContextOptions = {
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
    // A fresh isolated context already prevents session/cache reuse. Facebook
    // serves an unhydrated empty profile document when Cache-Control/Pragma are
    // forced on the top-level navigation, so only negotiate the UI language.
    extraHTTPHeaders: facebookNavigationHeaders(),
  };
  const context = await browser.newContext(options);
  const page = await context.newPage();
  return {
    context,
    page,
    userAgent: await page.evaluate(() => navigator.userAgent),
    sessionMode: "local_chrome",
    close: () => context.close().catch(() => undefined),
  };
}

function browserSessionFactory(browser: Browser): FacebookBrowserSessionFactory {
  return { create: () => createPage(browser) };
}

function visibleProfileInfo(bodyText: string) {
  const followers = metricFromText(bodyText, ["followers?", "people follow this"]);
  const title = bodyText.split("\n").map(value => value.trim()).find(value => value.length > 1 && value.length < 160) || null;
  return { followerCount: followers.count, followerDisplay: followers.display, profileName: title };
}



async function navigateFacebookPage(page: Page, targetUrl: string, timeout = 45_000, pressEscape = true) {
  let navigationError: unknown;
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout });
  } catch (error) {
    navigationError = error;
  }
  await page.waitForTimeout(700).catch(() => undefined);
  await dismissFacebookPrompts(page, pressEscape).catch(() => undefined);
  const snapshot = await accessSnapshot(page).catch(() => null);
  if (navigationError && (!snapshot || classifyFacebookAccess(snapshot) === "unknown")) throw navigationError;
  return snapshot;
}

async function openFacebookProfileTab(page: Page, profileUrl: string, tab: "all" | "reels") {
  const targetUrl = facebookProfileTabUrl(profileUrl, tab);
  if (!targetUrl) throw new Error(`Could not build the Facebook ${tab} tab URL.`);
  return navigateFacebookPage(page, targetUrl);
}

async function scrollFacebookProfile(page: Page) {
  const moved = await page.evaluate<boolean>(String.raw`(() => {
    const candidates = [document.scrollingElement, ...document.querySelectorAll("*")]
      .filter(Boolean)
      .filter(element => {
        if (element.scrollHeight <= element.clientHeight + 80) return false;
        if (element === document.scrollingElement) return true;
        return /auto|scroll/i.test(getComputedStyle(element).overflowY);
      })
      .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight));
    const target = candidates[0];
    if (!target) return false;
    const before = target.scrollTop;
    target.scrollBy({ top: Math.max(900, Math.round(target.clientHeight * 1.35)), behavior: "instant" });
    return target.scrollTop > before;
  })()`).catch(() => false);
  if (!moved) {
    await page.mouse.wheel(0, 1_600).catch(() => undefined);
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 1.25, 900))).catch(() => undefined);
  }
  await page.waitForTimeout(800);
}

async function scrapeAttempt(
  input: FacebookScrapeInput,
  normalized: NormalizedFacebookQuery,
  sessionFactory: FacebookBrowserSessionFactory,
  attempt: number,
): Promise<FacebookScrapeResult> {
  const session = await sessionFactory.create();
  const { page } = session;
  const capturedAt = new Date().toISOString();
  const collector = responseCollector();
  page.on("response", collector.listener);
  const plan = facebookDiscoveryPlan(input, normalized.mode);
  const profileUrl = normalized.mode === "profile"
    ? normalized.targetProfileUrl || normalized.startUrl
    : null;
  const initialUrl = plan.initialTab && profileUrl
    ? facebookProfileTabUrl(profileUrl, plan.initialTab) || normalized.startUrl
    : normalized.startUrl;
  const diagnostics: FacebookScrapeDiagnostics = {
    attempts: attempt,
    browser_session: session.sessionMode,
    scroll_rounds: 0,
    dom_candidates: 0,
    payload_candidates: 0,
    timeline_plugin_candidates: 0,
    reels_grid_candidates: 0,
    unique_candidates: 0,
    accepted_results: 0,
    comments_opened: 0,
    comments_scraped: 0,
    rejected: { missing_url: 0, unexpected_post: 0, owner_mismatch: 0, missing_timestamp: 0, out_of_range: 0 },
    final_url: initialUrl,
    page_title: "",
    discovery_path: [],
    stage_failures: {},
  };
  const recordStageFailure = (stage: keyof NonNullable<FacebookScrapeDiagnostics["stage_failures"]>, error: unknown) => {
    diagnostics.stage_failures![stage] = (error instanceof Error ? error.message : String(error)).slice(0, 240);
  };
  try {
    const initialStage = plan.initialTab || "all";
    diagnostics.discovery_path!.push(initialStage);
    let initialSnapshot: FacebookAccessSnapshot | null = null;
    try {
      initialSnapshot = await navigateFacebookPage(page, initialUrl, 45_000, normalized.mode !== "post");
    } catch (error) {
      recordStageFailure(initialStage === "reels" ? "reels" : "all", error);
      initialSnapshot = await accessSnapshot(page).catch(() => null);
    }
    const initialAccess = initialSnapshot ? classifyFacebookAccess(initialSnapshot) : "unknown";
    diagnostics.page_visibility = await page.evaluate(() => document.visibilityState).catch(() => "unknown");
    diagnostics.final_url = page.url();
    diagnostics.page_title = await page.title().catch(() => "");
    if (normalized.mode !== "post" && initialAccess === "not_found") {
      return { query: normalized.label, results: [], discoveryStatus: initialAccess, diagnostics };
    }
    if (normalized.mode !== "post" && initialAccess === "login_required"
      && (normalized.mode !== "profile" || plan.reelsArePrimary)) {
      return { query: normalized.label, results: [], discoveryStatus: initialAccess, diagnostics };
    }

    const maxResults = normalized.mode === "post" ? 1 : Math.max(1, Math.min(50, Number(input.maxResults) || 10));
    const configuredProfileLimit = Number(process.env.FACEBOOK_PROFILE_DISCOVERY_LIMIT);
    const profileLimit = Number.isFinite(configuredProfileLimit)
      ? Math.max(50, Math.min(500, Math.trunc(configuredProfileLimit)))
      : 300;
    const discoveryTarget = normalized.mode === "profile"
      ? input.collectionMode === "latest"
        ? Math.min(profileLimit, Math.max(30, maxResults * 5))
        : profileLimit
      : Math.min(100, Math.max(20, maxResults * 3));
    const candidateMap = new Map<string, FacebookPost>();
    let stableRounds = 0;
    const configuredTimeout = Number(process.env.FACEBOOK_DISCOVERY_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.max(30_000, Math.min(300_000, configuredTimeout))
      : normalized.mode === "profile" && input.collectionMode === "engagement" ? 180_000 : 75_000;
    const discoveryDeadline = Date.now() + timeoutMs;
    const allPhaseBudget = normalized.mode === "profile"
      ? input.collectionMode === "engagement"
        ? Math.min(60_000, Math.round(timeoutMs * .4))
        : Math.min(30_000, Math.round(timeoutMs * .45))
      : timeoutMs;
    const allDeadline = Math.min(discoveryDeadline, Date.now() + allPhaseBudget);
    const maxRounds = normalized.mode === "post"
      ? 4
      : normalized.mode === "profile"
        ? Math.max(30, Math.min(90, Math.ceil(discoveryTarget / 5) + 15))
        : 30;

    if (plan.collectAll && initialAccess !== "login_required") {
      for (let round = 0; round < maxRounds && Date.now() < allDeadline; round += 1) {
        const before = candidateMap.size;
        const rawDom = await extractFacebookDomCandidates(page).catch(error => {
          recordStageFailure("all", error);
          return [];
        });
        diagnostics.dom_candidates += rawDom.length;
        for (const raw of rawDom) {
          const post = candidateFromRaw(raw, normalized.profileType, capturedAt);
          if (!post) { diagnostics.rejected.missing_url += 1; continue; }
          mergePostIntoMap(candidateMap, post);
        }
        await collector.settle();
        const rawPayloads = collector.candidates.splice(0);
        diagnostics.payload_candidates += rawPayloads.length;
        for (const raw of rawPayloads) {
          const post = candidateFromRaw(raw, normalized.profileType, capturedAt);
          if (!post) { diagnostics.rejected.missing_url += 1; continue; }
          mergePostIntoMap(candidateMap, post);
        }
        diagnostics.scroll_rounds += 1;
        stableRounds = candidateMap.size === before ? stableRounds + 1 : 0;
        const directReady = normalized.mode === "post"
          && candidateMap.size > 0
          && ([...candidateMap.values()].some(post => post.reactions_count !== null || post.comments_count !== null) || round === maxRounds - 1);
        if (normalized.mode === "post" ? directReady : candidateMap.size >= discoveryTarget || stableRounds >= 6) break;
        if (normalized.mode === "post") await page.waitForTimeout(900);
        else await scrollFacebookProfile(page);
      }
      await collector.settle();
    }

    if (normalized.mode === "post" && candidateMap.size === 0) {
      const directUrl = canonicalPostUrl(normalized.startUrl);
      const embedPage = directUrl ? await session.context.newPage().catch(() => null) : null;
      const embedded = directUrl && embedPage
        ? await loadFacebookEmbedCandidate(embedPage, directUrl).catch(() => null)
        : null;
      if (embedPage) await embedPage.close().catch(() => undefined);
      if (embedded) {
        diagnostics.dom_candidates += 1;
        const post = candidateFromRaw(embedded, normalized.profileType, capturedAt);
        if (post) mergePostIntoMap(candidateMap, post);
      }
    }

    const allBodyText = await page.locator("body").innerText().catch(() => "");
    const profile = visibleProfileInfo(allBodyText);
    const titleName = diagnostics.page_title.replace(/\s*\|\s*Facebook.*$/i, "").trim();
    if (titleName && !/^Facebook$/i.test(titleName)) profile.profileName = titleName;
    if (normalized.mode === "post") {
      const embeddedPost = candidateMap.values().next().value as FacebookPost | undefined;
      if (embeddedPost?.author_name) profile.profileName = embeddedPost.author_name;
    }

    if (plan.collectTimelinePlugin && profileUrl) {
      diagnostics.discovery_path!.push("timeline");
      const targetProfileUrl = normalized.targetProfileUrl || normalized.startUrl;
      const timelineCandidates = await loadFacebookPageTimelineCandidates(page, targetProfileUrl).catch(error => {
        recordStageFailure("timeline", error);
        return [];
      });
      diagnostics.timeline_plugin_candidates = timelineCandidates.length;
      diagnostics.dom_candidates += timelineCandidates.length;
      for (const raw of timelineCandidates) {
        const post = candidateFromRaw(raw, normalized.profileType, capturedAt);
        if (!post) { diagnostics.rejected.missing_url += 1; continue; }
        const identity = facebookPostIdentity(post);
        const existing = candidateMap.get(identity);
        // The official public timeline carries an exact data-utime and stable
        // permalink. Keep it as the authoritative base when the normal All page
        // emitted a relative or otherwise ambiguous timestamp for the same post.
        candidateMap.set(identity, existing ? mergePosts(post, existing) : post);
      }
      const exactProfile = timelineCandidates.find(candidate => candidate.follower_count !== null && candidate.follower_count !== undefined);
      if (exactProfile) {
        profile.followerCount = finiteNumber(exactProfile.follower_count);
        profile.followerDisplay = text(exactProfile.follower_count_display) || profile.followerDisplay;
      }
      const timelineName = timelineCandidates.find(candidate => text(candidate.author_name))?.author_name;
      if (timelineName) profile.profileName = timelineName;
    }

    const reelsMap = new Map<string, FacebookPost>();
    const reelPayloadMap = new Map<string, FacebookPost>();
    const directPost = normalized.mode === "post"
      ? [...candidateMap.values()].find(post => post.media_type === "reel" || /\/reel\//i.test(post.post_url))
      : null;
    const reelsProfileUrl = normalized.mode === "profile"
      ? normalized.targetProfileUrl || normalized.startUrl
      : directPost?.author_url || null;
    if (reelsProfileUrl && plan.collectReels) {
      if (!diagnostics.discovery_path!.includes("reels")) diagnostics.discovery_path!.push("reels");
      const alreadyOnReels = plan.initialTab === "reels" && !plan.collectTimelinePlugin;
      if (!alreadyOnReels) {
        await openFacebookProfileTab(page, reelsProfileUrl, "reels").catch(error => {
          recordStageFailure("reels", error);
        });
      }
      const reelsTarget = normalized.mode === "post"
        ? 100
        : input.collectionMode === "latest"
        ? Math.min(profileLimit, Math.max(40, maxResults * 6))
        : profileLimit;
      const reelsRounds = Math.max(30, Math.min(100, Math.ceil(reelsTarget / 5) + 15));
      const reelsDeadline = discoveryDeadline;
      let staleReelsRounds = 0;
      for (let round = 0; round < reelsRounds && Date.now() < reelsDeadline; round += 1) {
        const before = reelsMap.size;
        const rawGrid = await extractFacebookReelsGridCandidates(page).catch(error => {
          recordStageFailure("reels", error);
          return [];
        });
        const gridHtml = await page.content().catch(() => "");
        const gridDetails = facebookPostDetailsMapFromHtml(
          gridHtml,
          rawGrid.map(raw => postIdFromUrl(text(raw.post_url))),
        );
        diagnostics.reels_grid_candidates += rawGrid.length;
        await collector.settle();
        const rawPayloads = collector.candidates.splice(0);
        diagnostics.payload_candidates += rawPayloads.length;
        for (const raw of rawPayloads) {
          const payloadPost = candidateFromRaw(raw, normalized.profileType, capturedAt);
          if (!payloadPost) continue;
          mergePostIntoMap(reelPayloadMap, payloadPost);
        }
        for (const raw of rawGrid) {
          const gridPostId = postIdFromUrl(text(raw.post_url));
          const details = gridPostId ? gridDetails.get(gridPostId) : null;
          if (!raw.timestamp && details?.timestamp) raw.timestamp = details.timestamp;
          if (details?.reactionsCount !== null && details?.reactionsCount !== undefined) {
            raw.reactions_count = details.reactionsCount;
            raw.reactions_display = String(details.reactionsCount);
            raw.reactions_exact = true;
          }
          if (details?.commentsCount !== null && details?.commentsCount !== undefined) {
            raw.comments_count = details.commentsCount;
            raw.comments_display = String(details.commentsCount);
            raw.comments_exact = true;
          }
          const visibleReel = candidateFromRaw(raw, normalized.profileType, capturedAt);
          if (!visibleReel) { diagnostics.rejected.missing_url += 1; continue; }
          const identity = facebookPostIdentity(visibleReel);
          const payloadPost = reelPayloadMap.get(identity)
            || [...reelPayloadMap.values()].find(post => Boolean(visibleReel.post_id && post.post_id === visibleReel.post_id));
          const reel = {
            ...(payloadPost ? mergePosts(payloadPost, visibleReel) : visibleReel),
            author_name: payloadPost?.author_name || visibleReel.author_name || profile.profileName,
            author_url: payloadPost?.author_url || visibleReel.author_url || profileUrl,
          };
          mergePostIntoMap(reelsMap, reel);
          let matchingKey = candidateMap.has(identity) ? identity : null;
          if (!matchingKey) {
            const reelThumbnail = thumbnailIdentity(reel.thumbnail_url);
            if (reelThumbnail) {
              matchingKey = [...candidateMap.entries()].find(([, post]) => thumbnailIdentity(post.thumbnail_url) === reelThumbnail)?.[0] || null;
            }
          }
          if (matchingKey) {
            const matchingPost = candidateMap.get(matchingKey)!;
            const combined = mergePosts(matchingPost, reel);
            candidateMap.set(matchingKey, combined);
            reelsMap.set(identity, combined);
          }
        }
        diagnostics.scroll_rounds += 1;
        staleReelsRounds = reelsMap.size === before ? staleReelsRounds + 1 : 0;
        const directMatched = directPost
          ? candidateMap.get(facebookPostIdentity(directPost))?.views_count !== null
          : false;
        if (directMatched || reelsMap.size >= reelsTarget || staleReelsRounds >= 6) break;
        await scrollFacebookProfile(page);
      }
      diagnostics.final_url = page.url() || diagnostics.final_url;
    }

    if (normalized.mode === "profile"
      && (input.collectionMode === "latest" || input.collectionMode === "range")) {
      const targetProfileUrl = normalized.targetProfileUrl || normalized.startUrl;
      for (const reel of reelsMap.values()) {
        if (timestampMs(reel) === null) continue;
        const identity = facebookPostIdentity(reel);
        const ownedReel = {
          ...reel,
          author_name: reel.author_name || profile.profileName,
          author_url: reel.author_url || targetProfileUrl,
        };
        const existing = candidateMap.get(identity);
        candidateMap.set(identity, existing ? mergePosts(ownedReel, existing) : ownedReel);
      }
    }

    diagnostics.unique_candidates = new Set([...candidateMap.keys(), ...reelsMap.keys()]).size;
    const range = scrapeRange(input);
    const accepted: FacebookPost[] = [];
    const directTarget = normalized.mode === "post" ? canonicalPostUrl(page.url()) || canonicalPostUrl(normalized.startUrl) : null;
    for (const post of candidateMap.values()) {
      if (directTarget && post.post_url !== directTarget && (!post.post_id || post.post_id !== postIdFromUrl(directTarget))) {
        diagnostics.rejected.unexpected_post += 1;
        continue;
      }
      if (normalized.mode === "profile" && !candidateMatchesProfile(post, normalized.targetProfileUrl)) {
        diagnostics.rejected.owner_mismatch += 1;
        continue;
      }
      const time = timestampMs(post);
      if (normalized.mode !== "post" && time === null) {
        diagnostics.rejected.missing_timestamp += 1;
        continue;
      }
      if (range.active && time === null) { diagnostics.rejected.missing_timestamp += 1; continue; }
      if (range.active && time !== null && (time < range.start || time > range.end)) {
        diagnostics.rejected.out_of_range += 1;
        continue;
      }
      accepted.push(post);
    }
    accepted.sort((left, right) => {
      const difference = (timestampMs(right) || 0) - (timestampMs(left) || 0);
      return range.direction === "ascending" ? -difference : difference;
    });

    const discoveredReels = [...reelsMap.values()];
    const analysisBasePosts = plan.reelsArePrimary ? discoveredReels : accepted;
    const preliminaryResults = selectFacebookPrimaryResults(
      accepted,
      discoveredReels,
      input.collectionMode || "latest",
      normalized.mode,
      maxResults,
    );
    // Most Reacted and Most Discussed are global rankings across the scanned
    // Reels set. Enrich every Reel whose exact public feedback metrics were not
    // present in the grid payload before building those rankings. The current
    // Most Viewed winners are included as well so their dates/content remain
    // complete even when their grid metrics were already exact.
    const requestedDetailTargets = input.collectionMode === "engagement" && normalized.mode === "profile"
      ? [
          ...analysisBasePosts.filter(post => (
            !post.reactions_exact
            || !post.comments_exact
            || post.timestamp === null
          )),
          ...preliminaryResults,
        ]
      : preliminaryResults;
    const enriched = new Map<string, FacebookPost>();
    const detailsTargets = [...new Map(requestedDetailTargets.map(post => [facebookPostIdentity(post), post])).values()];
    if (detailsTargets.length) {
      diagnostics.discovery_path!.push("details");
      const detailPages = (await Promise.all(Array.from({ length: Math.min(2, detailsTargets.length) }, async () => {
        const detailPage = await session.context.newPage().catch(() => null);
        if (detailPage) {
          await detailPage.route("**/*", route => {
            const resourceType = route.request().resourceType();
            return ["image", "media", "font"].includes(resourceType) ? route.abort() : route.continue();
          }).catch(() => undefined);
        }
        return detailPage;
      }))).filter((detailPage): detailPage is Page => Boolean(detailPage));
      if (detailPages.length) {
        let cursor = 0;
        try {
          await Promise.all(detailPages.map(async detailsPage => {
            while (cursor < detailsTargets.length) {
              const post = detailsTargets[cursor++];
              let raw = await loadFacebookDirectPostCandidate(detailsPage, post.post_url).catch(error => {
                recordStageFailure("details", error);
                return null;
              });
              let details = raw ? candidateFromRaw(raw, post.profile_type || normalized.profileType, capturedAt) : null;
              if (!details || details.timestamp === null || details.reactions_count === null || details.comments_count === null || !details.content) {
                raw = await loadFacebookEmbedCandidate(detailsPage, post.post_url).catch(error => {
                  recordStageFailure("details", error);
                  return null;
                });
                const embedded = raw ? candidateFromRaw(raw, post.profile_type || normalized.profileType, capturedAt) : null;
                if (embedded) details = details ? mergePosts(details, embedded) : embedded;
              }
              if (details) enriched.set(facebookPostIdentity(post), mergePosts(details, post));
            }
          }));
        } finally {
          await Promise.all(detailPages.map(detailsPage => detailsPage.close().catch(() => undefined)));
        }
      } else {
        recordStageFailure("details", new Error("Could not open the optional Facebook details page."));
      }
    }
    const enrichedPost = (post: FacebookPost) => enriched.get(facebookPostIdentity(post)) || post;
    const analysisPosts = analysisBasePosts.map(enrichedPost);
    const analyzedReels = discoveredReels.map(enrichedPost);
    const results = preliminaryResults.map(enrichedPost).map(post => ({
      ...post,
      follower_count: post.follower_count ?? profile.followerCount,
      follower_count_display: post.follower_count_display ?? profile.followerDisplay,
      follower_count_exact: post.follower_count_exact || false,
    }));
    diagnostics.accepted_results = results.length;
    const finalSnapshot = await accessSnapshot(page).catch(() => null);
    const finalAccess = finalSnapshot ? classifyFacebookAccess(finalSnapshot) : "unknown";
    const discoveryStatus: FacebookDiscoveryStatus = results.length
      ? (!plan.reelsArePrimary && (results.some(post => timestampMs(post) === null)
          || (normalized.mode !== "post" && results.length < maxResults && diagnostics.rejected.missing_timestamp > 0)
          || (normalized.mode === "keyword" && results.length < maxResults)))
        ? "partial"
        : "ok"
      : analyzedReels.length
        ? "partial"
      : finalAccess === "login_required" || finalAccess === "not_found"
        ? finalAccess
        : "temporarily_unavailable";
    const analysis = input.collectionMode === "engagement" && normalized.mode === "profile"
      ? buildFacebookProfileAnalysis(analysisPosts, normalized.profileType, normalized.targetProfileUrl || null, profile.profileName, profile.followerCount, profile.followerDisplay, capturedAt, analyzedReels)
      : undefined;
    return { query: normalized.label, results, analysis, discoveryStatus, diagnostics };
  } finally {
    page.off("response", collector.listener);
    await session.close();
  }
}

export async function runFacebookScrapeWithSessionFactory(
  input: FacebookScrapeInput,
  sessionFactory: FacebookBrowserSessionFactory,
) {
  const normalized = normalizeFacebookQuery(input);
  if (input.collectionMode === "engagement" && normalized.mode !== "profile") {
    throw new Error("Profile analysis is available only for a Facebook Page or public profile.");
  }
  let last: FacebookScrapeResult | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptQuery = attempt === 2 && normalized.fallbackStartUrl
      ? { ...normalized, startUrl: normalized.fallbackStartUrl, fallbackStartUrl: undefined }
      : normalized;
    try {
      last = await scrapeAttempt(input, attemptQuery, sessionFactory, attempt);
    } catch (error) {
      lastError = error;
      if (attempt === 1 && normalized.fallbackStartUrl) continue;
      throw error;
    }
    if (last.results.length || last.analysis?.top_viewed.length) return last;
    if (last.discoveryStatus === "not_found" && !(attempt === 1 && normalized.fallbackStartUrl)) return last;
  }
  if (last) return last;
  throw lastError;
}

export async function runFacebookScrape(
  input: FacebookScrapeInput,
  runtime: { signal?: AbortSignal; onBrowserReady?: () => void } = {},
) {
  let lastError: unknown;
  for (let runtimeAttempt = 1; runtimeAttempt <= 2; runtimeAttempt += 1) {
    const browser = await launchBrowser();
    const closeOnAbort = () => { void browser.close().catch(() => undefined); };
    runtime.signal?.addEventListener("abort", closeOnAbort, { once: true });
    try {
      if (runtime.signal?.aborted) throw new Error("Facebook scraping was cancelled.");
      runtime.onBrowserReady?.();
      return await runFacebookScrapeWithSessionFactory(input, browserSessionFactory(browser));
    } catch (error) {
      lastError = error;
      if (runtime.signal?.aborted || runtimeAttempt >= 2 || !recoverableBrowserRuntimeError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 600));
    } finally {
      runtime.signal?.removeEventListener("abort", closeOnAbort);
      await browser.close().catch(() => undefined);
    }
  }
  throw lastError;
}

export async function getFacebookScraperInfo() {
  return { mode: "public-browser", accountRequired: false, apiTokens: false, sessions: [] };
}
