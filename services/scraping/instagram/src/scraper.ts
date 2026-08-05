import chromiumPack from "@sparticuz/chromium";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type Response } from "playwright-core";

export type InstagramScrapeInput = {
  query: string;
  maxResults?: number;
  collectionMode?: "latest" | "range" | "engagement";
  recentDays?: number;
  onlyPostsNewerThan?: string;
  autoExpandDays?: boolean | string;
  maxAutoExpandDays?: number;
  rangeType?: "date" | "month" | "year";
  rangeFrom?: string;
  rangeTo?: string;
  timezoneOffsetMinutes?: number;
  sortBy?: "recent" | "engagement";
};

export type InstagramPost = {
  username: string | null;
  display_name: string | null;
  profile_url?: string | null;
  post_url: string;
  thumbnail_url: string | null;
  comments_count: number | null;
  comments_hidden: boolean;
  likes: number | null;
  likes_hidden: boolean;
  views: number | null;
  views_display: string | null;
  follower_count: number | null;
  follower_count_display: string | null;
  engagement_score: number | null;
  engagement_rate: number | null;
  top_comments: { username: string; text: string; timestamp?: string; time?: string }[];
  timestamp: string | null;
  caption: string | null;
};

export type InstagramProfileAnalysis = {
  username: string | null;
  display_name: string | null;
  profile_url: string | null;
  follower_count: number | null;
  follower_count_display: string | null;
  captured_at: string;
  analyzed_posts: number;
  averages: {
    likes: number | null;
    comments: number | null;
    views: number | null;
  };
  engagement_rate: number | null;
  posting_frequency: {
    posts_last_30_days: number;
    posts_per_week: number;
  };
  top_watched: InstagramPost[];
  top_liked: InstagramPost[];
  top_discussed: InstagramPost[];
  patterns: {
    formats: { reels: number; posts: number };
    hashtags: { label: string; count: number }[];
    keywords: { label: string; count: number }[];
    posting_days: { label: string; count: number }[];
    posting_hours: { label: string; count: number }[];
  };
  accuracy: {
    source: string;
    followers: string;
    views: string;
    missing_metrics: string;
  };
};

type NormalizedQuery = {
  mode: "profile" | "hashtag" | "post" | "keyword";
  label: string;
  startUrl: string;
  postUrl?: string;
  tag?: string;
  username?: string;
};

type Candidate = Partial<InstagramPost> & {
  _handle?: string | null;
  _owner_id?: string | null;
  _reels_id?: string | null;
  _source?: string | null;
  _source_rank?: number | null;
  _views_verified?: boolean;
};

type ScrapeResult = {
  query: string;
  results: InstagramPost[];
  analysis?: InstagramProfileAnalysis;
};

type RawPageCandidate = {
  href?: string | null;
  code?: string | null;
  username?: string | null;
  displayName?: string | null;
  mediaType?: string | number | null;
  productType?: string | null;
  timestamp?: string | number | null;
  likes?: string | number | null;
  commentsCount?: string | number | null;
  views?: string | number | null;
  viewsVerified?: boolean;
  thumbnail?: string | null;
  caption?: string | null;
  rank?: number | null;
};

type PublicProfileBootstrap = {
  ok: boolean;
  status?: number;
  userId?: string | null;
  reelsId?: string | null;
  username?: string | null;
  displayName?: string | null;
  followerCount?: number | null;
  items?: RawPageCandidate[];
};

type PublicProfileFeedPage = {
  ok: boolean;
  status?: number;
  moreAvailable?: boolean;
  nextMaxId?: string | null;
  items?: RawPageCandidate[];
};

type PageSnapshot = {
  title: string;
  description: string;
  ogImage: string | null;
  canonical: string | null;
  time: string | null;
  jsonLd: Record<string, unknown>[];
  profileHref: string | null;
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const parentServiceRoot = path.resolve(moduleDir, "..");
const repoServiceRoot = path.resolve(moduleDir, "..", "..");
const serviceRoot = existsSync(path.join(parentServiceRoot, "account_config")) || !existsSync(path.join(repoServiceRoot, "account_config"))
  ? parentServiceRoot
  : repoServiceRoot;
const instagramHost = "https://www.instagram.com";
const postSelector = 'a[href*="/p/"], a[href*="/reel/"]';
const shortcodeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const instagramEpochMilliseconds = 1_314_220_021_721;
const defaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function compactNumber(value: string | null | undefined) {
  if (!value) return null;
  const match = value.replace(/,/g, "").trim().match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const suffix = (match[2] || "").toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Math.round(amount * multiplier);
}

function parseMetric(description: string, label: "likes" | "comments" | "followers") {
  const patterns = {
    likes: /([\d,.]+(?:\.\d+)?\s*[KMB]?)\s+likes?/i,
    comments: /([\d,.]+(?:\.\d+)?\s*[KMB]?)\s+comments?/i,
    followers: /([\d,.]+(?:\.\d+)?\s*[KMB]?)\s+followers?/i
  };
  return compactNumber(description.match(patterns[label])?.[1]);
}

function normalizeQuery(query: string): NormalizedQuery {
  const raw = query.trim();
  if (!raw) throw new Error("Enter an Instagram username, hashtag, or post URL.");

  if (/^(https?:\/\/|www\.|instagram\.com\/)/i.test(raw)) {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw.replace(/^www\./i, "www.")}`);
    const cleanPath = url.pathname.replace(/\/+$/, "");
    const postMatch = cleanPath.match(/^\/(?:p|reel)\/([^/]+)/i);
    if (postMatch) {
      const postUrl = `${instagramHost}${cleanPath}/`;
      return { mode: "post", label: postUrl, startUrl: postUrl, postUrl };
    }
    const profileMatch = cleanPath.match(/^\/([A-Za-z0-9._]+)$/);
    if (profileMatch) {
      const username = profileMatch[1];
      return { mode: "profile", label: `@${username}`, startUrl: `${instagramHost}/${username}/`, username };
    }
    const tagMatch = cleanPath.match(/^\/explore\/tags\/([^/]+)/i);
    if (tagMatch) {
      const tag = decodeURIComponent(tagMatch[1]).replace(/[^A-Za-z0-9_]/g, "");
      if (tag) return { mode: "hashtag", label: `#${tag}`, startUrl: `${instagramHost}/explore/tags/${encodeURIComponent(tag)}/`, tag };
    }
    throw new Error("Use an Instagram profile, hashtag, post, or reel URL.");
  }

  if (raw.startsWith("#")) {
    const tag = raw.replace(/^#+/, "").replace(/[^A-Za-z0-9_]/g, "");
    if (!tag) throw new Error("Enter a hashtag.");
    return { mode: "hashtag", label: `#${tag}`, startUrl: `${instagramHost}/explore/tags/${encodeURIComponent(tag)}/`, tag };
  }

  const username = raw.replace(/^@+/, "").trim();
  if (/^[A-Za-z0-9._]+$/.test(username)) {
    return { mode: "profile", label: `@${username}`, startUrl: `${instagramHost}/${username}/`, username };
  }

  const encodedKeyword = new URLSearchParams({ q: raw }).toString().replace(/^q=/, "");
  return {
    mode: "keyword",
    label: raw,
    startUrl: `${instagramHost}/explore/search/keyword/?q=${encodedKeyword}&hl=en&latest=1&sort=latest`
  };
}

function localChromeCandidates() {
  if (process.platform === "win32") {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"]
    ].filter(Boolean) as string[];
    return roots.flatMap((root) => [
      path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(root, "Microsoft", "Edge", "Application", "msedge.exe")
    ]);
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ];
  }

  return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

async function chromiumExecutablePath() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH;
  if (configured && existsSync(configured)) return configured;

  for (const candidate of localChromeCandidates()) {
    if (existsSync(candidate)) return candidate;
  }

  return chromiumPack.executablePath();
}

export async function getInstagramScraperInfo() {
  return {
    mode: "public-browser",
    count: 0,
    expiryBufferDays: 0,
    sessions: []
  };
}

async function launchBrowser() {
  const executablePath = await chromiumExecutablePath();
  return chromium.launch({
    args: [
      ...chromiumPack.args,
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-sandbox"
    ],
    executablePath,
    headless: true
  });
}

async function createPage(browser: Browser) {
  const contextOptions: BrowserContextOptions = {
    locale: "en-US",
    userAgent: defaultUserAgent,
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" }
  };
  const context = await browser.newContext(contextOptions);
  return { context, page: await context.newPage() };
}

async function dismissInstagramPrompts(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    const clicked = await page.evaluate<boolean>(`
      (() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const labels = [
          "close",
          "not now",
          "decline optional cookies",
          "allow all cookies",
          "only allow essential cookies"
        ];
        const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter((element) => visible(element));
        const svgClose = Array.from(document.querySelectorAll('svg[aria-label="Close"]'))
          .map((svg) => svg.closest('button, [role="button"]'))
          .filter(Boolean);
        for (const element of [...svgClose, ...candidates]) {
          const text = ((element.getAttribute("aria-label") || "") + " " + (element.textContent || "")).trim().toLowerCase();
          if (!labels.some((label) => text.includes(label))) continue;
          element.click();
          return true;
        }
        return false;
      })()
    `).catch(() => false);
    if (!clicked) break;
    await sleep(650);
  }
}

async function gotoPublicPage(page: Page, url: string, timeout = 45_000) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await sleep(800);
  await dismissInstagramPrompts(page);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R | null>
) {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  }));
  return results;
}

async function mapUntilValidCount<T, R>(
  items: T[],
  concurrency: number,
  targetCount: number,
  mapper: (item: T, index: number) => Promise<R | null>
) {
  const results: R[] = [];
  const batchSize = Math.max(1, concurrency);
  for (let offset = 0; offset < items.length && results.length < targetCount; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize);
    const mapped = await mapWithConcurrency(batch, concurrency, (item, index) => mapper(item, offset + index));
    for (const item of mapped) {
      if (item !== null) results.push(item);
      if (results.length >= targetCount) break;
    }
  }
  return results;
}

function splitInputs(query: string) {
  return (query || "").split(/[\n,]+/).map((part) => part.trim()).filter(Boolean);
}

function normalizeInstagramUrlText(value: string) {
  const text = value.trim();
  return /^(www\.)?instagram\.com\//i.test(text) ? `https://${text}` : text;
}

function normalizeHashtag(value?: string | null) {
  if (!value) return null;
  const text = value.trim();
  if (text.startsWith("#")) {
    const tag = text.slice(1).replace(/[^A-Za-z0-9_]/g, "");
    return tag || null;
  }

  try {
    const parsed = new URL(normalizeInstagramUrlText(text));
    if (parsed.hostname.includes("instagram.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 3 && parts[0].toLowerCase() === "explore" && parts[1].toLowerCase() === "tags") {
        const tag = parts[2].replace(/[^A-Za-z0-9_]/g, "");
        return tag || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function isInstagramHandle(value?: string | null) {
  return Boolean(value && /^[A-Za-z0-9._]{1,30}$/.test(value));
}

function normalizeProfileUrl(value?: string | null) {
  if (!value) return null;
  const text = value.trim();
  if (text.startsWith("#")) return null;

  if (text.startsWith("@")) {
    const handle = text.slice(1).replace(/[^A-Za-z0-9._]/g, "");
    return handle ? `${instagramHost}/${handle}/` : null;
  }

  const reservedPaths = new Set(["explore", "accounts", "p", "reel", "reels", "stories", "tv"]);
  try {
    const parsed = new URL(normalizeInstagramUrlText(text));
    if (parsed.hostname.includes("instagram.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length === 1 && !reservedPaths.has(parts[0].toLowerCase())) return `${instagramHost}/${parts[0]}/`;
      return null;
    }
  } catch {
    // Fall through to bare handle matching.
  }

  if (isInstagramHandle(text) && !reservedPaths.has(text.toLowerCase())) return `${instagramHost}/${text}/`;
  return null;
}

function handleFromProfileUrl(value?: string | null) {
  const profileUrl = normalizeProfileUrl(value);
  return profileUrl?.match(/instagram\.com\/([^/]+)\//i)?.[1] || null;
}

function normalizePostUrl(href?: string | null) {
  if (!href) return null;
  let cleanHref = href.split("?")[0].split("#")[0];
  if (!cleanHref.includes("/p/") && !cleanHref.includes("/reel/")) return null;
  if (cleanHref.startsWith("/")) cleanHref = `${instagramHost}${cleanHref}`;
  else if (/^(www\.)?instagram\.com\//i.test(cleanHref)) cleanHref = `https://${cleanHref}`;
  try {
    const parsed = new URL(cleanHref);
    const match = parsed.pathname.match(/\/(p|reel)\/([^/?#]+)/i);
    if (!match) return null;
    return `${instagramHost}/${match[1].toLowerCase()}/${match[2]}/`;
  } catch {
    return null;
  }
}

function postIdentity(postUrl: string) {
  return postUrl.match(/\/(?:p|reel)\/([^/?#]+)\//i)?.[1] || postUrl;
}

function mediaIdFromPostUrl(postUrl: string) {
  const shortcode = postIdentity(postUrl);
  if (!/^[A-Za-z0-9_-]{6,}$/.test(shortcode)) return null;
  let value = 0n;
  for (const char of shortcode) {
    const index = shortcodeAlphabet.indexOf(char);
    if (index === -1) return null;
    value = value * 64n + BigInt(index);
  }
  return value;
}

function postOrderValue(postUrl: string) {
  const mediaId = mediaIdFromPostUrl(postUrl);
  return mediaId === null ? 0 : Number(mediaId >> 10n);
}

function timestampFromPostUrl(postUrl: string) {
  const mediaId = mediaIdFromPostUrl(postUrl);
  if (mediaId === null) return null;
  const timestamp = Number(mediaId >> 23n) + instagramEpochMilliseconds;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseCount(text?: string | null) {
  if (!text) return null;
  const match = text.trim().match(/([\d,.]+(?:\.\d+)?)\s*([KMB]?)/i);
  if (!match) return null;
  let number = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  const suffix = (match[2] || "").toUpperCase();
  if (suffix === "B") number *= 1_000_000_000;
  else if (suffix === "M") number *= 1_000_000;
  else if (suffix === "K") number *= 1_000;
  return Math.trunc(number);
}

function timestampValue(timestamp?: string | null) {
  if (!timestamp) return 0;
  const value = new Date(timestamp.replace("Z", "+00:00")).getTime();
  return Number.isFinite(value) ? value : 0;
}

type ScrapeRange = {
  start: Date;
  end: Date;
  strict: boolean;
  direction: "ascending" | "descending";
  collectionMode: "latest" | "range" | "engagement";
};

function parseRangePart(value: string, type: "date" | "month" | "year") {
  const patterns = {
    date: /^(\d{4})-(\d{2})-(\d{2})$/,
    month: /^(\d{4})-(\d{2})$/,
    year: /^(\d{4})$/
  };
  const match = value.match(patterns[type]);
  if (!match) return null;

  const year = Number(match[1]);
  const month = type === "year" ? 1 : Number(match[2]);
  const day = type === "date" ? Number(match[3]) : 1;
  if (year < 2010 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function explicitScrapeRange(input: InstagramScrapeInput): ScrapeRange | null {
  if (!input.rangeFrom && !input.rangeTo) return null;
  const type = input.rangeType || "date";
  const from = parseRangePart(String(input.rangeFrom || ""), type);
  const to = parseRangePart(String(input.rangeTo || ""), type);
  if (!from || !to) throw new Error(`Enter a valid ${type} range.`);

  const offset = Math.max(-840, Math.min(840, Number(input.timezoneOffsetMinutes) || 0));
  const localBoundary = (part: typeof from, isEnd: boolean) => {
    let year = part.year;
    let monthIndex = part.month - 1;
    let day = part.day;
    if (isEnd) {
      if (type === "date") day += 1;
      else if (type === "month") monthIndex += 1;
      else year += 1;
    }
    return new Date(Date.UTC(year, monthIndex, day) + offset * 60_000 - (isEnd ? 1 : 0));
  };

  const fromStart = localBoundary(from, false);
  const fromEnd = localBoundary(from, true);
  const toStart = localBoundary(to, false);
  const toEnd = localBoundary(to, true);
  const direction = fromStart.getTime() <= toStart.getTime() ? "ascending" : "descending";
  return {
    start: direction === "ascending" ? fromStart : toStart,
    end: direction === "ascending" ? toEnd : fromEnd,
    strict: true,
    direction,
    collectionMode: "range"
  };
}

function scrapeRangeFromInput(input: InstagramScrapeInput): ScrapeRange {
  const collectionMode = input.collectionMode || (input.rangeFrom || input.rangeTo ? "range" : "latest");
  const explicit = explicitScrapeRange(input);
  if (collectionMode === "range") {
    if (!explicit) throw new Error("Choose a range start and end.");
    return explicit;
  }
  if (collectionMode === "latest" || collectionMode === "engagement") {
    return {
      start: new Date(instagramEpochMilliseconds),
      end: new Date(),
      strict: true,
      direction: "descending",
      collectionMode
    };
  }
  const preferred = newerThanCutoff(input);
  return {
    start: oldestAllowedCutoff(input, preferred),
    end: new Date(),
    strict: false,
    direction: "descending",
    collectionMode: "latest"
  };
}

function timestampInRange(timestamp: string | null | undefined, range: ScrapeRange) {
  const value = timestampValue(timestamp);
  if (!value) return !range.strict;
  return value >= range.start.getTime() && value <= range.end.getTime();
}

function engagementValues(post: Pick<
  InstagramPost,
  "likes" | "likes_hidden" | "comments_count" | "comments_hidden" | "views" | "follower_count"
>) {
  if (post.views === null) return { score: null, rate: null };
  const views = post.views;
  const metricsVisible = !post.likes_hidden && !post.comments_hidden &&
    post.likes !== null && post.comments_count !== null;
  return {
    score: views,
    rate: metricsVisible && views > 0
      ? Math.round(((post.likes! + post.comments_count!) / views) * 10_000) / 100
      : null
  };
}

function roundedAverage(values: (number | null | undefined)[]) {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!usable.length) return null;
  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}

function rankedPosts(results: InstagramPost[], metric: "views" | "likes" | "comments_count", limit: number) {
  return results
    .filter((post) => post[metric] !== null)
    .slice()
    .sort((a, b) => (b[metric] ?? -1) - (a[metric] ?? -1) || timestampValue(b.timestamp) - timestampValue(a.timestamp))
    .slice(0, limit);
}

function topCountEntries(counts: Map<string, number>, limit: number) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function buildProfileAnalysis(results: InstagramPost[], maxResults: number, timezoneOffsetMinutes = 0): InstagramProfileAnalysis {
  const firstProfile = results.find((post) => post.username || post.profile_url) || null;
  const followerCount = results.find((post) => post.follower_count !== null)?.follower_count ?? null;
  const followerCountDisplay = results.find((post) => post.follower_count_display)?.follower_count_display ?? null;
  const hashtags = new Map<string, number>();
  const keywords = new Map<string, number>();
  const postingDays = new Map<string, number>();
  const postingHours = new Map<string, number>();
  const stopWords = new Set([
    "about", "after", "again", "also", "and", "are", "but", "for", "from", "have", "into", "just",
    "more", "not", "our", "that", "the", "their", "this", "was", "were", "what", "when", "where",
    "which", "will", "with", "you", "your"
  ]);
  const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let reels = 0;
  let posts = 0;

  for (const post of results) {
    if (/\/reel\//i.test(post.post_url)) reels += 1;
    else posts += 1;

    const caption = post.caption || "";
    for (const match of caption.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
      const label = `#${match[1].toLowerCase()}`;
      hashtags.set(label, (hashtags.get(label) || 0) + 1);
    }
    const keywordText = caption
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/#[\p{L}\p{N}_]+/gu, " ")
      .toLowerCase();
    for (const word of keywordText.match(/[\p{L}\p{N}_]{3,}/gu) || []) {
      if (stopWords.has(word) || /^\d+$/.test(word)) continue;
      keywords.set(word, (keywords.get(word) || 0) + 1);
    }

    if (post.timestamp) {
      const timestamp = timestampValue(post.timestamp);
      if (timestamp) {
        const localDate = new Date(timestamp - timezoneOffsetMinutes * 60_000);
        const day = dayLabels[localDate.getUTCDay()];
        const hour = localDate.getUTCHours();
        const hourLabel = hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
        postingDays.set(day, (postingDays.get(day) || 0) + 1);
        postingHours.set(hourLabel, (postingHours.get(hourLabel) || 0) + 1);
      }
    }
  }

  const now = Date.now();
  const postsLast30Days = results.filter((post) => {
    const timestamp = timestampValue(post.timestamp);
    return timestamp > 0 && timestamp >= now - 30 * 86_400_000 && timestamp <= now;
  }).length;
  const engagementRates = followerCount && followerCount > 0
    ? results
      .filter((post) => !post.likes_hidden && !post.comments_hidden && post.likes !== null && post.comments_count !== null)
      .map((post) => ((post.likes! + post.comments_count!) / followerCount) * 100)
    : [];
  const verifiedViewPosts = results.filter((post) => post.views !== null && post.views !== undefined).length;

  return {
    username: firstProfile?.username ?? null,
    display_name: firstProfile?.display_name ?? firstProfile?.username ?? null,
    profile_url: firstProfile?.profile_url ?? null,
    follower_count: followerCount,
    follower_count_display: followerCountDisplay,
    captured_at: new Date().toISOString(),
    analyzed_posts: results.length,
    averages: {
      likes: roundedAverage(results.map((post) => post.likes)),
      comments: roundedAverage(results.map((post) => post.comments_count)),
      views: roundedAverage(results.map((post) => post.views))
    },
    engagement_rate: engagementRates.length
      ? Math.round((engagementRates.reduce((sum, value) => sum + value, 0) / engagementRates.length) * 100) / 100
      : null,
    posting_frequency: {
      posts_last_30_days: postsLast30Days,
      posts_per_week: Math.round((postsLast30Days / 30) * 700) / 100
    },
    top_watched: rankedPosts(results, "views", maxResults),
    top_liked: rankedPosts(results, "likes", maxResults),
    top_discussed: rankedPosts(results, "comments_count", maxResults),
    patterns: {
      formats: { reels, posts },
      hashtags: topCountEntries(hashtags, 10),
      keywords: topCountEntries(keywords, 10),
      posting_days: topCountEntries(postingDays, 7),
      posting_hours: topCountEntries(postingHours, 8)
    },
    accuracy: {
      source: "Fresh public Instagram pages",
      followers: "Exact public profile count captured for this run",
      views: `Exact public views verified for ${verifiedViewPosts} of ${results.length} analyzed posts`,
      missing_metrics: "Unverified values are shown as N/A"
    }
  };
}

function normalizedKeywordText(value?: string | null) {
  return (value || "").toLowerCase().replace(/[^a-z0-9_#]+/g, " ");
}

function postMatchesTag(candidate: Candidate, tag?: string | null) {
  if (!tag) return true;
  const needle = normalizedKeywordText(tag).replace(/^#+/, "");
  const caption = normalizedKeywordText(candidate.caption);
  return caption.includes(`#${needle}`) || caption.split(/\s+/).includes(needle);
}

function newerThanCutoff(input: InstagramScrapeInput) {
  if (input.onlyPostsNewerThan) {
    const text = String(input.onlyPostsNewerThan).trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : new Date(text);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  const days = Math.max(1, Number(input.recentDays) || 7);
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function oldestAllowedCutoff(input: InstagramScrapeInput, preferred: Date) {
  const value = (input as InstagramScrapeInput & { autoExpandDays?: unknown; maxAutoExpandDays?: unknown }).autoExpandDays;
  const autoExpand = typeof value === "boolean" ? value : !["0", "false", "no", "off"].includes(String(value ?? "true").toLowerCase());
  if (!autoExpand) return preferred;
  const maxDays = Math.max(1, Number((input as InstagramScrapeInput & { maxAutoExpandDays?: unknown }).maxAutoExpandDays) || 365);
  const maxCutoff = new Date();
  maxCutoff.setUTCDate(maxCutoff.getUTCDate() - maxDays);
  return maxCutoff.getTime() < preferred.getTime() ? maxCutoff : preferred;
}

function selectAutoExpandedResults(results: InstagramPost[], maxResults: number, preferred: Date, oldestAllowed: Date) {
  const preferredResults = results.filter((item) => timestampValue(item.timestamp) >= preferred.getTime());
  if (preferredResults.length >= maxResults || oldestAllowed.getTime() >= preferred.getTime()) {
    return preferredResults.slice(0, maxResults);
  }
  return results.slice(0, maxResults);
}

function selectDiverseResults(results: InstagramPost[], maxResults: number, preferred: Date, oldestAllowed: Date) {
  const preferredResults = results.filter((item) => timestampValue(item.timestamp) >= preferred.getTime());
  const source = preferredResults.length >= maxResults || oldestAllowed.getTime() >= preferred.getTime()
    ? preferredResults
    : results;
  const perAuthorLimit = Math.max(1, Math.min(2, Math.ceil(maxResults / 5)));
  const authorCounts = new Map<string, number>();
  const selected: InstagramPost[] = [];
  const deferred: InstagramPost[] = [];

  for (const item of source) {
    const author = (item.username || item.profile_url || "unknown").toLowerCase();
    const count = authorCounts.get(author) || 0;
    if (count < perAuthorLimit) {
      authorCounts.set(author, count + 1);
      selected.push(item);
      if (selected.length >= maxResults) return selected;
    } else {
      deferred.push(item);
    }
  }

  for (const item of deferred) {
    selected.push(item);
    if (selected.length >= maxResults) break;
  }

  return selected;
}

function candidateToData(candidate: Candidate): Candidate {
  return {
    post_url: candidate.post_url,
    username: candidate.username ?? null,
    display_name: candidate.display_name ?? null,
    profile_url: candidate.profile_url ?? null,
    follower_count: candidate.follower_count ?? null,
    follower_count_display: candidate.follower_count_display ?? null,
    likes: candidate.likes ?? null,
    likes_hidden: candidate.likes_hidden ?? false,
    comments_count: candidate.comments_count ?? null,
    comments_hidden: candidate.comments_hidden ?? false,
    views: candidate.views ?? null,
    views_display: candidate.views_display ?? null,
    thumbnail_url: candidate.thumbnail_url ?? null,
    top_comments: candidate.top_comments || [],
    timestamp: candidate.timestamp ?? null,
    caption: candidate.caption ?? null,
    _handle: candidate._handle || candidate.username || null,
    _owner_id: candidate._owner_id ?? null,
    _reels_id: candidate._reels_id ?? null,
    _source: candidate._source ?? null,
    _source_rank: candidate._source_rank ?? null,
    _views_verified: candidate._views_verified ?? false
  };
}

function isShortcode(value?: string | null) {
  return Boolean(value && /^[A-Za-z0-9_-]{6,}$/.test(value));
}

function countFromRaw(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") return parseCount(value);
  return null;
}

function largestCountFromRaw(...values: unknown[]) {
  const counts = values
    .map(countFromRaw)
    .filter((value): value is number => value !== null && value >= 0);
  return counts.length ? Math.max(...counts) : null;
}

function timestampFromRaw(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return timestampFromRaw(numeric);
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}

function rawCandidatePostUrl(candidate: RawPageCandidate) {
  const postUrl = normalizePostUrl(candidate.href);
  if (postUrl) return postUrl;

  const code = cleanText(candidate.code);
  if (!isShortcode(code)) return null;
  const typeText = `${candidate.mediaType ?? ""} ${candidate.productType ?? ""}`.toLowerCase();
  const pathType = candidate.mediaType === 2 || /video|clips|reel/.test(typeText) ? "reel" : "p";
  return `${instagramHost}/${pathType}/${code}/`;
}

function rawPageCandidateToCandidate(raw: RawPageCandidate, sourceLabel: string): Candidate | null {
  const postUrl = rawCandidatePostUrl(raw);
  if (!postUrl) return null;

  const username = cleanText(raw.username);
  const handle = isInstagramHandle(username) ? username : null;
  const displayName = cleanText(raw.displayName);
  const timestamp = timestampFromRaw(raw.timestamp);

  return {
    post_url: postUrl,
    username: handle,
    display_name: displayName || null,
    profile_url: handle ? `${instagramHost}/${handle}/` : null,
    likes: countFromRaw(raw.likes),
    comments_count: countFromRaw(raw.commentsCount),
    views: countFromRaw(raw.views),
    views_display: cleanText(raw.views) || null,
    thumbnail_url: cleanText(raw.thumbnail) || null,
    caption: cleanCaptionText(raw.caption),
    timestamp: timestamp || timestampFromPostUrl(postUrl),
    top_comments: [],
    _handle: handle,
    _source: sourceLabel,
    _source_rank: typeof raw.rank === "number" && Number.isFinite(raw.rank) ? raw.rank : null,
    _views_verified: raw.viewsVerified === true
  };
}

async function collectPublicProfileFeedCandidates(
  page: Page,
  requestedHandle: string,
  limit: number,
  range: ScrapeRange
) {
  const handle = requestedHandle.replace(/^@+/, "").trim().toLowerCase();
  if (!isInstagramHandle(handle)) return [];

  const bootstrap: PublicProfileBootstrap = await page.evaluate<PublicProfileBootstrap>(`
    (async () => {
      const handle = ${JSON.stringify(handle)};
      const response = await fetch("/api/v1/users/web_profile_info/?username=" + encodeURIComponent(handle) + "&_=" + Date.now(), {
        cache: "no-store",
        headers: {
          "cache-control": "no-cache",
          "pragma": "no-cache",
          "x-ig-app-id": "936619743392459",
          "x-requested-with": "XMLHttpRequest"
        }
      });
      if (!response.ok) return { ok: false, status: response.status };
      const payload = await response.json();
      const user = payload && payload.data && payload.data.user;
      if (!user || !user.id) return { ok: false, status: response.status };
      const nodes = ((user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.edges) || [])
        .map((edge) => edge && edge.node)
        .filter(Boolean);
      return {
        ok: true,
        status: response.status,
        userId: String(user.id),
        reelsId: user.fbid ? String(user.fbid) : null,
        username: user.username || handle,
        displayName: user.full_name || user.username || handle,
        followerCount: user.edge_followed_by && Number(user.edge_followed_by.count),
        items: nodes.map((node) => ({
          code: node.shortcode,
          username: (node.owner && node.owner.username) || user.username || handle,
          displayName: user.full_name || user.username || handle,
          mediaType: node.is_video ? 2 : 1,
          productType: node.product_type || (node.is_video ? "clips" : "feed"),
          timestamp: node.taken_at_timestamp,
          likes: node.edge_liked_by && node.edge_liked_by.count,
          commentsCount: node.edge_media_to_comment && node.edge_media_to_comment.count,
          views: [node.play_count, node.view_count, node.video_view_count, node.ig_play_count]
            .map(Number)
            .filter((value) => Number.isFinite(value) && value >= 0)
            .reduce((largest, value) => Math.max(largest, value), 0) || null,
          thumbnail: node.display_url || node.thumbnail_src,
          caption: node.edge_media_to_caption && node.edge_media_to_caption.edges &&
            node.edge_media_to_caption.edges[0] && node.edge_media_to_caption.edges[0].node &&
            node.edge_media_to_caption.edges[0].node.text
        }))
      };
    })()
  `).catch((): PublicProfileBootstrap => ({ ok: false }));

  if (!bootstrap.ok) {
    console.warn(`Instagram public profile feed bootstrap failed for ${handle} (${bootstrap.status || "unknown"}).`);
    return [];
  }

  const profileHandle = cleanText(bootstrap.username).toLowerCase() || handle;
  if (profileHandle !== handle) return [];
  const followerCount = Number(bootstrap.followerCount);
  const exactFollowerCount = Number.isFinite(followerCount) && followerCount >= 0 ? Math.trunc(followerCount) : null;
  const followerCountDisplay = exactFollowerCount === null ? null : exactFollowerCount.toLocaleString("en-US");
  const displayName = cleanText(bootstrap.displayName) || profileHandle;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const addRawCandidate = (raw: RawPageCandidate, source: string) => {
    const candidate = rawPageCandidateToCandidate(raw, source);
    if (!candidate?.post_url) return;
    const candidateHandle = cleanText(candidate._handle || candidate.username).toLowerCase();
    if (candidateHandle && candidateHandle !== handle) return;
    const identity = postIdentity(candidate.post_url);
    if (seen.has(identity)) return;
    seen.add(identity);
    candidate.username = handle;
    candidate._handle = handle;
    candidate._owner_id = cleanText(bootstrap.userId) || null;
    candidate._reels_id = cleanText(bootstrap.reelsId) || null;
    candidate.display_name = displayName;
    candidate.profile_url = `${instagramHost}/${handle}/`;
    candidate.follower_count = exactFollowerCount;
    candidate.follower_count_display = followerCountDisplay;
    candidates.push(candidate);
  };

  for (const item of bootstrap.items || []) addRawCandidate(item, "public profile bootstrap");

  const userId = cleanText(bootstrap.userId);
  if (!userId) return candidates.slice(0, limit);
  let maxId = "";
  const pageLimit = Math.max(2, Math.min(16, Math.ceil(limit / 12) + 2));
  for (let pageIndex = 0; pageIndex < pageLimit && candidates.length < limit; pageIndex += 1) {
    const feed: PublicProfileFeedPage = await page.evaluate<PublicProfileFeedPage>(`
      (async () => {
        const userId = ${JSON.stringify(userId)};
        const maxId = ${JSON.stringify(maxId)};
        const params = new URLSearchParams({ count: "12", _: String(Date.now()) });
        if (maxId) params.set("max_id", maxId);
        const response = await fetch("/api/v1/feed/user/" + encodeURIComponent(userId) + "/?" + params, {
          cache: "no-store",
          headers: {
            "cache-control": "no-cache",
            "pragma": "no-cache",
            "x-ig-app-id": "936619743392459",
            "x-requested-with": "XMLHttpRequest"
          }
        });
        if (!response.ok) return { ok: false, status: response.status };
        const payload = await response.json();
        const thumbnail = (media) => {
          const own = media && media.image_versions2 && media.image_versions2.candidates;
          if (own && own[0] && own[0].url) return own[0].url;
          const first = media && media.carousel_media && media.carousel_media[0];
          const carousel = first && first.image_versions2 && first.image_versions2.candidates;
          return carousel && carousel[0] && carousel[0].url || null;
        };
        return {
          ok: true,
          status: response.status,
          moreAvailable: Boolean(payload.more_available),
          nextMaxId: payload.next_max_id || null,
          items: (payload.items || []).map((media) => ({
            code: media.code,
            username: media.user && media.user.username,
            displayName: media.user && media.user.full_name,
            mediaType: media.media_type,
            productType: media.product_type,
            timestamp: media.taken_at,
            likes: media.like_count,
            commentsCount: media.comment_count,
            views: [
              media.play_count,
              media.view_count,
              media.video_view_count,
              media.ig_play_count,
              media.clips_metadata && media.clips_metadata.play_count,
              media.clips_metadata && media.clips_metadata.view_count
            ]
              .map(Number)
              .filter((value) => Number.isFinite(value) && value >= 0)
              .reduce((largest, value) => Math.max(largest, value), 0) || null,
            thumbnail: thumbnail(media),
            caption: media.caption && media.caption.text
          }))
        };
      })()
    `).catch((): PublicProfileFeedPage => ({ ok: false }));

    if (!feed.ok || !feed.items?.length) {
      console.warn(`Instagram public profile feed page failed for ${handle} (${feed.status || "unknown"}).`);
      break;
    }
    for (const item of feed.items) addRawCandidate(item, "public profile feed");

    const feedTimes = feed.items
      .map((item) => timestampValue(timestampFromRaw(item.timestamp)))
      .filter((value) => value > 0);
    if (range.collectionMode === "range" && feedTimes.length && feedTimes.every((value) => value < range.start.getTime())) {
      break;
    }
    maxId = cleanText(feed.nextMaxId);
    if (!feed.moreAvailable || !maxId) break;
  }

  return candidates.slice(0, limit);
}

function mergeCandidateData(target: Candidate, source: Candidate) {
  for (const key of [
    "username",
    "display_name",
    "profile_url",
    "likes",
    "comments_count",
    "views",
    "views_display",
    "thumbnail_url",
    "caption",
    "timestamp",
    "_handle",
    "_owner_id",
    "_reels_id",
    "_source"
  ] as (keyof Candidate)[]) {
    if (target[key] == null || target[key] === "") target[key] = source[key] as never;
  }
  if (target._source_rank == null || (source._source_rank != null && source._source_rank < target._source_rank)) {
    target._source_rank = source._source_rank;
  }
  if (source._views_verified && source.views !== null && source.views !== undefined) {
    target.views = source.views;
    target.views_display = source.views_display;
    target._views_verified = true;
  }
}

export function currentReelViewsFromPayload(payload: unknown) {
  const metrics = new Map<string, number>();
  const visited = new Set<object>();

  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 60 || visited.has(value)) return;
    visited.add(value);
    const node = value as Record<string, unknown>;
    const code = cleanText(node.code || node.shortcode);
    if (code && /^[A-Za-z0-9_-]{6,}$/.test(code)) {
      const views = largestCountFromRaw(
        node.play_count,
        node.view_count,
        node.video_view_count,
        node.ig_play_count,
        (node.clips_metadata as Record<string, unknown> | undefined)?.play_count,
        (node.clips_metadata as Record<string, unknown> | undefined)?.view_count
      );
      if (views !== null) metrics.set(code, Math.max(metrics.get(code) ?? 0, views));
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach((item) => visit(item, depth + 1));
      else if (child && typeof child === "object") visit(child, depth + 1);
    }
  };

  visit(payload);
  return metrics;
}

async function verifyPublicProfileReelViews(page: Page, username: string, candidates: Candidate[]) {
  const targets = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (!candidate.post_url || !/\/reel\//i.test(candidate.post_url)) continue;
    targets.set(postIdentity(candidate.post_url), candidate);
  }
  if (!targets.size) return;

  const pending = new Set<Promise<void>>();
  let graphqlTemplate = "";
  let initialQueryDocId = process.env.INSTAGRAM_REELS_INITIAL_DOC_ID || "7950326061742207";
  let pageQueryDocId = process.env.INSTAGRAM_REELS_PAGE_DOC_ID || "27402742122690167";
  let reelsCursor = "";
  let discoveredReelsId = "";
  const applyPayload = (payload: unknown) => {
    for (const [code, views] of currentReelViewsFromPayload(payload)) {
      const candidate = targets.get(code);
      if (!candidate) continue;
      candidate.views = views;
      candidate.views_display = views.toLocaleString("en-US");
      candidate._views_verified = true;
    }
  };
  const captureConnectionState = (payload: unknown) => {
    const visited = new Set<object>();
    const visit = (value: unknown, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 60 || visited.has(value)) return;
      visited.add(value);
      const node = value as Record<string, unknown>;
      const pageInfo = node.page_info as Record<string, unknown> | undefined;
      const cursor = cleanText(pageInfo?.end_cursor);
      if (cursor && /^AQ/i.test(cursor)) reelsCursor = cursor;
      const fbid = cleanText(node.fbid || node.fbid_v2);
      if (fbid && /^\d{12,}$/.test(fbid)) discoveredReelsId = fbid;
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach((item) => visit(item, depth + 1));
        else if (child && typeof child === "object") visit(child, depth + 1);
      }
    };
    visit(payload);
  };
  const responseHandler = (response: Response) => {
    if (!/instagram\.com\/(?:api\/)?graphql/i.test(response.url())) return;
    const request = response.request();
    const postData = request.postData();
    if (postData) {
      const params = new URLSearchParams(postData);
      const friendlyName = params.get("fb_api_req_friendly_name") || "";
      if (!graphqlTemplate || friendlyName.includes("ProfileReelsTabContentQuery")) graphqlTemplate = postData;
      if (friendlyName.includes("ProfileReelsTabContentQuery") && params.get("doc_id")) {
        pageQueryDocId = params.get("doc_id")!;
      }
    } else {
      const docId = new URL(response.url()).searchParams.get("doc_id");
      if (docId && /edge_owner_to_timeline_media/i.test(response.url()) === false) initialQueryDocId = docId;
    }
    const resourceType = request.resourceType();
    if (resourceType !== "xhr" && resourceType !== "fetch") return;
    let task: Promise<void>;
    task = response.json()
      .then((payload) => {
        applyPayload(payload);
        captureConnectionState(payload);
      })
      .catch(() => {})
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  const settleResponses = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
  };

  page.on("response", responseHandler);
  try {
    const url = `${instagramHost}/${username}/reels/?hl=en&fresh=${Date.now()}`;
    await gotoPublicPage(page, url, 30_000);
    const routeState = await page.evaluate<{ cursor: string; reelsId: string }>(`
      (() => {
        const cursors = [];
        const ids = [];
        const visited = new Set();
        const visit = (value, depth = 0) => {
          if (!value || typeof value !== "object" || depth > 60 || visited.has(value)) return;
          visited.add(value);
          if (value.page_info && typeof value.page_info === "object") {
            const cursor = String(value.page_info.end_cursor || "").trim();
            if (/^AQ/i.test(cursor)) cursors.push(cursor);
          }
          const fbid = String(value.fbid || value.fbid_v2 || "").trim();
          if (/^\\d{12,}$/.test(fbid)) ids.push(fbid);
          for (const child of Object.values(value)) {
            if (Array.isArray(child)) child.forEach((item) => visit(item, depth + 1));
            else if (child && typeof child === "object") visit(child, depth + 1);
          }
        };
        for (const script of Array.from(document.scripts)) {
          const text = script.textContent || "";
          try {
            visit(JSON.parse(text));
          } catch {
            for (const match of text.matchAll(/\\?"end_cursor\\?":\\?"(AQ[^"\\\\]{20,})/g)) {
              cursors.push(match[1].replace(/\\\\u003d/g, "="));
            }
            for (const match of text.matchAll(/\\?"(?:fbid|fbid_v2)\\?":\\?"(\\d{12,})/g)) ids.push(match[1]);
          }
        }
        return { cursor: cursors[0] || "", reelsId: ids[0] || "" };
      })()
    `).catch(() => ({ cursor: "", reelsId: "" }));
    if (routeState.cursor) reelsCursor = routeState.cursor;
    if (routeState.reelsId) discoveredReelsId = routeState.reelsId;
    let previousCount = 0;
    let staleScrolls = 0;
    const scrollLimit = Math.max(4, Math.min(20, Math.ceil(targets.size / 4) + 3));

    for (let index = 0; index < scrollLimit; index += 1) {
      await sleep(700);
      await settleResponses();
      const count = await page.locator('a[href*="/reel/"]').count().catch(() => 0);
      staleScrolls = count > previousCount ? 0 : staleScrolls + 1;
      previousCount = Math.max(previousCount, count);
      if ([...targets.values()].every((candidate) => candidate._views_verified) || staleScrolls >= 2) break;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }
    await settleResponses();

    const ownerId = cleanText([...targets.values()].find((candidate) => candidate._owner_id)?._owner_id);
    const reelsId = cleanText([...targets.values()].find((candidate) => candidate._reels_id)?._reels_id) || discoveredReelsId;
    if (ownerId) {
      const payloads = await page.evaluate<unknown[], {
        ownerId: string;
        reelsId: string;
        template: string;
        initialDocId: string;
        pageDocId: string;
        pageLimit: number;
        startCursor: string;
      }>(async ({ ownerId, reelsId, template, initialDocId, pageDocId, pageLimit, startCursor }) => {
        const payloads: unknown[] = [];
        const parseJson = (text: string) => {
          try {
            return JSON.parse(text.replace(/^for\s*\(;;\);/, ""));
          } catch {
            return null;
          }
        };
        const initialVariables = { id: ownerId, include_clips_attribution_info: false, first: 12 };
        const initialUrl = "/graphql/query/?hl=en&doc_id=" + encodeURIComponent(initialDocId) +
          "&variables=" + encodeURIComponent(JSON.stringify(initialVariables)) + "&_=" + Date.now();
        const initialResponse = await fetch(initialUrl, {
          cache: "no-store",
          headers: { "cache-control": "no-cache", "pragma": "no-cache", "x-requested-with": "XMLHttpRequest" }
        });
        const initialPayload = parseJson(await initialResponse.text());
        if (initialPayload) payloads.push(initialPayload);

        const initialConnection = initialPayload?.data?.user?.edge_owner_to_timeline_media;
        let after = startCursor || initialConnection?.page_info?.end_cursor || "";
        const firstNode = initialConnection?.edges?.[0]?.node;
        const firstOwner = firstNode?.owner;
        const connectionId = reelsId || initialPayload?.data?.user?.fbid ||
          firstOwner?.id || firstOwner?.__id || "";
        if (!after || !connectionId) return payloads;

        for (let index = 0; index < pageLimit && after; index += 1) {
          const variables = { after, first: 4, id: connectionId };
          const pageUrl = "/graphql/query/?hl=en&doc_id=" + encodeURIComponent(pageDocId) +
            "&variables=" + encodeURIComponent(JSON.stringify(variables)) + "&_=" + Date.now();
          let response = await fetch(pageUrl, {
            cache: "no-store",
            headers: {
              "cache-control": "no-cache",
              "pragma": "no-cache",
              "x-requested-with": "XMLHttpRequest"
            }
          });
          let payload = parseJson(await response.text());
          let connection = payload?.data?.node?.polaris_clips_connection;

          if (!connection && template) {
            const body = new URLSearchParams(template);
            body.set("fb_api_caller_class", "RelayModern");
            body.set("fb_api_req_friendly_name", "PolarisLoggedOutDesktopWWWProfileReelsTabContentQuery_connection");
            body.set("variables", JSON.stringify(variables));
            body.set("doc_id", pageDocId);
            const lsd = body.get("lsd") || "";
            response = await fetch("/api/graphql", {
              method: "POST",
              cache: "no-store",
              headers: {
                "cache-control": "no-cache",
                "content-type": "application/x-www-form-urlencoded",
                "pragma": "no-cache",
                "x-fb-lsd": lsd,
                "x-requested-with": "XMLHttpRequest"
              },
              body
            });
            payload = parseJson(await response.text());
            connection = payload?.data?.node?.polaris_clips_connection;
          }
          if (!payload) break;
          payloads.push(payload);
          if (!connection?.page_info?.has_next_page) break;
          after = connection.page_info.end_cursor || "";
        }
        return payloads;
      }, {
        ownerId,
        reelsId,
        template: graphqlTemplate,
        initialDocId: initialQueryDocId,
        pageDocId: pageQueryDocId,
        pageLimit: scrollLimit,
        startCursor: reelsCursor
      }).catch(() => []);
      payloads.forEach(applyPayload);
    }
  } catch {
    // Keep view values unverified when Instagram does not expose the live Reels response.
  } finally {
    page.off("response", responseHandler);
  }
}

async function collectCurrentPageCandidates(page: Page, sourceLabel: string) {
  const rawCandidates = await page.evaluate<RawPageCandidate[]>(`
    (() => {
      const results = [];
      const seenEmbedded = new Set();
      let rank = 0;
      const push = (candidate) => {
        results.push({ ...candidate, rank: rank++ });
      };
      const shortcodeFromHref = (href) => {
        const match = String(href || "").match(/\\/(p|reel)\\/([A-Za-z0-9_-]{6,})/i);
        return match ? { type: match[1].toLowerCase(), code: match[2] } : null;
      };
      const firstText = (...values) => {
        for (const value of values) {
          if (typeof value === "string" && value.trim()) return value.trim();
        }
        return null;
      };
      const firstValue = (...values) => {
        for (const value of values) {
          if (value !== null && value !== undefined && value !== "") return value;
        }
        return null;
      };
      const largestMetric = (...values) => {
        const parsed = values
          .map((value) => {
            if (typeof value === "number") return value;
            const match = String(value || "").replace(/,/g, "").trim().match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
            if (!match) return Number.NaN;
            const suffix = (match[2] || "").toUpperCase();
            const multiplier = suffix === "K" ? 1e3 : suffix === "M" ? 1e6 : suffix === "B" ? 1e9 : 1;
            return Number(match[1]) * multiplier;
          })
          .filter((value) => Number.isFinite(value) && value >= 0);
        return parsed.length ? Math.max(...parsed) : null;
      };
      const firstImage = (node) => {
        if (!node || typeof node !== "object") return null;
        const imageVersions = node.image_versions2 && Array.isArray(node.image_versions2.candidates)
          ? node.image_versions2.candidates
          : [];
        return firstText(
          imageVersions[0] && imageVersions[0].url,
          node.display_url,
          node.thumbnail_src,
          node.thumbnail_url,
          node.image && node.image.uri,
          node.image && node.image.url
        );
      };
      const mediaCandidate = (node) => {
        if (!node || typeof node !== "object") return null;
        const code = firstText(node.code, node.shortcode);
        if (!code || !/^[A-Za-z0-9_-]{6,}$/.test(code)) return null;
        const user = node.user || node.owner || node.taken_by || node.owner_user || {};
        return {
          code,
          username: firstText(user.username, user.user_name, user.handle),
          displayName: firstText(user.full_name, user.name),
          mediaType: firstValue(node.media_type, node.__typename),
          productType: firstText(node.product_type),
          timestamp: firstValue(node.taken_at, node.taken_at_timestamp, node.caption && node.caption.created_at),
          likes: firstValue(node.like_count, node.edge_liked_by && node.edge_liked_by.count),
          commentsCount: firstValue(node.comment_count, node.edge_media_to_comment && node.edge_media_to_comment.count),
          views: largestMetric(
            node.play_count,
            node.view_count,
            node.video_view_count,
            node.ig_play_count,
            node.clips_metadata && node.clips_metadata.play_count,
            node.clips_metadata && node.clips_metadata.view_count
          ),
          thumbnail: firstImage(node),
          caption: firstText(
            node.caption && node.caption.text,
            node.edge_media_to_caption && node.edge_media_to_caption.edges && node.edge_media_to_caption.edges[0] && node.edge_media_to_caption.edges[0].node && node.edge_media_to_caption.edges[0].node.text
          )
        };
      };
      const visit = (node, depth = 0) => {
        if (!node || typeof node !== "object" || depth > 70) return;
        const candidate = mediaCandidate(node);
        if (candidate && !seenEmbedded.has(candidate.code)) {
          seenEmbedded.add(candidate.code);
          push(candidate);
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
          else if (value && typeof value === "object") visit(value, depth + 1);
        }
      };

      for (const anchor of Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'))) {
        const href = anchor.href || anchor.getAttribute("href") || "";
        const parsed = shortcodeFromHref(href);
        if (!parsed) continue;
        const visibleMetric = (anchor.innerText || anchor.textContent || "")
          .split(/\\n+/)
          .map((text) => text.trim())
          .find((text) => /^[\\d,.]+(?:\\.\\d+)?\\s*[KMB]?$/i.test(text)) || null;
        push({
          href,
          code: parsed.code,
          mediaType: parsed.type === "reel" ? "reel" : "post",
          views: parsed.type === "reel" ? visibleMetric : null,
          viewsVerified: parsed.type === "reel" && visibleMetric !== null
        });
      }

      for (const script of Array.from(document.scripts)) {
        const text = script.textContent || "";
        if (!/(?:code|shortcode|taken_at|media_type|XIGPolaris)/i.test(text)) continue;
        try {
          visit(JSON.parse(text));
        } catch {
          for (const match of text.matchAll(/"(?:code|shortcode)":"([A-Za-z0-9_-]{6,})"/g)) {
            const code = match[1];
            if (seenEmbedded.has(code)) continue;
            seenEmbedded.add(code);
            const near = text.slice(Math.max(0, match.index - 1200), Math.min(text.length, match.index + 3200));
            const username = near.match(/"username":"([^"\\\\]+)"/)?.[1] || null;
            const taken = near.match(/"taken_at(?:_timestamp)?":(\\d+)/)?.[1] || null;
            push({
              code,
              username,
              timestamp: taken,
              mediaType: /VideoMedia|clips|reel/i.test(near) ? "reel" : "post"
            });
          }
        }
      }

      return results;
    })()
  `).catch(() => []);

  const candidates = new Map<string, Candidate>();
  for (const raw of rawCandidates) {
    const candidate = rawPageCandidateToCandidate(raw, sourceLabel);
    if (!candidate?.post_url) continue;
    const identity = postIdentity(candidate.post_url);
    const existing = candidates.get(identity);
    if (existing) mergeCandidateData(existing, candidate);
    else candidates.set(identity, candidate);
  }

  return [...candidates.values()].sort((a, b) => (a._source_rank ?? Number.MAX_SAFE_INTEGER) - (b._source_rank ?? Number.MAX_SAFE_INTEGER));
}

function publicMediaThumbnail(media: Record<string, unknown>): string | null {
  const imageVersions = media.image_versions2 as { candidates?: { url?: string }[] } | undefined;
  const candidate = imageVersions?.candidates?.[0]?.url;
  if (candidate) return candidate;

  const carousel = media.carousel_media as Record<string, unknown>[] | undefined;
  return carousel?.[0] ? publicMediaThumbnail(carousel[0]) : null;
}

function publicMediaTopComments(media: Record<string, unknown>, ownerHandle?: string | null) {
  const comments = [
    ...(Array.isArray(media.preview_comments) ? media.preview_comments as Record<string, unknown>[] : []),
    ...(Array.isArray(media.comments) ? media.comments as Record<string, unknown>[] : [])
  ];

  return cleanTopComments(comments.map((comment) => {
    const user = comment.user && typeof comment.user === "object" ? comment.user as Record<string, unknown> : {};
    const createdAt = Number(comment.created_at || comment.created_at_utc);
    return {
      username: cleanText(user.username || comment.username),
      text: cleanText(comment.text),
      timestamp: Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt * 1000).toISOString() : undefined
    };
  }), ownerHandle);
}

function publicMediaToCandidate(media: Record<string, unknown>): Candidate | null {
  const code = cleanText(media.code);
  const takenAt = Number(media.taken_at);
  if (!code || !Number.isFinite(takenAt)) return null;

  const user = media.user && typeof media.user === "object" ? media.user as Record<string, unknown> : {};
  const username = cleanText(user.username) || null;
  const mediaType = Number(media.media_type);
  const productType = cleanText(media.product_type);
  const pathType = mediaType === 2 || productType === "clips" ? "reel" : "p";
  const caption = media.caption && typeof media.caption === "object"
    ? cleanCaptionText((media.caption as Record<string, unknown>).text as string | undefined)
    : null;

  return {
    username,
    display_name: cleanText(user.full_name) || username,
    profile_url: username ? `${instagramHost}/${username}/` : null,
    post_url: `${instagramHost}/${pathType}/${code}/`,
    thumbnail_url: publicMediaThumbnail(media),
    comments_count: countFromRaw(media.comment_count),
    comments_hidden: Boolean(media.comments_disabled) && countFromRaw(media.comment_count) === null,
    likes: countFromRaw(media.like_count),
    likes_hidden: Boolean(media.like_and_view_counts_disabled || media.hide_like_and_view_counts) &&
      countFromRaw(media.like_count) === null,
    views: largestCountFromRaw(
      media.play_count,
      media.view_count,
      media.video_view_count,
      media.ig_play_count,
      (media.clips_metadata as Record<string, unknown> | undefined)?.play_count,
      (media.clips_metadata as Record<string, unknown> | undefined)?.view_count
    ),
    follower_count: countFromRaw(user.follower_count),
    follower_count_display: countFromRaw(user.follower_count) !== null
      ? countFromRaw(user.follower_count)!.toLocaleString("en-US")
      : null,
    top_comments: publicMediaTopComments(media, username),
    timestamp: new Date(takenAt * 1000).toISOString(),
    caption,
    _handle: username
  };
}

async function collectRecentPublicHashtagCandidates(page: Page, tag: string, limit: number, range: ScrapeRange) {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  let maxId = "";

  try {
    await gotoPublicPage(page, `${instagramHost}/explore/tags/${encodeURIComponent(tag)}/?hl=en`, 30_000);
  } catch {
    return candidates;
  }
  if (await isLoginPage(page)) return candidates;

  const pageLimit = Math.max(2, Math.min(8, Math.ceil(limit / 12) + 2));
  for (let index = 0; index < pageLimit && candidates.length < limit; index += 1) {
    await dismissInstagramPrompts(page);
    const payload = await page.evaluate<{
      ok: boolean;
      medias?: Record<string, unknown>[];
      more_available?: boolean;
      next_max_id?: string;
    }>(`
      (async () => {
        const tag = ${JSON.stringify(tag)};
        const maxId = ${JSON.stringify(maxId)};
        const csrf = document.cookie
          .split("; ")
          .find((item) => item.startsWith("csrftoken="))
          ?.split("=")[1] || "";
        const body = new URLSearchParams({
          include_persistent: "0",
          max_id: maxId || "",
          page: "1",
          surface: "grid",
          tab: "recent"
        }).toString();
        const response = await fetch("/api/v1/tags/" + encodeURIComponent(tag) + "/sections/", {
          method: "POST",
          headers: {
            "x-ig-app-id": "936619743392459",
            "x-requested-with": "XMLHttpRequest",
            "x-csrftoken": csrf,
            "content-type": "application/x-www-form-urlencoded"
          },
          body
        });
        const text = await response.text();
        if (!response.ok) return { ok: false };

        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          return { ok: false };
        }

        const medias = [];
        const visit = (node) => {
          if (!node || typeof node !== "object") return;
          if (node.media && node.media.code) medias.push(node.media);
          for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === "object") visit(value);
          }
        };
        visit(data);
        return {
          ok: true,
          medias,
          more_available: Boolean(data.more_available),
          next_max_id: data.next_max_id || ""
        };
      })()
    `).catch(() => ({
      ok: false,
      medias: [] as Record<string, unknown>[],
      more_available: false,
      next_max_id: ""
    }));

    if (!payload.ok || !payload.medias?.length) break;

    for (const media of payload.medias) {
      const candidate = publicMediaToCandidate(media);
      if (!candidate?.post_url || seen.has(candidate.post_url)) continue;
      if (!timestampInRange(candidate.timestamp, range)) continue;
      seen.add(candidate.post_url);
      candidates.push(candidate);
      if (candidates.length >= limit) break;
    }

    maxId = payload.next_max_id || "";
    if (!payload.more_available || !maxId) break;
  }

  return candidates.sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp));
}

function recentSearchWindows(range: ScrapeRange) {
  if (range.collectionMode === "latest") {
    return [
      { yahoo: "d", duck: "d" },
      { yahoo: "w", duck: "w" },
      { yahoo: "m", duck: "m" },
      { yahoo: "", duck: "" }
    ];
  }
  const endAgeDays = Math.max(0, Math.ceil((Date.now() - range.end.getTime()) / 86_400_000));
  if (endAgeDays > 31) return [{ yahoo: "", duck: "" }];
  const days = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86_400_000));
  if (days <= 2) return [{ yahoo: "d", duck: "d" }, { yahoo: "w", duck: "w" }];
  if (days <= 7) return [{ yahoo: "w", duck: "w" }, { yahoo: "m", duck: "m" }];
  if (days <= 31) return [{ yahoo: "m", duck: "m" }, { yahoo: "", duck: "" }];
  return [{ yahoo: "", duck: "" }];
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/");
}

function decodeSearchValue(value: string) {
  let decoded = decodeHtmlEntities(value);
  for (let index = 0; index < 4; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function extractInstagramPostUrlsFromSearchHtml(html: string) {
  const urls = new Set<string>();
  const decoded = decodeHtmlEntities(html);
  const addFromText = (value: string) => {
    const text = decodeSearchValue(value);
    const match = text.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?/i);
    const postUrl = normalizePostUrl(match?.[0]);
    if (postUrl) urls.add(postUrl);
  };

  for (const match of decoded.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?[^"'<> )]*/gi)) {
    addFromText(match[0]);
  }

  for (const match of decoded.matchAll(/(?:RU|uddg|url|u|r)=([^"'<>]+)/gi)) {
    addFromText(match[1]);
  }

  return [...urls];
}

async function fetchSearchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": defaultUserAgent,
        "accept-language": "en-US,en;q=0.9"
      },
      signal: controller.signal
    });
    if (!response.ok && response.status !== 202) return "";
    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function collectRecentSearchCandidates(tag: string, limit: number, range: ScrapeRange) {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const filters = recentSearchWindows(range);
  const after = range.start.toISOString().slice(0, 10);
  const beforeDate = new Date(range.end.getTime() + 86_400_000).toISOString().slice(0, 10);
  const rangeQuery = `after:${after} before:${beforeDate}`;
  const queries = [
    `site:instagram.com/reel/ #${tag}`,
    `site:instagram.com/p/ #${tag}`,
    `site:instagram.com/reel/ ${tag}`,
    `site:instagram.com/p/ ${tag}`,
    `site:instagram.com/reel/ #${tag} OR site:instagram.com/p/ #${tag}`,
    `site:instagram.com/reel/ ${tag} OR site:instagram.com/p/ ${tag}`
  ].map((query) => `${query} ${rangeQuery}`);

  const urls: { source: string; url: string }[] = [];
  for (const filter of filters) {
    for (const query of queries) {
      const yahooParams = { p: query, fr: "yfp-t", ...(filter.yahoo ? { btf: filter.yahoo } : {}) };
      urls.push({ source: "recent yahoo", url: `https://search.yahoo.com/search?${new URLSearchParams(yahooParams)}` });
      urls.push({ source: "recent yahoo", url: `https://search.yahoo.com/search?${new URLSearchParams({ ...yahooParams, b: "11" })}` });

      const duckParams = { q: query, ...(filter.duck ? { df: filter.duck } : {}) };
      urls.push({ source: "recent duckduckgo", url: `https://html.duckduckgo.com/html/?${new URLSearchParams(duckParams)}` });
    }
  }

  let rank = 0;
  const searchBatchSize = 4;
  for (let offset = 0; offset < urls.length && candidates.length < limit; offset += searchBatchSize) {
    const batch = urls.slice(offset, offset + searchBatchSize);
    const pages = await Promise.all(batch.map(async (source) => ({
      source,
      html: await fetchSearchHtml(source.url)
    })));
    for (const page of pages) {
      if (!page.html) continue;
      for (const postUrl of extractInstagramPostUrlsFromSearchHtml(page.html)) {
        const identity = postIdentity(postUrl);
        if (seen.has(identity)) continue;
        const timestamp = timestampFromPostUrl(postUrl);
        if (!timestampInRange(timestamp, range)) continue;
        seen.add(identity);
        candidates.push({
          post_url: postUrl,
          timestamp,
          top_comments: [],
          _source: page.source.source,
          _source_rank: rank
        });
        rank += 1;
        if (candidates.length >= limit) break;
      }
      if (candidates.length >= limit) break;
    }
  }

  return candidates.sort((a, b) => postOrderValue(b.post_url || "") - postOrderValue(a.post_url || "") || (a._source_rank || 0) - (b._source_rank || 0));
}

function searchSources(query: string): { label: string; url: string }[] {
  const directPost = normalizePostUrl(query);
  if (directPost) return [{ label: "direct post/reel", url: directPost }];

  const tag = normalizeHashtag(query);
  if (tag) {
    const hashQuery = new URLSearchParams({ q: `#${tag}` }).toString().replace(/^q=/, "");
    const textQuery = new URLSearchParams({ q: tag }).toString().replace(/^q=/, "");
    return [
      { label: "popular topic", url: `${instagramHost}/popular/${tag}/?hl=en` },
      { label: "hashtag topic", url: `${instagramHost}/explore/tags/${tag}/?hl=en` },
      { label: "latest keyword", url: `${instagramHost}/explore/search/keyword/?q=${hashQuery}&hl=en&latest=1&sort=latest` },
      { label: "latest keyword", url: `${instagramHost}/explore/search/keyword/?q=${textQuery}&hl=en&latest=1&sort=latest` }
    ];
  }

  const profileUrl = normalizeProfileUrl(query);
  if (profileUrl) return [{ label: "profile", url: profileUrl }];

  const encodedKeyword = new URLSearchParams({ q: query }).toString().replace(/^q=/, "");
  return [{
    label: "keyword search",
    url: `${instagramHost}/explore/search/keyword/?q=${encodedKeyword}&hl=en&latest=1&sort=latest`
  }];
}

async function isLoginPage(page: Page) {
  return page.url().includes("/accounts/login") || Boolean(await page.$('input[name="username"]'));
}

async function collectLatestCandidates(page: Page, query: string, limit: number, targetCount: number, profileReels = false) {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const profileUrl = profileReels ? normalizeProfileUrl(query) : null;
  const sources = profileUrl
    ? [{ label: "profile reels", url: `${profileUrl}reels/` }]
    : splitInputs(query).flatMap(searchSources);
  const sourceLimit = sources.length === 1 ? limit : Math.max(targetCount * 3, Math.floor(limit / Math.max(1, sources.length)));

  const addCandidate = (candidate: Candidate | null | undefined) => {
    if (!candidate?.post_url) return false;
    const identity = postIdentity(candidate.post_url);
    if (seen.has(identity)) return false;
    seen.add(identity);
    candidates.push(candidateToData(candidate));
    return true;
  };

  for (const source of sources) {
    if (source.label === "direct post/reel") {
      addCandidate({ post_url: source.url });
      continue;
    }

    await gotoPublicPage(page, source.url, 30_000);
    if (await isLoginPage(page)) continue;
    try {
      await page.waitForSelector(postSelector, { timeout: source.label === "latest keyword" ? 4000 : 10_000 });
    } catch {
      const embeddedOnly = await collectCurrentPageCandidates(page, source.label);
      for (const candidate of embeddedOnly) addCandidate(candidate);
      if (!embeddedOnly.length) {
        const diagnostic = await page.evaluate<{ title: string; description: string; body: string }>(`
          (() => ({
            title: document.title || "",
            description: document.querySelector('meta[name="description"]')?.content || "",
            body: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 180)
          }))()
        `).catch((): { title: string; description: string; body: string } => ({
          title: "",
          description: "",
          body: ""
        }));
        console.warn("Instagram discovery returned no candidates", JSON.stringify({
          source: source.label,
          requestedUrl: source.url,
          finalUrl: page.url(),
          ...diagnostic
        }));
      }
      continue;
    }
    if (source.label.includes("topic")) {
      await sleep(2500);
      await dismissInstagramPrompts(page);
    }

    let sourceCount = 0;
    const isProfileSource = source.label.startsWith("profile");
    const activeSourceLimit = isProfileSource ? Math.max(targetCount, sourceLimit) : sourceLimit;
    const scrollLimit = isProfileSource
      ? Math.max(2, Math.min(16, Math.floor(activeSourceLimit / 12) + 2))
      : Math.max(8, Math.min(14, Math.floor(activeSourceLimit / 12) + 1));

    let staleScrolls = 0;
    for (let index = 0; index < scrollLimit; index += 1) {
      await dismissInstagramPrompts(page);
      const beforeCount = sourceCount;
      const pageCandidates = await collectCurrentPageCandidates(page, source.label);
      if (process.env.INSTAGRAM_SCRAPER_DEBUG === "1" && index === 0) {
        console.log(JSON.stringify({
          discoverySource: source.label,
          requestedUrl: source.url,
          finalUrl: page.url(),
          count: pageCandidates.length,
          sample: pageCandidates.slice(0, 8).map((item) => ({
            post_url: item.post_url,
            username: item.username,
            rank: item._source_rank
          }))
        }, null, 2));
      }
      for (const candidate of pageCandidates) {
        if (!addCandidate(candidate)) continue;
        sourceCount += 1;
        if (sourceCount >= activeSourceLimit || candidates.length >= limit) break;
      }
      if (sourceCount >= activeSourceLimit || candidates.length >= limit) break;
      if (sourceCount === beforeCount) {
        staleScrolls += 1;
        if (source.label.includes("topic") || staleScrolls >= 2) break;
      } else {
        staleScrolls = 0;
      }

      await page.mouse.wheel(0, 2200);
      await sleep(1000);
      await dismissInstagramPrompts(page);
      if (sourceCount === beforeCount) {
        await page.mouse.wheel(0, 2600);
        await sleep(1000);
        await dismissInstagramPrompts(page);
      }
    }

    if (isProfileSource && candidates.length >= activeSourceLimit) break;
  }

  return candidates;
}

async function snapshotPage(page: Page): Promise<PageSnapshot> {
  return page.evaluate<PageSnapshot>(`
    (() => {
      const meta = (selector) => document.querySelector(selector)?.content?.trim() || "";
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      const jsonLd = scripts.flatMap((script) => {
        try {
          const parsed = JSON.parse(script.textContent || "null");
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return [];
        }
      }).filter(Boolean);
      const profileHref = Array.from(document.querySelectorAll('a[href^="/"]'))
        .map((anchor) => anchor.getAttribute("href") || "")
        .find((href) => /^\\/[A-Za-z0-9._]+\\/?$/.test(href)) || null;

      return {
        title: document.title || "",
        description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
        ogImage: meta('meta[property="og:image"]') || null,
        canonical: document.querySelector('link[rel="canonical"]')?.href || null,
        time: document.querySelector("time")?.dateTime || null,
        jsonLd,
        profileHref
      };
    })()
  `);
}

function firstJsonLdValue(snapshot: PageSnapshot, keys: string[]) {
  for (const item of snapshot.jsonLd) {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

function authorFromJsonLd(snapshot: PageSnapshot) {
  for (const item of snapshot.jsonLd) {
    const author = item.author;
    if (author && typeof author === "object") {
      const record = author as Record<string, unknown>;
      const alternateName = cleanText(record.alternateName).replace(/^@/, "");
      if (isInstagramHandle(alternateName)) return alternateName;

      const urlHandle = handleFromProfileUrl(cleanText(record.url));
      if (urlHandle) return urlHandle;

      const name = cleanText(record.name).replace(/^@/, "");
      if (isInstagramHandle(name)) return name;
    }
  }
  return null;
}

function usernameFromSnapshot(snapshot: PageSnapshot) {
  const jsonUser = authorFromJsonLd(snapshot);
  if (jsonUser) return jsonUser;

  const descUser = snapshot.description.match(/-\s*@?([A-Za-z0-9._]+)\s+on\s+/i)?.[1];
  if (descUser) return descUser;

  const titleUser = snapshot.title.match(/^(.+?)\s+on\s+Instagram/i)?.[1]?.trim();
  if (titleUser && /^[A-Za-z0-9._]+$/.test(titleUser)) return titleUser;

  if (snapshot.profileHref) return snapshot.profileHref.replace(/\//g, "");
  return null;
}

function cleanCaptionText(value?: string | null) {
  let text = (value || "").trim();
  text = text.replace(/^["\u201c]+/, "").trim();
  text = text.replace(/["\u201d]\.?$/u, "").trim();
  return text || null;
}

function captionFromSnapshot(snapshot: PageSnapshot) {
  const jsonCaption = firstJsonLdValue(snapshot, ["caption", "description"]);
  if (jsonCaption) return cleanCaptionText(jsonCaption);

  const [, afterColon] = snapshot.description.split(/:\s+/, 2);
  return cleanCaptionText(afterColon);
}

async function waitForOpenPost(page: Page) {
  await dismissInstagramPrompts(page);
  try {
    await page.waitForSelector('svg[aria-label="Like"], svg[aria-label="Unlike"]', { timeout: 6_000 });
  } catch {
    // Instagram can lazy render icons or hide them for some post types.
  }
  await dismissInstagramPrompts(page);
  await sleep(700);
}

function firstCountFromPatterns(text: string | null | undefined, patterns: RegExp[]) {
  if (!text) return null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = parseCount(`${match[1]}${match[2] || ""}`);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstMetricDisplay(text: string | null | undefined, patterns: RegExp[]) {
  if (!text) return null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    return `${match[1]}${(match[2] || "").toUpperCase()}`;
  }
  return null;
}

function cleanCommentText(value: string, limit = 70) {
  let text = value.split(/\s+/).join(" ").trim();
  for (let index = 0; index < 4; index += 1) {
    const next = text.replace(/\s+(Like|Reply|See translation|View replies|View all(?:\s+\d+\s+replies?)?)$/i, "").trim();
    if (next === text) break;
    text = next;
  }
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}...` : text;
}

function cleanTopComments(
  comments: { username?: string; text?: string; timestamp?: string }[],
  ownerHandle?: string | null,
  limit = 70
) {
  const cleaned: { username: string; text: string; timestamp?: string }[] = [];
  for (const comment of comments) {
    const username = (comment.username || "").trim();
    const text = cleanCommentText(comment.text || "", limit);
    if (!username || !text) continue;
    if (ownerHandle && username.toLowerCase() === ownerHandle.toLowerCase()) continue;
    cleaned.push({ username, text, timestamp: comment.timestamp });
    if (cleaned.length >= 5) break;
  }
  return cleaned;
}

function extractTopCommentsFromText(bodyText: string, ownerHandle?: string | null, limit = 70) {
  const lines = (bodyText || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line !== "\xa0");
  const comments: { username: string; text: string; time: string }[] = [];
  const usernameRe = /^[A-Za-z0-9._]{2,30}$/;
  const timeRe = /^(just now|\d+\s*(s|m|h|d|w)|\d+\s*(seconds?|minutes?|hours?|days?|weeks?)\s+ago)$/i;
  const metaRe = /^(reply|see translation|view all|view replies|more posts from|meta|about|blog|jobs|help|api|privacy|terms|locations|popular|instagram lite|meta ai|threads|contact uploading|meta verified|english|\d[\d,.]*\s*[KMB]?\s+likes?)/i;

  let index = 0;
  while (index < lines.length - 2 && comments.length < 5) {
    const username = lines[index];
    const timeText = lines[index + 1];
    if (!usernameRe.test(username) || !timeRe.test(timeText)) {
      index += 1;
      continue;
    }

    const textParts: string[] = [];
    let cursor = index + 2;
    while (cursor < lines.length) {
      if (cursor + 1 < lines.length && usernameRe.test(lines[cursor]) && timeRe.test(lines[cursor + 1])) break;
      if (metaRe.test(lines[cursor])) break;
      textParts.push(lines[cursor]);
      cursor += 1;
    }

    const text = cleanCommentText(textParts.join(" "), limit);
    if (text) {
      if (!ownerHandle || username !== ownerHandle) comments.push({ username, text, time: timeText });
    }
    index = Math.max(cursor, index + 1);
  }

  return comments;
}

async function extractPostStats(page: Page, ownerHandle?: string | null) {
  const raw = await page.evaluate<{
    actionMetrics: {
      likes: string | null;
      comments: string | null;
      likesHidden: boolean;
      commentsHidden: boolean;
    };
    description: string | null;
    thumbnail: string | null;
    bodyText: string;
    embeddedLikes: number[];
    embeddedComments: number[];
    topComments: { username: string; text: string; timestamp?: string }[];
  }>(`
    (() => {
      const countOnlyRe = /^([\\d,.]+(?:\\.\\d+)?)\\s*([KMB])?$/i;
      const visible = (rect) => rect.width > 0 && rect.height > 0;
      const pickMeta = (selector) => {
        const node = document.querySelector(selector);
        return node ? node.getAttribute("content") : null;
      };
      const textRect = (node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect();
      };
      const textNodes = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = (node.nodeValue || "").trim();
        if (!text) continue;
        const rect = textRect(node);
        if (visible(rect)) textNodes.push({ text, rect });
      }
      const firstVisibleIcon = (selector) => Array.from(document.querySelectorAll(selector))
        .map((svg) => ({ svg, rect: svg.getBoundingClientRect() }))
        .filter((item) => visible(item.rect) && item.rect.width >= 20)
        .sort((a, b) => a.rect.top - b.rect.top)[0] || null;
      const mainLike = firstVisibleIcon('svg[aria-label="Like"], svg[aria-label="Unlike"]');
      const mainComment = firstVisibleIcon('svg[aria-label="Comment"]');
      const actionMetrics = {
        likes: null,
        comments: null,
        likesHidden: false,
        commentsHidden: false
      };
      const actionSection = mainLike?.svg.closest("section") || mainComment?.svg.closest("section");
      if (actionSection) {
        const sectionRect = actionSection.getBoundingClientRect();
        const inSection = ({ rect }) => {
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          return centerX >= sectionRect.left - 8 && centerX <= sectionRect.right + 8 &&
            centerY >= sectionRect.top - 8 && centerY <= sectionRect.bottom + 8;
        };
        const countNodes = textNodes.filter((item) => inSection(item) && countOnlyRe.test(item.text));
        const icons = [
          mainLike ? { metric: "likes", rect: mainLike.rect } : null,
          mainComment ? { metric: "comments", rect: mainComment.rect } : null
        ].filter(Boolean);
        const pairings = [];
        for (const icon of icons) {
          const iconX = icon.rect.left + icon.rect.width / 2;
          const iconY = icon.rect.top + icon.rect.height / 2;
          for (let index = 0; index < countNodes.length; index += 1) {
            const node = countNodes[index];
            const nodeX = node.rect.left + node.rect.width / 2;
            const nodeY = node.rect.top + node.rect.height / 2;
            const dx = nodeX - iconX;
            const dy = nodeY - iconY;
            const horizontal = dx >= -8 ? Math.abs(dx) + Math.abs(dy) * 3 : Number.POSITIVE_INFINITY;
            const vertical = dy >= -8 ? Math.abs(dy) + Math.abs(dx) * 3 : Number.POSITIVE_INFINITY;
            pairings.push({ metric: icon.metric, nodeIndex: index, score: Math.min(horizontal, vertical) });
          }
        }
        pairings.sort((a, b) => a.score - b.score);
        const usedMetrics = new Set();
        const usedNodes = new Set();
        for (const pairing of pairings) {
          if (usedMetrics.has(pairing.metric) || usedNodes.has(pairing.nodeIndex)) continue;
          actionMetrics[pairing.metric] = countNodes[pairing.nodeIndex].text;
          usedMetrics.add(pairing.metric);
          usedNodes.add(pairing.nodeIndex);
        }

        const labels = textNodes.filter(inSection).map((item) => item.text.trim());
        const hasAssignedCount = Boolean(actionMetrics.likes || actionMetrics.comments);
        actionMetrics.likesHidden = !actionMetrics.likes && (
          labels.some((text) => /^likes?$/i.test(text)) || Boolean(mainLike && hasAssignedCount)
        );
        actionMetrics.commentsHidden = !actionMetrics.comments && (
          labels.some((text) => /^comments?$/i.test(text)) || Boolean(mainComment && hasAssignedCount)
        );
      }

      const topComments = [];
      const commentTimes = Array.from(document.querySelectorAll("time[datetime]"))
        .filter((time) => {
          const link = time.closest("a[href]");
          return link && link.href.includes("/c/");
        });

      for (const time of commentTimes) {
        const container = time.closest("li") || time.parentElement;
        if (!container) continue;
        const lines = (container.innerText || "").split(/\\n+/).map((line) => line.trim()).filter(Boolean);
        const timeText = (time.innerText || time.textContent || "").trim();
        const timeIndex = lines.findIndex((line) => line === timeText);
        const username = lines.find((line) => /^[A-Za-z0-9._]{2,30}$/.test(line)) || null;
        const ignoreRe = /^(reply|see translation|view replies|view all|likes?|\\d+\\s*(k|m|b)?\\s+likes?)$/i;
        const text = lines
          .slice(Math.max(0, timeIndex + 1))
          .find((line) => !ignoreRe.test(line) && line !== username && line !== timeText) || null;
        if (username && text) {
          topComments.push({
            username,
            text: text.length > 70 ? text.slice(0, 70).trimEnd() + "..." : text,
            timestamp: time.getAttribute("datetime")
          });
        }
        if (topComments.length >= 5) break;
      }

      const embeddedLikes = [];
      const embeddedComments = [];
      const shortcode = window.location.pathname.match(/\\/(?:p|reel)\\/([^/]+)/i)?.[1] || "";
      const addMetric = (target, value) => {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0) target.push(number);
      };
      const visitMedia = (node, depth = 0) => {
        if (!node || typeof node !== "object" || depth > 60) return;
        const code = String(node.code || node.shortcode || "");
        if (shortcode && code === shortcode) {
          addMetric(embeddedLikes, node.like_count);
          addMetric(embeddedComments, node.comment_count);
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach((item) => visitMedia(item, depth + 1));
          else if (value && typeof value === "object") visitMedia(value, depth + 1);
        }
      };
      for (const script of Array.from(document.scripts)) {
        const text = script.textContent || "";
        if (!shortcode || !text.includes(shortcode)) continue;
        try {
          visitMedia(JSON.parse(text));
        } catch {
          const shortcodeIndex = text.indexOf(shortcode);
          const nearby = text.slice(Math.max(0, shortcodeIndex - 6000), shortcodeIndex + 12000);
          for (const match of nearby.matchAll(/"(like_count|comment_count)"\\s*:\\s*(\\d+)/g)) {
            if (match[1] === "like_count") addMetric(embeddedLikes, match[2]);
            else addMetric(embeddedComments, match[2]);
          }
        }
      }

      return {
        actionMetrics,
        description: pickMeta('meta[property="og:description"]'),
        thumbnail: pickMeta('meta[property="og:image"]'),
        bodyText: document.body ? document.body.innerText || "" : "",
        embeddedLikes,
        embeddedComments,
        topComments
      };
    })()
  `);

  let likes = raw.embeddedLikes?.length ? Math.max(...raw.embeddedLikes) : null;
  let commentsCount = raw.embeddedComments?.length ? Math.max(...raw.embeddedComments) : null;
  if (likes === null) likes = parseCount(raw.actionMetrics?.likes);
  if (commentsCount === null) commentsCount = parseCount(raw.actionMetrics?.comments);
  if (likes === null) likes = firstCountFromPatterns(raw.description, [/([\d,.]+)\s*([KMB]?)\s+likes?/i]);
  if (commentsCount === null) commentsCount = firstCountFromPatterns(raw.description, [/([\d,.]+)\s*([KMB]?)\s+comments?/i]);
  const likesHidden = likes === null && Boolean(raw.actionMetrics?.likesHidden);
  const commentsHidden = commentsCount === null && Boolean(raw.actionMetrics?.commentsHidden);
  const views = firstCountFromPatterns(raw.bodyText, [
    /(?:^|\n)\s*([\d,.]+(?:\.\d+)?)\s*([KMB]?)\s+views?\s*(?:\n|$)/im,
    /(?:^|\n)\s*([\d,.]+(?:\.\d+)?)\s*([KMB]?)\s+plays?\s*(?:\n|$)/im
  ]);
  const viewPatterns = [
    /([\d,.]+(?:\.\d+)?)\s*([KMB]?)\s+views?/i,
    /([\d,.]+(?:\.\d+)?)\s*([KMB]?)\s+plays?/i
  ];
  const viewsDisplay = firstMetricDisplay(raw.bodyText, viewPatterns) ||
    (views === null ? null : views.toLocaleString("en-US"));

  let topComments = cleanTopComments(raw.topComments || [], ownerHandle);
  if (!topComments.length) topComments = extractTopCommentsFromText(raw.bodyText, ownerHandle);

  return {
    likes,
    likes_hidden: likesHidden,
    comments_count: commentsCount,
    comments_hidden: commentsHidden,
    views,
    views_display: viewsDisplay,
    thumbnail_url: raw.thumbnail,
    top_comments: topComments
  };
}

async function extractPostUrlAndTimestamp(page: Page, fallbackUrl?: string | null) {
  const sourceUrl = fallbackUrl || page.url();
  const shortcode = sourceUrl.match(/\/(?:p|reel)\/([^/?#]+)/)?.[1] || null;
  const meta = await page.evaluate<{ href: string | null; timestamp: string | null }>(`
    (() => {
      const shortcode = ${JSON.stringify(shortcode)};
      const times = Array.from(document.querySelectorAll("time[datetime]")).map((time) => {
        const link = time.closest("a[href]");
        return {
          datetime: time.getAttribute("datetime"),
          text: time.innerText || time.textContent || "",
          href: link ? link.href : ""
        };
      });
      const nonCommentTimes = times.filter((item) => {
        if (!item.datetime) return false;
        if (item.href.includes("/c/")) return false;
        if (!shortcode) return true;
        return !item.href || item.href.includes(shortcode);
      });
      const noHref = nonCommentTimes.find((item) => !item.href);
      const exactHref = nonCommentTimes.find((item) => item.href && (!shortcode || item.href.includes(shortcode)));
      const bestTime = noHref || exactHref || nonCommentTimes[0] || null;
      return {
        href: exactHref ? exactHref.href : window.location.href,
        timestamp: bestTime ? bestTime.datetime : null
      };
    })()
  `);
  return {
    postUrl: normalizePostUrl(meta.href) || normalizePostUrl(fallbackUrl),
    timestamp: meta.timestamp
  };
}

async function extractPostMeta(page: Page, fallbackUrl?: string | null): Promise<Candidate> {
  const data: Candidate = {
    post_url: fallbackUrl || undefined,
    username: null,
    display_name: null,
    profile_url: null,
    follower_count: null,
    follower_count_display: null,
    likes: null,
    likes_hidden: false,
    comments_count: null,
    comments_hidden: false,
    views: null,
    thumbnail_url: null,
    top_comments: [],
    timestamp: null,
    caption: null,
    _handle: null
  };

  try {
    await dismissInstagramPrompts(page);
    const snapshot = await snapshotPage(page);
    const snapshotUsername = usernameFromSnapshot(snapshot);
    if (snapshotUsername) {
      data._handle = snapshotUsername;
      data.username = snapshotUsername;
      data.profile_url = `${instagramHost}/${snapshotUsername}/`;
    }
    data.thumbnail_url = snapshot.ogImage;
    data.caption = captionFromSnapshot(snapshot);
    data.likes = parseMetric(snapshot.description, "likes");
    data.comments_count = parseMetric(snapshot.description, "comments");

    const handleElem = await page.$('article header a[href^="/"]');
    if (handleElem) {
      const href = await handleElem.getAttribute("href");
      const handle = href ? href.split("?")[0].replace(/^\/+|\/+$/g, "").split("/", 1)[0] : null;
      if (handle) {
        data._handle = handle;
        data.username = handle;
        data.profile_url = `${instagramHost}/${handle}/`;
      }
    }

    const { postUrl, timestamp } = await extractPostUrlAndTimestamp(page, fallbackUrl);
    if (postUrl) {
      data.post_url = postUrl;
      if (!data._handle) {
        const handleMatch = postUrl.match(/instagram\.com\/([^/]+)\/(?:p|reel)\//);
        if (handleMatch) {
          data._handle = handleMatch[1];
          data.username = handleMatch[1];
          data.profile_url = `${instagramHost}/${handleMatch[1]}/`;
        }
      }
    }
    if (timestamp || snapshot.time) data.timestamp = timestamp || snapshot.time;
  } catch (error) {
    console.warn(`Extraction error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return data;
}

async function getProfileInfo(handle: string, context: BrowserContext) {
  const page = await context.newPage();
  try {
    await sleep(200 + Math.random() * 250);
    await gotoPublicPage(page, `${instagramHost}/${handle}/`, 15_000);
    await sleep(500);
    await dismissInstagramPrompts(page);

    let displayName: string | null = null;
    const titleMeta = await page.$('meta[property="og:title"]');
    const title = titleMeta ? await titleMeta.getAttribute("content") : null;
    if (title) {
      displayName = title.match(/^(.*?)\s*\(@/)?.[1]?.trim() || title.replace(/\s*-\s*Instagram.*$/i, "").trim();
      if (displayName.toLowerCase() === handle.toLowerCase()) displayName = null;
    }
    if (!displayName) {
      for (const selector of ["section header h2, section header h1", "section header span.x1lliihq"]) {
        const element = await page.$(selector);
        if (element) {
          displayName = (await element.innerText()).trim();
          if (displayName) break;
        }
      }
    }
    if (!displayName) displayName = handle;

    let followerCount: number | null = null;
    let followerCountDisplay: string | null = null;
    const captureFollowerDisplay = (match: RegExpMatchArray | null | undefined) => {
      if (!match) return false;
      const display = `${match[1]}${(match[2] || "").toUpperCase()}`.replace(/\s+/g, "");
      const parsed = parseCount(display);
      if (parsed === null || parsed <= 0) return false;
      if (followerCount === null) followerCount = parsed;
      followerCountDisplay = display;
      return true;
    };

    const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    captureFollowerDisplay(bodyText.match(/([\d,.]+)\s*([KMB]?)\s*followers?/i));

    const liveProfile = await page.evaluate<{
      followerCount: number | null;
      displayName: string | null;
    }>(`
      (async () => {
        const response = await fetch(
          "/api/v1/users/web_profile_info/?username=" + encodeURIComponent(${JSON.stringify(handle)}) + "&_=" + Date.now(),
          {
            cache: "no-store",
            headers: {
              "cache-control": "no-cache",
              "pragma": "no-cache",
              "x-ig-app-id": "936619743392459",
              "x-requested-with": "XMLHttpRequest"
            }
          }
        );
        if (!response.ok) return { followerCount: null, displayName: null };
        const payload = await response.json();
        const user = payload && payload.data && payload.data.user;
        const count = Number(user && user.edge_followed_by && user.edge_followed_by.count);
        return {
          followerCount: Number.isFinite(count) && count >= 0 ? Math.trunc(count) : null,
          displayName: user && user.full_name || null
        };
      })()
    `).catch(() => ({ followerCount: null, displayName: null }));
    if (liveProfile.followerCount !== null) followerCount = liveProfile.followerCount;
    if (liveProfile.displayName) displayName = liveProfile.displayName;

    if (!followerCountDisplay) {
      const meta = await page.$('meta[property="og:description"], meta[name="description"]');
      const content = meta ? await meta.getAttribute("content") : null;
      captureFollowerDisplay(content?.match(/([\d,.]+)\s*([KMB]?)\s*followers?/i));
    }
    if (!followerCountDisplay && followerCount !== null) {
      followerCountDisplay = followerCount.toLocaleString("en-US");
    }

    return { followerCount, followerCountDisplay, displayName };
  } catch (error) {
    console.warn(`Profile error for ${handle}: ${error instanceof Error ? error.message : String(error)}`);
    return { followerCount: null, followerCountDisplay: null, displayName: handle };
  } finally {
    await page.close();
  }
}

async function scrapePublicBrowser(
  browser: Browser,
  normalized: NormalizedQuery,
  requestedQuery: string,
  maxResults: number,
  candidateCount: number,
  range: ScrapeRange,
  sortBy: "recent" | "engagement",
  timezoneOffsetMinutes = 0
): Promise<ScrapeResult> {
  const { context, page } = await createPage(browser);
  try {
    const discoveryQuery = normalized.mode === "post"
      ? normalized.postUrl || normalized.startUrl
      : requestedQuery;
    const recentCandidates: Candidate[] = [];
    const searchCandidates: Candidate[] = [];
    const visualCandidates: Candidate[] = [];

    if (normalized.mode === "hashtag" && normalized.tag) {
      searchCandidates.push(...await collectRecentSearchCandidates(normalized.tag, candidateCount, range));
    }

    if (sortBy === "engagement" && normalized.mode === "profile") {
      const reelsPage = await context.newPage();
      try {
        const perGridLimit = Math.max(12, Math.ceil(candidateCount / 2));
        const [profileCandidates, reelCandidates] = await Promise.all([
          collectLatestCandidates(page, discoveryQuery, perGridLimit, maxResults),
          collectLatestCandidates(reelsPage, discoveryQuery, perGridLimit, maxResults, true)
        ]);
        visualCandidates.push(...profileCandidates, ...reelCandidates);
      } finally {
        await reelsPage.close().catch(() => {});
      }
    } else {
      visualCandidates.push(...await collectLatestCandidates(page, discoveryQuery, candidateCount, maxResults));
    }

    if (normalized.mode === "profile" && normalized.username) {
      const desiredCandidates = Math.min(candidateCount, Math.max(maxResults * 2, 12));
      if (process.env.SERVERLESS === "true" || visualCandidates.length < desiredCandidates) {
        visualCandidates.push(...await collectPublicProfileFeedCandidates(
          page,
          normalized.username,
          candidateCount,
          range
        ));
      }
    }

    if (normalized.mode === "hashtag" && normalized.tag) {
      const recentPage = await context.newPage();
      try {
        for (const candidate of await collectRecentPublicHashtagCandidates(recentPage, normalized.tag, candidateCount, range)) {
          if (candidate.post_url) recentCandidates.push(candidate);
        }
      } finally {
        await recentPage.close().catch(() => {});
      }
    }
    if (process.env.INSTAGRAM_SCRAPER_DEBUG === "1") {
      console.log(JSON.stringify({
        sourceCounts: {
          mode: normalized.mode,
          tag: normalized.tag || null,
          search: searchCandidates.length,
          recent: recentCandidates.length,
          visual: visualCandidates.length
        },
        searchSample: searchCandidates.slice(0, 5).map((item) => ({
          post_url: item.post_url,
          source: item._source
        })),
        recentSample: recentCandidates.slice(0, 5).map((item) => ({
          post_url: item.post_url,
          username: item.username,
          timestamp: item.timestamp
        })),
        visualSample: visualCandidates.slice(0, 5).map((item) => ({
          post_url: item.post_url,
          username: item.username,
          source: item._source,
          views: item.views,
          views_verified: item._views_verified
        }))
      }, null, 2));
    }

    const candidates: Candidate[] = [];
    const candidateByIdentity = new Map<string, Candidate>();
    const addCandidate = (candidate: Candidate | undefined) => {
      if (!candidate?.post_url) return;
      if (!candidate.timestamp) candidate.timestamp = timestampFromPostUrl(candidate.post_url);
      const identity = postIdentity(candidate.post_url);
      const existing = candidateByIdentity.get(identity);
      if (existing) {
        mergeCandidateData(existing, candidate);
        return;
      }
      candidateByIdentity.set(identity, candidate);
      candidates.push(candidate);
    };

    if (normalized.mode === "hashtag") {
      const searchLimit = Math.max(maxResults * 4, 20);
      const visualLimit = Math.max(maxResults * 2, 12);
      const recentLimit = Math.max(maxResults * 3, 18);
      const maxMixed = Math.max(searchLimit, visualLimit, recentLimit);
      for (let index = 0; index < maxMixed; index += 1) {
        if (index < searchLimit) addCandidate(searchCandidates[index]);
        if (index < recentLimit) addCandidate(recentCandidates[index]);
        if (index < visualLimit) addCandidate(visualCandidates[index]);
      }
    } else {
      for (const candidate of visualCandidates.slice(0, candidateCount)) addCandidate(candidate);
    }

    if (sortBy === "engagement" && normalized.mode === "profile" && normalized.username) {
      await verifyPublicProfileReelViews(page, normalized.username, candidates);
    }

    const candidatesInRange = candidates
      .filter((candidate) => timestampInRange(candidate.timestamp, range))
      .sort((a, b) => {
        if (sortBy === "engagement") {
          const byViews = (b._views_verified ? b.views ?? -1 : -1) -
            (a._views_verified ? a.views ?? -1 : -1);
          if (byViews) return byViews;
        }
        const byTime = timestampValue(a.timestamp) - timestampValue(b.timestamp);
        return range.direction === "ascending" ? byTime : -byTime;
      });
    if (!candidatesInRange.length) return { query: normalized.label, results: [] };

    await page.close().catch(() => {});

    const poolLimit = sortBy === "engagement"
      ? candidateCount
      : normalized.mode === "hashtag"
        ? Math.max(maxResults * 2, maxResults + 6)
        : Math.max(maxResults * 3, 12);
    const candidatePool = candidatesInRange.slice(
      0,
      normalized.mode === "post"
        ? 1
        : Math.min(candidatesInRange.length, poolLimit)
    );
    const extractionConcurrency = normalized.mode === "post" ? 1 : 3;
    const extractCandidate = async (candidate: Candidate) => {
      const postPage = await context.newPage();
      try {
        const postUrl = candidate.post_url;
        if (!postUrl) return null;
        if (!timestampInRange(candidate.timestamp, range)) return null;

        await gotoPublicPage(postPage, postUrl, 30_000);
        await waitForOpenPost(postPage);
        const data = await extractPostMeta(postPage, postUrl);
        const target = data as Record<string, unknown>;
        for (const [key, value] of Object.entries(candidate) as [keyof Candidate, unknown][]) {
          const emptyArray = Array.isArray(value) && value.length === 0;
          if (value == null || value === "" || emptyArray) continue;
          if (key === "post_url") target[key] = value;
          else if (key === "timestamp" && !data.timestamp) target[key] = value;
          else if (key === "_handle" && !data._handle) data._handle = value as string;
          else if (target[key] == null || target[key] === "") target[key] = value;
        }

        if (!timestampInRange(data.timestamp, range)) return null;

        const stats = await extractPostStats(postPage, data._handle || data.username);
        data.top_comments = stats.top_comments;
        data.likes = stats.likes;
        data.likes_hidden = stats.likes === null && stats.likes_hidden;
        data.comments_count = stats.comments_count;
        data.comments_hidden = stats.comments_count === null && stats.comments_hidden;
        if (stats.views !== null) {
          data.views = stats.views;
          data.views_display = stats.views_display;
          data._views_verified = true;
        } else if (!data._views_verified) {
          data.views = null;
          data.views_display = null;
        }
        if (stats.thumbnail_url) data.thumbnail_url = stats.thumbnail_url;

        if (normalized.mode === "hashtag" && normalized.tag && !postMatchesTag(data, normalized.tag)) return null;
        if (normalized.mode === "profile" && normalized.username) {
          const extractedHandle = cleanText(data._handle || data.username).toLowerCase();
          if (extractedHandle !== normalized.username.toLowerCase()) return null;
        }

        return data.post_url ? data : null;
      } finally {
        await postPage.close().catch(() => {});
      }
    };
    const extracted = sortBy === "engagement"
      ? (await mapWithConcurrency(candidatePool, extractionConcurrency, extractCandidate))
        .filter((item): item is Candidate => Boolean(item?.post_url))
      : await mapUntilValidCount(candidatePool, extractionConcurrency, maxResults, extractCandidate);

    const handles = [...new Set(extracted.map((item) => item._handle || item.username).filter(Boolean) as string[])];
    const profileEntries = await mapWithConcurrency(handles, 3, async (handle) => {
      return [handle, await getProfileInfo(handle, context)] as const;
    });
    const profileCache = new Map<string, {
      followerCount: number | null;
      followerCountDisplay: string | null;
      displayName: string | null;
    }>();
    for (const entry of profileEntries) {
      if (entry) profileCache.set(entry[0], entry[1]);
    }

    const results: InstagramPost[] = extracted.map((data) => {
      const handle = data._handle || data.username;
      if (handle) {
        const profile = profileCache.get(handle);
        if (profile) {
          if (profile.followerCount !== null) data.follower_count = profile.followerCount;
          if (profile.followerCountDisplay) data.follower_count_display = profile.followerCountDisplay;
          data.display_name = profile.displayName || data.display_name || handle;
          data.profile_url = `${instagramHost}/${handle}/`;
        }
      }
      const post: InstagramPost = {
        username: data.username ?? handle ?? null,
        display_name: data.display_name ?? data.username ?? handle ?? null,
        profile_url: data.profile_url ?? null,
        post_url: data.post_url as string,
        thumbnail_url: data.thumbnail_url ?? null,
        comments_count: data.comments_count ?? null,
        comments_hidden: data.comments_hidden ?? false,
        likes: data.likes ?? null,
        likes_hidden: data.likes_hidden ?? false,
        views: sortBy === "engagement" ? data.views ?? null : null,
        views_display: sortBy === "engagement" ? data.views_display ?? null : null,
        follower_count: data.follower_count ?? null,
        follower_count_display: data.follower_count_display ?? null,
        engagement_score: null,
        engagement_rate: null,
        top_comments: data.top_comments || [],
        timestamp: data.timestamp ?? null,
        caption: data.caption ?? null
      };
      if (sortBy === "engagement") {
        const engagement = engagementValues(post);
        post.engagement_score = engagement.score;
        post.engagement_rate = engagement.rate;
      }
      return post;
    });

    const seenResults = new Set<string>();
    const sorted = results
      .filter((item) => timestampInRange(item.timestamp, range))
      .filter((item) => {
        const identity = postIdentity(item.post_url);
        if (seenResults.has(identity)) return false;
        seenResults.add(identity);
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "engagement") {
          const byViews = (b.views ?? -1) - (a.views ?? -1);
          if (byViews) return byViews;
        }
        const byTime = timestampValue(b.timestamp) - timestampValue(a.timestamp);
        const byPost = postOrderValue(b.post_url) - postOrderValue(a.post_url);
        return range.direction === "ascending" ? -byTime || -byPost : byTime || byPost;
      });
    const analysis = sortBy === "engagement"
      ? buildProfileAnalysis(results, maxResults, timezoneOffsetMinutes)
      : undefined;
    return {
      query: normalized.label,
      results: analysis
        ? (analysis.top_watched.length ? analysis.top_watched : analysis.top_liked)
        : normalized.mode === "hashtag" && sortBy === "recent"
          ? selectDiverseResults(sorted, maxResults, range.start, range.start)
          : sorted.slice(0, maxResults),
      analysis
    };
  } finally {
    await context.close();
  }
}

export async function runInstagramScrape(input: InstagramScrapeInput) {
  let normalized = normalizeQuery(input.query);
  const maxResults = Math.max(1, Math.min(50, Number(input.maxResults) || 10));
  const collectionMode = input.collectionMode || (input.rangeFrom || input.rangeTo ? "range" : "latest");

  if (normalized.mode === "keyword") {
    const tag = input.query.replace(/^#+/, "").replace(/[^A-Za-z0-9_]/g, "");
    if (!tag) throw new Error("Enter a profile, hashtag, or Instagram URL.");
    normalized = {
      mode: "hashtag",
      label: `#${tag}`,
      startUrl: `${instagramHost}/explore/tags/${encodeURIComponent(tag)}/`,
      tag
    };
  }
  if (normalized.mode === "hashtag" && collectionMode === "engagement") {
    throw new Error("Profile analysis is available only for Profile and URL.");
  }

  const effectiveInput = { ...input, collectionMode };
  const range = scrapeRangeFromInput(effectiveInput);
  const sortBy = collectionMode === "engagement" ? "engagement" : "recent";

  const browser = await launchBrowser();
  try {
    let discoveryQuery = input.query;
    if (normalized.mode === "post" && collectionMode === "engagement") {
      const postResult = await scrapePublicBrowser(
        browser,
        normalized,
        input.query,
        1,
        1,
        { ...range, collectionMode: "latest" },
        "recent",
        input.timezoneOffsetMinutes
      );
      const handle = postResult.results[0]?.username;
      if (!handle) throw new Error("The public post did not expose its profile username.");
      normalized = {
        mode: "profile",
        label: `@${handle}`,
        startUrl: `${instagramHost}/${handle}/`,
        username: handle
      };
      discoveryQuery = `@${handle}`;
    }

    const needsDeepHistory = range.end.getTime() < Date.now() - 31 * 86_400_000 || range.direction === "ascending";
    const candidateCount = normalized.mode === "post"
      ? 1
      : sortBy === "engagement"
        ? 60
        : needsDeepHistory
          ? 150
        : normalized.mode === "profile"
          ? Math.min(Math.max(maxResults * 3, 12), 150)
          : Math.min(Math.max(maxResults * 6, 20), 150);
    return await scrapePublicBrowser(
      browser,
      normalized,
      discoveryQuery,
      maxResults,
      candidateCount,
      range,
      sortBy,
      input.timezoneOffsetMinutes
    );
  } finally {
    await browser.close();
  }
}

export const instagramServiceInfo = {
  serviceRoot,
  dataDir: path.join(serviceRoot, "data"),
  platform: `${os.platform()}-${os.arch()}`
};
