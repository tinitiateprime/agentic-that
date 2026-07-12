import chromiumPack from "@sparticuz/chromium";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright-core";

export type InstagramScrapeInput = {
  query: string;
  maxResults?: number;
  recentDays?: number;
  onlyPostsNewerThan?: string;
  autoExpandDays?: boolean | string;
  maxAutoExpandDays?: number;
};

export type InstagramPost = {
  username: string | null;
  display_name: string | null;
  profile_url?: string | null;
  post_url: string;
  thumbnail_url: string | null;
  comments_count: number | null;
  likes: number | null;
  follower_count: number | null;
  top_comments: { username: string; text: string; timestamp?: string; time?: string }[];
  timestamp: string | null;
  caption: string | null;
};

type NormalizedQuery = {
  mode: "profile" | "hashtag" | "post" | "keyword";
  label: string;
  startUrl: string;
  postUrl?: string;
  tag?: string;
};

type Candidate = Partial<InstagramPost> & {
  _handle?: string | null;
};

type DirectInstagramPost = InstagramPost & {
  _profileId?: string | null;
};

type ScrapeResult = {
  query: string;
  results: InstagramPost[];
};

type ProfileInfo = {
  username: string | null;
  displayName: string | null;
  followerCount: number | null;
};

type DirectProfileInfo = {
  username: string;
  profileId: string | null;
  displayName: string | null;
  followerCount: number | null;
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

type InstagramSession = {
  name: string;
  storageState?: BrowserContextOptions["storageState"];
  expiresAt: number;
  nearExpiry: boolean;
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
const defaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const sessionExpiryBufferDays = Math.max(1, Number(process.env.INSTAGRAM_SESSION_EXPIRY_BUFFER_DAYS) || 7);
let sessionCursor = 0;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const isServerlessRuntime = () => process.env.NETLIFY === "true" || process.env.SERVERLESS === "true";

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
      return { mode: "profile", label: `@${username}`, startUrl: `${instagramHost}/${username}/` };
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
    return { mode: "profile", label: `@${username}`, startUrl: `${instagramHost}/${username}/` };
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

async function readJsonFile(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function sessionExpiry(storageState: BrowserContextOptions["storageState"]) {
  if (!storageState || typeof storageState !== "object" || !("cookies" in storageState)) return 0;
  const cookies = Array.isArray(storageState.cookies) ? storageState.cookies : [];
  const nowSeconds = Date.now() / 1000;
  const sessionCookie = cookies.find((cookie) => (
    cookie.name === "sessionid" &&
    String(cookie.domain || "").includes("instagram") &&
    Number(cookie.expires) > nowSeconds
  ));
  if (sessionCookie) return Number(sessionCookie.expires) * 1000;

  const expiries = cookies
    .map((cookie) => Number(cookie.expires))
    .filter((expires) => expires > nowSeconds)
    .sort((a, b) => b - a);
  return expiries[0] ? expiries[0] * 1000 : 0;
}

function makeSession(name: string, storageState: BrowserContextOptions["storageState"]): InstagramSession {
  const expiresAt = sessionExpiry(storageState);
  const nearExpiry = expiresAt > 0 && expiresAt - Date.now() < sessionExpiryBufferDays * 24 * 60 * 60 * 1000;
  return { name, storageState, expiresAt, nearExpiry };
}

function addJsonSession(sessions: InstagramSession[], name: string, value?: string) {
  const text = value?.trim();
  if (!text) return;
  sessions.push(makeSession(name, JSON.parse(text) as BrowserContextOptions["storageState"]));
}

function addBase64Session(sessions: InstagramSession[], name: string, value?: string) {
  const text = value?.trim();
  if (!text) return;
  addJsonSession(sessions, name, Buffer.from(text, "base64").toString("utf8"));
}

function instagramCookies(session: InstagramSession) {
  const state = session.storageState;
  if (!state || typeof state !== "object" || !("cookies" in state)) return [];
  const cookies = Array.isArray(state.cookies) ? state.cookies : [];
  return cookies.filter((cookie) => String(cookie.domain || "").includes("instagram"));
}

function instagramCookieHeader(session: InstagramSession) {
  const cookies = instagramCookies(session);
  if (!cookies.some((cookie) => cookie.name === "sessionid")) return "";
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function instagramCsrfToken(session: InstagramSession) {
  return instagramCookies(session).find((cookie) => cookie.name === "csrftoken")?.value || "";
}

async function instagramApiJson<T>(session: InstagramSession, url: string, init: RequestInit = {}) {
  const cookie = instagramCookieHeader(session);
  if (!cookie) throw new Error("Instagram session cookie is missing.");

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set("user-agent", defaultUserAgent);
    headers.set("accept", "*/*");
    headers.set("accept-language", "en-US,en;q=0.9");
    headers.set("cache-control", "no-cache");
    headers.set("pragma", "no-cache");
    headers.set("cookie", cookie);
    headers.set("x-asbd-id", "129477");
    headers.set("x-ig-app-id", "936619743392459");
    headers.set("x-requested-with", "XMLHttpRequest");
    const csrf = instagramCsrfToken(session);
    if (csrf) headers.set("x-csrftoken", csrf);
    if (init.method && init.method !== "GET") headers.set("origin", instagramHost);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: init.signal || AbortSignal.timeout(8_000)
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Instagram API returned ${response.status}.`);

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error("Instagram API returned an unreadable response.");
      }
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /Instagram API returned (400|401|403|404|429)/.test(error.message)) break;
      await sleep(500);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Instagram API request failed.");
}

async function loadLocalSessions() {
  const configuredPath = process.env.INSTAGRAM_STORAGE_STATE_PATH?.trim();
  if (configuredPath && existsSync(configuredPath)) {
    const value = await readJsonFile(configuredPath) as BrowserContextOptions["storageState"];
    return value ? [makeSession(path.basename(configuredPath, path.extname(configuredPath)), value)] : [];
  }

  const sessionsDir = process.env.INSTAGRAM_STORAGE_STATE_DIR?.trim() || path.join(serviceRoot, "account_config", "sessions");
  if (!existsSync(sessionsDir)) return [];

  const sessions: InstagramSession[] = [];
  const files = (await readdir(sessionsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  for (const file of files) {
    const filePath = path.join(sessionsDir, file);
    const value = await readJsonFile(filePath) as BrowserContextOptions["storageState"];
    if (value) sessions.push(makeSession(path.basename(file, ".json"), value));
  }

  return sessions;
}

async function loadStorageSessions() {
  const sessions: InstagramSession[] = [];

  addJsonSession(sessions, "env-json", process.env.INSTAGRAM_STORAGE_STATE_JSON);
  addBase64Session(sessions, "env-base64", process.env.INSTAGRAM_STORAGE_STATE_BASE64);

  const jsonPool = process.env.INSTAGRAM_STORAGE_STATES_JSON?.trim();
  if (jsonPool) {
    const parsed = JSON.parse(jsonPool) as unknown;
    if (Array.isArray(parsed)) {
      parsed.forEach((item, index) => sessions.push(makeSession(`env-json-${index + 1}`, item as BrowserContextOptions["storageState"])));
    } else if (parsed && typeof parsed === "object") {
      Object.entries(parsed).forEach(([name, item]) => sessions.push(makeSession(name, item as BrowserContextOptions["storageState"])));
    }
  }

  const base64Pool = process.env.INSTAGRAM_STORAGE_STATES_BASE64?.trim();
  if (base64Pool) {
    base64Pool
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item, index) => addBase64Session(sessions, `env-base64-${index + 1}`, item));
  }

  for (let index = 1; index <= 10; index += 1) {
    addJsonSession(sessions, `env-json-${index}`, process.env[`INSTAGRAM_STORAGE_STATE_JSON_${index}`]);
    addBase64Session(sessions, `env-base64-${index}`, process.env[`INSTAGRAM_STORAGE_STATE_BASE64_${index}`]);
  }

  sessions.push(...await loadLocalSessions());
  return sessions;
}

function orderedSessions(sessions: InstagramSession[]) {
  const active = sessions.filter((session) => !session.nearExpiry);
  const nearExpiry = sessions.filter((session) => session.nearExpiry);
  const pool = [...active, ...nearExpiry];
  if (pool.length === 0) return [{ name: "public", expiresAt: 0, nearExpiry: false } satisfies InstagramSession];

  const start = sessionCursor % pool.length;
  sessionCursor = (sessionCursor + 1) % pool.length;
  return [...pool.slice(start), ...pool.slice(0, start)];
}

export async function getInstagramSessionPoolInfo() {
  const sessions = await loadStorageSessions();
  return {
    count: sessions.length,
    expiryBufferDays: sessionExpiryBufferDays,
    sessions: sessions.map((session, index) => ({
      id: index + 1,
      name: session.name,
      nearExpiry: session.nearExpiry,
      expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null
    }))
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

async function createPage(browser: Browser, session: InstagramSession) {
  const contextOptions: BrowserContextOptions = {
    locale: "en-US",
    userAgent: defaultUserAgent,
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" }
  };
  if (session.storageState) contextOptions.storageState = session.storageState;
  const context = await browser.newContext(contextOptions);
  return { context, page: await context.newPage() };
}

async function collectPostLinks(page: Page, targetCount: number) {
  const links = new Set<string>();

  for (let attempt = 0; attempt < 7 && links.size < targetCount; attempt += 1) {
    await page.waitForTimeout(attempt === 0 ? 2500 : 1100);
    const found = await page.evaluate<string[]>(`
      Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'))
        .map((anchor) => anchor.getAttribute("href") || "")
        .filter(Boolean)
    `);

    for (const href of found) {
      const url = new URL(href, "https://www.instagram.com");
      if (/^\/(?:p|reel)\//i.test(url.pathname)) {
        links.add(`${url.origin}${url.pathname.replace(/\/?$/, "/")}`);
      }
    }

    await page.evaluate("window.scrollBy(0, Math.max(document.body.scrollHeight, 900))");
  }

  return [...links].slice(0, targetCount);
}

function apiMediaThumbnail(media: Record<string, unknown>): string | null {
  const imageVersions = media.image_versions2 as { candidates?: { url?: string }[] } | undefined;
  const candidate = imageVersions?.candidates?.[0]?.url;
  if (candidate) return candidate;

  const carousel = media.carousel_media as Record<string, unknown>[] | undefined;
  return carousel?.[0] ? apiMediaThumbnail(carousel[0]) : null;
}

function apiTopComments(media: Record<string, unknown>) {
  const comments = [
    ...(
      Array.isArray(media.preview_comments)
        ? media.preview_comments as Record<string, unknown>[]
        : []
    ),
    ...(
      Array.isArray(media.comments)
        ? media.comments as Record<string, unknown>[]
        : []
    )
  ];

  return cleanTopComments(comments.map((comment) => {
    const user = comment.user && typeof comment.user === "object" ? comment.user as Record<string, unknown> : {};
    const createdAt = Number(comment.created_at || comment.created_at_utc);
    return {
      username: cleanText(user.username || comment.username),
      text: cleanText(comment.text),
      timestamp: Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt * 1000).toISOString() : undefined
    };
  }));
}

function apiMediaToPost(media: Record<string, unknown>): DirectInstagramPost | null {
  const code = cleanText(media.code);
  const takenAt = Number(media.taken_at);
  if (!code || !Number.isFinite(takenAt)) return null;

  const user = media.user && typeof media.user === "object" ? media.user as Record<string, unknown> : {};
  const username = cleanText(user.username) || null;
  const profileId = cleanText(user.pk_id || user.pk || user.id) || null;
  const mediaType = Number(media.media_type);
  const productType = cleanText(media.product_type);
  const pathType = mediaType === 2 || productType === "clips" ? "reel" : "p";

  return {
    username,
    display_name: cleanText(user.full_name) || username,
    post_url: `${instagramHost}/${pathType}/${code}/`,
    thumbnail_url: apiMediaThumbnail(media),
    comments_count: Number.isFinite(Number(media.comment_count)) ? Number(media.comment_count) : null,
    likes: Number.isFinite(Number(media.like_count)) ? Number(media.like_count) : null,
    follower_count: Number.isFinite(Number(user.follower_count)) ? Number(user.follower_count) : null,
    top_comments: apiTopComments(media),
    timestamp: new Date(takenAt * 1000).toISOString(),
    caption: cleanText((media.caption as Record<string, unknown> | undefined)?.text) || null,
    _profileId: profileId
  };
}

function apiMediasFromPayload(payload: unknown) {
  const medias: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const media = record.media;
    if (media && typeof media === "object" && cleanText((media as Record<string, unknown>).code)) {
      medias.push(media as Record<string, unknown>);
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(payload);
  return medias;
}

async function collectDirectHashtagApiPosts(session: InstagramSession, tag: string, limit: number, cutoff: Date) {
  const posts: DirectInstagramPost[] = [];
  const seen = new Set<string>();
  let maxId = "";

  for (let pageIndex = 0; pageIndex < 4 && posts.length < limit; pageIndex += 1) {
    const body = new URLSearchParams({
      include_persistent: "0",
      max_id: maxId,
      page: "1",
      surface: "grid",
      tab: "recent"
    });

    const payload = await instagramApiJson<{ more_available?: boolean; next_max_id?: string }>(
      session,
      `${instagramHost}/api/v1/tags/${encodeURIComponent(tag)}/sections/`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "referer": `${instagramHost}/explore/tags/${encodeURIComponent(tag)}/?hl=en`
        },
        body
      }
    );

    const medias = apiMediasFromPayload(payload);
    if (!medias.length) break;

    for (const media of medias) {
      const post = apiMediaToPost(media);
      if (!post || seen.has(post.post_url)) continue;
      if (post.timestamp && timestampValue(post.timestamp) < cutoff.getTime()) continue;
      seen.add(post.post_url);
      posts.push(post);
      if (posts.length >= limit) break;
    }

    maxId = cleanText(payload.next_max_id);
    if (!payload.more_available || !maxId) break;
  }

  return posts;
}

function profileInfoFromApiUser(user: Record<string, unknown> | undefined, username: string): DirectProfileInfo | null {
  if (!user) return null;
  const followedBy = user.edge_followed_by && typeof user.edge_followed_by === "object"
    ? user.edge_followed_by as Record<string, unknown>
    : {};
  const directFollowerCount = Number(user.follower_count);
  const edgeFollowerCount = Number(followedBy.count);
  return {
    username: cleanText(user.username) || username,
    profileId: cleanText(user.pk_id || user.pk || user.id) || null,
    followerCount: Number.isFinite(directFollowerCount)
      ? directFollowerCount
      : Number.isFinite(edgeFollowerCount)
        ? edgeFollowerCount
        : null,
    displayName: cleanText(user.full_name) || username
  };
}

async function fetchDirectProfileSearchInfo(session: InstagramSession, username: string) {
  const payload = await instagramApiJson<{ users?: { user?: Record<string, unknown> }[] }>(
    session,
    `${instagramHost}/api/v1/web/search/topsearch/?query=${encodeURIComponent(username)}`,
    { headers: { "referer": `${instagramHost}/` }, signal: AbortSignal.timeout(6_000) }
  );
  const users = Array.isArray(payload.users) ? payload.users : [];
  const exact = users
    .map((item) => item.user)
    .find((user) => cleanText(user?.username).toLowerCase() === username.toLowerCase());
  return profileInfoFromApiUser(exact, username);
}

async function fetchDirectProfileInfo(session: InstagramSession, username: string, profileId?: string | null) {
  if (profileId) {
    try {
      const payload = await instagramApiJson<{ user?: Record<string, unknown> }>(
        session,
        `${instagramHost}/api/v1/users/${encodeURIComponent(profileId)}/info/`,
        { headers: { "referer": `${instagramHost}/${encodeURIComponent(username)}/` }, signal: AbortSignal.timeout(6_000) }
      );
      const info = profileInfoFromApiUser(payload.user, username);
      if (info && info.followerCount !== null) return info;
    } catch {
      // Fall through to username lookup.
    }
  }

  if (!profileId) {
    try {
      const searchInfo = await fetchDirectProfileSearchInfo(session, username);
      if (searchInfo?.profileId) {
        try {
          return await fetchDirectProfileInfo(session, searchInfo.username, searchInfo.profileId);
        } catch {
          return searchInfo;
        }
      }
    } catch {
      // Fall through to web profile lookup.
    }
  }

  const payload = await instagramApiJson<{ data?: { user?: Record<string, unknown> } }>(
    session,
    `${instagramHost}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    { headers: { "referer": `${instagramHost}/${encodeURIComponent(username)}/` }, signal: AbortSignal.timeout(6_000) }
  );
  return profileInfoFromApiUser(payload.data?.user, username) || {
    username,
    profileId: null,
    followerCount: null,
    displayName: username
  };
}

function stripDirectFields(post: DirectInstagramPost): InstagramPost {
  const { _profileId, ...cleanPost } = post;
  return cleanPost;
}

async function enrichDirectProfiles(session: InstagramSession, posts: DirectInstagramPost[]) {
  const handles = [...new Set(posts.map((post) => post.username).filter(Boolean) as string[])].slice(0, 12);
  const profileIds = new Map(posts.map((post) => [post.username, post._profileId || null]));
  const profileEntries = await Promise.all(handles.map(async (handle) => {
    try {
      return [handle, await fetchDirectProfileInfo(session, handle, profileIds.get(handle))] as const;
    } catch {
      return [handle, null] as const;
    }
  }));
  const profiles = new Map(profileEntries);

  return posts.map((post) => {
    if (!post.username) return stripDirectFields(post);
    const profile = profiles.get(post.username);
    if (!profile) return stripDirectFields(post);
    return {
      ...stripDirectFields(post),
      display_name: profile.displayName || post.display_name,
      follower_count: profile.followerCount ?? post.follower_count,
      profile_url: `${instagramHost}/${post.username}/`
    };
  });
}

async function scrapeHashtagDirect(
  session: InstagramSession,
  normalized: NormalizedQuery,
  maxResults: number,
  candidateCount: number,
  preferredCutoff: Date,
  oldestAllowed: Date
): Promise<ScrapeResult> {
  if (!normalized.tag) return { query: normalized.label, results: [] };
  const directCandidateCount = Math.min(candidateCount, Math.max(maxResults * 3, 20), 40);
  const posts = await collectDirectHashtagApiPosts(session, normalized.tag, directCandidateCount, oldestAllowed);
  const sorted = posts.sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp));
  const selected = selectAutoExpandedResults(sorted, maxResults, preferredCutoff, oldestAllowed);
  return { query: normalized.label, results: await enrichDirectProfiles(session, selected) };
}

async function collectDirectProfileApiPosts(session: InstagramSession, profile: DirectProfileInfo, limit: number, cutoff: Date) {
  if (!profile.profileId) return [];

  const posts: DirectInstagramPost[] = [];
  const seen = new Set<string>();
  let maxId = "";

  for (let pageIndex = 0; pageIndex < 4 && posts.length < limit; pageIndex += 1) {
    const params = new URLSearchParams({ count: String(Math.min(24, Math.max(6, limit))) });
    if (maxId) params.set("max_id", maxId);

    const payload = await instagramApiJson<{
      items?: Record<string, unknown>[];
      feed_items?: { media_or_ad?: Record<string, unknown> }[];
      more_available?: boolean;
      next_max_id?: string;
    }>(
      session,
      `${instagramHost}/api/v1/feed/user/${encodeURIComponent(profile.profileId)}/?${params}`,
      { headers: { "referer": `${instagramHost}/${encodeURIComponent(profile.username)}/` } }
    );

    const medias = [
      ...(Array.isArray(payload.items) ? payload.items : []),
      ...(Array.isArray(payload.feed_items)
        ? payload.feed_items.map((item) => item.media_or_ad).filter(Boolean) as Record<string, unknown>[]
        : [])
    ];
    if (!medias.length) break;

    for (const media of medias) {
      const post = apiMediaToPost(media);
      if (!post || seen.has(post.post_url)) continue;
      if (post.timestamp && timestampValue(post.timestamp) < cutoff.getTime()) continue;
      seen.add(post.post_url);
      posts.push({
        ...post,
        username: post.username || profile.username,
        display_name: profile.displayName || post.display_name || profile.username,
        follower_count: profile.followerCount ?? post.follower_count,
        profile_url: `${instagramHost}/${profile.username}/`,
        _profileId: profile.profileId
      });
      if (posts.length >= limit) break;
    }

    maxId = cleanText(payload.next_max_id);
    if (!payload.more_available || !maxId) break;
  }

  return posts;
}

async function scrapeProfileDirect(
  session: InstagramSession,
  normalized: NormalizedQuery,
  maxResults: number,
  candidateCount: number,
  preferredCutoff: Date,
  oldestAllowed: Date
): Promise<ScrapeResult> {
  const username = profileUsernameFromNormalized(normalized);
  if (!username) return { query: normalized.label, results: [] };
  const profile = await fetchDirectProfileInfo(session, username);
  const directCandidateCount = Math.min(candidateCount, Math.max(maxResults * 3, 12), 36);
  const posts = await collectDirectProfileApiPosts(session, profile, directCandidateCount, oldestAllowed);
  const sorted = posts.sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp));
  const selected = selectAutoExpandedResults(sorted, maxResults, preferredCutoff, oldestAllowed);
  return { query: normalized.label, results: selected.map(stripDirectFields) };
}

async function scrapePostDirect(normalized: NormalizedQuery): Promise<ScrapeResult> {
  const postUrl = normalized.postUrl || normalized.startUrl;
  const response = await fetch(
    `https://graph.facebook.com/v19.0/instagram_oembed?url=${encodeURIComponent(postUrl)}&omitscript=true`,
    {
      headers: { "user-agent": defaultUserAgent },
      signal: AbortSignal.timeout(6_000)
    }
  );
  if (!response.ok) throw new Error(`Instagram URL lookup returned ${response.status}.`);

  const payload = await response.json().catch(() => ({})) as { html?: string };
  const permalink = payload.html?.match(/data-instgrm-permalink="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  const cleanPermalink = normalizePostUrl(permalink || postUrl) || postUrl;
  return {
    query: normalized.label,
    results: [{
      username: null,
      display_name: null,
      profile_url: null,
      post_url: cleanPermalink,
      thumbnail_url: null,
      comments_count: null,
      likes: null,
      follower_count: null,
      top_comments: [],
      timestamp: null,
      caption: null
    }]
  };
}

async function collectHashtagApiPosts(page: Page, tag: string, limit: number, cutoff: Date) {
  const posts: InstagramPost[] = [];
  const seen = new Set<string>();
  let maxId = "";

  for (let pageIndex = 0; pageIndex < 6 && posts.length < limit; pageIndex += 1) {
    const payload = await page.evaluate<{ ok: boolean; medias?: Record<string, unknown>[]; more_available?: boolean; next_max_id?: string }>(`
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
        if (!response.ok) return { ok: false, status: response.status, text: text.slice(0, 200) };

        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          return { ok: false, text: text.slice(0, 200) };
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
    `);

    if (!payload.ok || !payload.medias?.length) break;

    for (const media of payload.medias) {
      const post = apiMediaToPost(media);
      if (!post || seen.has(post.post_url)) continue;
      if (post.timestamp && new Date(post.timestamp).getTime() < cutoff.getTime()) continue;
      seen.add(post.post_url);
      posts.push(post);
      if (posts.length >= limit) break;
    }

    maxId = payload.next_max_id || "";
    if (!payload.more_available || !maxId) break;
  }

  return posts;
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

  if (/^[A-Za-z0-9._]{1,30}$/.test(text) && !reservedPaths.has(text.toLowerCase())) return `${instagramHost}/${text}/`;
  return null;
}

function profileUsernameFromNormalized(normalized: NormalizedQuery) {
  try {
    return new URL(normalized.startUrl).pathname.split("/").filter(Boolean)[0] || "";
  } catch {
    return normalized.label.replace(/^@+/, "").trim();
  }
}

function normalizePostUrl(href?: string | null) {
  if (!href) return null;
  let cleanHref = href.split("?")[0].split("#")[0];
  if (!cleanHref.includes("/p/") && !cleanHref.includes("/reel/")) return null;
  if (cleanHref.startsWith("/")) cleanHref = `${instagramHost}${cleanHref}`;
  else if (/^(www\.)?instagram\.com\//i.test(cleanHref)) cleanHref = `https://${cleanHref}`;
  if (!cleanHref.endsWith("/")) cleanHref = `${cleanHref}/`;
  return cleanHref;
}

function postOrderValue(postUrl: string) {
  const match = (postUrl || "").match(/\/(?:p|reel)\/([^/?#]+)\//);
  if (!match) return 0;
  let value = 0;
  for (const char of match[1]) {
    const index = shortcodeAlphabet.indexOf(char);
    if (index === -1) return 0;
    value = value * 64 + index;
  }
  return value;
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

function candidateToData(candidate: Candidate): Candidate {
  return {
    post_url: candidate.post_url,
    username: candidate.username ?? null,
    display_name: candidate.display_name ?? null,
    profile_url: candidate.profile_url ?? null,
    follower_count: candidate.follower_count ?? null,
    likes: candidate.likes ?? null,
    comments_count: candidate.comments_count ?? null,
    thumbnail_url: candidate.thumbnail_url ?? null,
    top_comments: candidate.top_comments || [],
    timestamp: candidate.timestamp ?? null,
    caption: candidate.caption ?? null,
    _handle: candidate._handle || candidate.username || null
  };
}

function apiMediaToCandidate(media: Record<string, unknown>): Candidate | null {
  const post = apiMediaToPost(media);
  if (!post) return null;
  return {
    ...post,
    profile_url: post.username ? `${instagramHost}/${post.username}/` : null,
    _handle: post.username
  };
}

function searchSources(query: string): { label: string; url: string }[] {
  const directPost = normalizePostUrl(query);
  if (directPost) return [{ label: "direct post/reel", url: directPost }];

  const tag = normalizeHashtag(query);
  if (tag) return [{ label: "hashtag search", url: `${instagramHost}/explore/tags/${tag}/?hl=en` }];

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

async function collectRecentApiCandidates(page: Page, query: string, limit: number, newerThan: Date) {
  const tags = splitInputs(query).map(normalizeHashtag).filter(Boolean) as string[];
  if (!tags.length) return [];

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const tag of tags) {
    try {
      await page.goto(`${instagramHost}/explore/tags/${tag}/?hl=en`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      continue;
    }
    if (await isLoginPage(page)) continue;

    let maxId = "";
    const pageLimit = Math.max(3, Math.min(10, Math.floor(limit / 12) + 1));
    for (let index = 0; index < pageLimit; index += 1) {
      const payload = await page.evaluate<{ ok: boolean; medias?: Record<string, unknown>[]; more_available?: boolean; next_max_id?: string }>(`
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
          if (!response.ok) return { ok: false, status: response.status, text: text.slice(0, 200) };
          let data = null;
          try {
            data = JSON.parse(text);
          } catch {
            return { ok: false, text: text.slice(0, 200) };
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
          return { ok: true, medias, more_available: Boolean(data.more_available), next_max_id: data.next_max_id || "" };
        })()
      `);
      if (!payload.ok) break;

      for (const media of payload.medias || []) {
        const candidate = apiMediaToCandidate(media);
        if (!candidate?.post_url || seen.has(candidate.post_url)) continue;
        if (candidate.timestamp && timestampValue(candidate.timestamp) < newerThan.getTime()) continue;
        seen.add(candidate.post_url);
        candidates.push(candidate);
        if (candidates.length >= limit) break;
      }
      if (candidates.length >= limit) break;
      maxId = payload.next_max_id || "";
      if (!payload.more_available || !maxId) break;
    }
  }

  return candidates.sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp));
}

async function collectLatestPostLinks(page: Page, query: string, limit: number, targetCount: number) {
  const seen = new Set<string>();
  const links: string[] = [];
  const sources = splitInputs(query).flatMap(searchSources);
  const sourceLimit = sources.length === 1 ? limit : Math.max(targetCount * 3, Math.floor(limit / Math.max(1, sources.length)));

  for (const source of sources) {
    if (source.label === "direct post/reel") {
      if (!seen.has(source.url)) {
        seen.add(source.url);
        links.push(source.url);
      }
      continue;
    }

    await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(1200);
    if (await isLoginPage(page)) continue;
    try {
      await page.waitForSelector(postSelector, { timeout: 15_000 });
    } catch {
      continue;
    }

    let sourceCount = 0;
    const activeSourceLimit = source.label === "profile" ? Math.max(targetCount, Math.min(sourceLimit, targetCount * 2)) : sourceLimit;
    const scrollLimit = source.label === "profile"
      ? Math.max(2, Math.min(10, Math.floor(activeSourceLimit / 12) + 1))
      : Math.max(8, Math.min(14, Math.floor(activeSourceLimit / 12) + 1));

    for (let index = 0; index < scrollLimit; index += 1) {
      const beforeCount = sourceCount;
      for (const anchor of await page.$$(postSelector)) {
        const postUrl = normalizePostUrl(await anchor.getAttribute("href"));
        if (!postUrl || seen.has(postUrl)) continue;
        seen.add(postUrl);
        links.push(postUrl);
        sourceCount += 1;
        if (sourceCount >= activeSourceLimit || seen.size >= limit) break;
      }
      if (sourceCount >= activeSourceLimit || seen.size >= limit) break;

      await page.mouse.wheel(0, 2200);
      await sleep(1000);
      if (sourceCount === beforeCount) {
        await page.mouse.wheel(0, 2600);
        await sleep(1000);
      }
    }

    if (source.label === "profile" && links.length >= targetCount * 2) break;
  }

  return links.sort((a, b) => postOrderValue(b) - postOrderValue(a));
}

async function profileInfo(page: Page): Promise<ProfileInfo> {
  const snapshot = await snapshotPage(page);
  const pathUsername = new URL(page.url()).pathname.split("/").filter(Boolean)[0] || null;
  const titleName = snapshot.title.split("(@")[0]?.trim() || null;
  return {
    username: pathUsername,
    displayName: titleName,
    followerCount: parseMetric(snapshot.description, "followers")
  };
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
      const name = cleanText(record.alternateName || record.name).replace(/^@/, "");
      if (name) return name;
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

function captionFromSnapshot(snapshot: PageSnapshot) {
  const jsonCaption = firstJsonLdValue(snapshot, ["caption", "description"]);
  if (jsonCaption) return jsonCaption;

  const [, afterColon] = snapshot.description.split(/:\s+/, 2);
  return afterColon?.replace(/^"|"$/g, "").trim() || null;
}

async function scrapePost(page: Page, postUrl: string, fallbackProfile?: ProfileInfo): Promise<InstagramPost | null> {
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await sleep(1800);

  const snapshot = await snapshotPage(page);
  const username = usernameFromSnapshot(snapshot) || fallbackProfile?.username || null;
  const timestamp = snapshot.time || firstJsonLdValue(snapshot, ["uploadDate", "datePublished", "dateCreated"]);
  const canonical = snapshot.canonical || postUrl;

  return {
    username,
    display_name: fallbackProfile?.displayName || username,
    post_url: canonical.split("?")[0],
    thumbnail_url: snapshot.ogImage,
    comments_count: parseMetric(snapshot.description, "comments"),
    likes: parseMetric(snapshot.description, "likes"),
    follower_count: fallbackProfile?.followerCount || null,
    top_comments: [],
    timestamp,
    caption: captionFromSnapshot(snapshot)
  };
}

async function waitForOpenPost(page: Page) {
  try {
    await page.waitForSelector('svg[aria-label="Like"], svg[aria-label="Unlike"]', { timeout: 15_000 });
  } catch {
    // Instagram can lazy render icons or hide them for some post types.
  }
  await sleep(2500);
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

function cleanTopComments(
  comments: { username?: string; text?: string; timestamp?: string }[],
  ownerHandle?: string | null,
  limit = 70
) {
  const cleaned: { username: string; text: string; timestamp?: string }[] = [];
  for (const comment of comments) {
    const username = (comment.username || "").trim();
    let text = (comment.text || "").split(/\s+/).join(" ").trim();
    if (!username || !text) continue;
    if (ownerHandle && username.toLowerCase() === ownerHandle.toLowerCase()) continue;
    if (text.length > limit) text = `${text.slice(0, limit).trimEnd()}...`;
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

    let text = textParts.join(" ").trim();
    if (text) {
      if (text.length > limit) text = `${text.slice(0, limit).trimEnd()}...`;
      if (!ownerHandle || username !== ownerHandle) comments.push({ username, text, time: timeText });
    }
    index = Math.max(cursor, index + 1);
  }

  return comments;
}

async function extractPostStats(page: Page, ownerHandle?: string | null) {
  const raw = await page.evaluate<{
    actionCounts: string[];
    description: string | null;
    thumbnail: string | null;
    bodyText: string;
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
      const mainLike = Array.from(document.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]'))
        .map((svg) => ({ svg, rect: svg.getBoundingClientRect() }))
        .filter((item) => visible(item.rect) && item.rect.width >= 20)
        .sort((a, b) => a.rect.top - b.rect.top)[0];

      let actionCounts = [];
      if (mainLike) {
        const section = mainLike.svg.closest("section");
        if (section) {
          actionCounts = (section.innerText || "")
            .split(/\\n+/)
            .map((text) => text.trim())
            .filter((text) => countOnlyRe.test(text));
        }
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

      return {
        actionCounts,
        description: pickMeta('meta[property="og:description"]'),
        thumbnail: pickMeta('meta[property="og:image"]'),
        bodyText: document.body ? document.body.innerText || "" : "",
        topComments
      };
    })()
  `);

  const actionCounts = raw.actionCounts || [];
  let likes = actionCounts.length ? parseCount(actionCounts[0]) : null;
  let commentsCount = actionCounts.length > 1 ? parseCount(actionCounts[1]) : null;
  if (likes === null) likes = firstCountFromPatterns(raw.description, [/([\d,.]+)\s*([KMB]?)\s+likes?/i]);
  if (commentsCount === null) commentsCount = firstCountFromPatterns(raw.description, [/([\d,.]+)\s*([KMB]?)\s+comments?/i]);

  let topComments = cleanTopComments(raw.topComments || [], ownerHandle);
  if (!topComments.length) topComments = extractTopCommentsFromText(raw.bodyText, ownerHandle);

  return {
    likes,
    comments_count: commentsCount,
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
    likes: null,
    comments_count: null,
    thumbnail_url: null,
    top_comments: [],
    timestamp: null,
    caption: null,
    _handle: null
  };

  try {
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
    if (timestamp) data.timestamp = timestamp;
  } catch (error) {
    console.warn(`Extraction error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return data;
}

async function getProfileInfo(handle: string, context: BrowserContext) {
  const page = await context.newPage();
  try {
    await sleep(1500 + Math.random() * 1500);
    await page.goto(`${instagramHost}/${handle}/`, { waitUntil: "domcontentloaded", timeout: 10_000 });
    await sleep(2000);

    let displayName: string | null = null;
    for (const selector of ["section header h2, section header h1", "section header span.x1lliihq"]) {
      const element = await page.$(selector);
      if (element) {
        displayName = (await element.innerText()).trim();
        if (displayName) break;
      }
    }
    if (!displayName) {
      const meta = await page.$('meta[property="og:title"]');
      const title = meta ? await meta.getAttribute("content") : null;
      if (title) displayName = title.match(/^(.*?)\s*\(@/)?.[1]?.trim() || title.trim();
    }
    if (!displayName) displayName = handle;

    let followerCount: number | null = null;
    const meta = await page.$('meta[property="og:description"]');
    const content = meta ? await meta.getAttribute("content") : null;
    const metaMatch = content?.match(/([\d,.]+)\s*([KMB]?)\s*followers?/i);
    if (metaMatch) {
      const parsed = parseCount(`${metaMatch[1]}${metaMatch[2]}`);
      if (parsed && parsed > 0) followerCount = parsed;
    }

    const selectors = [
      'a[href*="/followers/"]',
      "section ul li a",
      'li:has-text("followers")',
      'span:has-text("followers")',
      'div:has-text("followers")'
    ];
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        const element = await page.$(selector);
        const text = element ? (await element.innerText()).trim() : "";
        if (!/followers?/i.test(text)) continue;
        const match = text.match(/([\d,.]+)\s*([KMB]?)\s*followers?/i);
        if (!match) continue;
        const parsed = parseCount(`${match[1]}${match[2]}`);
        if (parsed && parsed > 0) {
          followerCount = parsed;
          break;
        }
      } catch {
        continue;
      }
    }

    return { followerCount, displayName };
  } catch (error) {
    console.warn(`Profile error for ${handle}: ${error instanceof Error ? error.message : String(error)}`);
    return { followerCount: null, displayName: handle };
  } finally {
    await page.close();
  }
}

async function scrapeWithSession(
  browser: Browser,
  session: InstagramSession,
  normalized: NormalizedQuery,
  requestedQuery: string,
  maxResults: number,
  candidateCount: number,
  preferredCutoff: Date,
  oldestAllowed: Date
): Promise<ScrapeResult> {
  const { context, page } = await createPage(browser, session);
  try {
    let candidates = await collectRecentApiCandidates(page, requestedQuery, candidateCount, oldestAllowed);
    if (!candidates.length) {
      const postUrls = await collectLatestPostLinks(page, requestedQuery, candidateCount, maxResults);
      candidates = postUrls.map((postUrl) => ({ post_url: postUrl }));
    }

    if (!candidates.length) return { query: normalized.label, results: [] };

    const results: InstagramPost[] = [];
    const profileCache = new Map<string, { followerCount: number | null; displayName: string | null }>();

    for (const candidate of candidates) {
      if (results.length >= maxResults) break;
      try {
        const postUrl = candidate.post_url;
        if (!postUrl) continue;
        if (candidate.timestamp && timestampValue(candidate.timestamp) < oldestAllowed.getTime()) continue;

        let data = candidateToData(candidate);
        const needsPostPage = (
          data.timestamp == null ||
          data.likes == null ||
          data.comments_count == null ||
          (data.comments_count || 0) > 0
        );

        if (needsPostPage) {
          await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await waitForOpenPost(page);
          data = await extractPostMeta(page, postUrl);
          const target = data as Record<string, unknown>;
          for (const [key, value] of Object.entries(candidate) as [keyof Candidate, unknown][]) {
            const emptyArray = Array.isArray(value) && value.length === 0;
            if (value == null || value === "" || emptyArray) continue;
            if (key === "post_url" || key === "timestamp") target[key] = value;
            else if (key === "_handle" && !data._handle) data._handle = value as string;
            else if (target[key] == null || target[key] === "") target[key] = value;
          }
        }

        if (!data.timestamp) continue;
        if (timestampValue(data.timestamp) < oldestAllowed.getTime()) continue;

        if (needsPostPage) {
          const stats = await extractPostStats(page, data._handle || data.username);
          if (stats.top_comments.length) data.top_comments = stats.top_comments;
          if (stats.likes !== null) data.likes = stats.likes;
          if (stats.comments_count !== null) data.comments_count = stats.comments_count;
          if (stats.thumbnail_url) data.thumbnail_url = stats.thumbnail_url;
        }

        const handle = data._handle || data.username;
        if (handle) {
          if (!profileCache.has(handle)) {
            profileCache.set(handle, await getProfileInfo(handle, context));
          }
          const profile = profileCache.get(handle);
          if (profile) {
            data.follower_count = profile.followerCount;
            data.display_name = profile.displayName || data.display_name || handle;
            data.profile_url = `${instagramHost}/${handle}/`;
          }
        }

        if (!data.post_url) continue;
        results.push({
          username: data.username ?? null,
          display_name: data.display_name ?? data.username ?? null,
          profile_url: data.profile_url ?? null,
          post_url: data.post_url,
          thumbnail_url: data.thumbnail_url ?? null,
          comments_count: data.comments_count ?? null,
          likes: data.likes ?? null,
          follower_count: data.follower_count ?? null,
          top_comments: data.top_comments || [],
          timestamp: data.timestamp ?? null,
          caption: data.caption ?? null
        });
      } catch {
        continue;
      }
    }

    const sorted = results
      .filter((item) => timestampValue(item.timestamp) >= oldestAllowed.getTime())
      .sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp));
    return { query: normalized.label, results: selectAutoExpandedResults(sorted, maxResults, preferredCutoff, oldestAllowed) };
  } finally {
    await context.close();
  }
}

export async function runInstagramScrape(input: InstagramScrapeInput) {
  let normalized = normalizeQuery(input.query);
  const maxResults = Math.max(1, Math.min(50, Number(input.maxResults) || 10));
  const candidateCount = normalized.mode === "post" ? 1 : Math.min(Math.max(maxResults * 6, maxResults, 20), 150);
  const preferredCutoff = newerThanCutoff(input);
  const oldestAllowed = oldestAllowedCutoff(input, preferredCutoff);
  const sessions = orderedSessions(await loadStorageSessions());

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

  if (normalized.mode === "post") {
    return scrapePostDirect(normalized);
  }

  if (normalized.mode === "hashtag" || normalized.mode === "profile") {
    let lastError: unknown = null;
    const sessionsWithCookies = sessions.filter((session) => instagramCookieHeader(session));
    const directSessions = sessionsWithCookies.slice(0, 2);
    if (!directSessions.length) throw new Error("Instagram session cookie is missing.");

    for (const session of directSessions) {
      try {
        if (normalized.mode === "hashtag") {
          return await scrapeHashtagDirect(
            session,
            normalized,
            maxResults,
            candidateCount,
            preferredCutoff,
            oldestAllowed
          );
        }
        return await scrapeProfileDirect(
          session,
          normalized,
          maxResults,
          candidateCount,
          preferredCutoff,
          oldestAllowed
        );
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
    return { query: normalized.label, results: [] };
  }

  const browser = await launchBrowser();
  let lastResult: ScrapeResult = { query: normalized.label, results: [] };
  let lastError: unknown = null;
  let successfulAttempt = false;

  try {
    for (const session of sessions) {
      try {
        const result = await scrapeWithSession(
          browser,
          session,
          normalized,
          input.query,
          maxResults,
          candidateCount,
          preferredCutoff,
          oldestAllowed
        );
        successfulAttempt = true;
        lastResult = result;
        if (result.results.length > 0) return result;
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    if (!successfulAttempt && lastError) throw lastError;
    return lastResult;
  } finally {
    await browser.close();
  }
}

export const instagramServiceInfo = {
  serviceRoot,
  dataDir: path.join(serviceRoot, "data"),
  platform: `${os.platform()}-${os.arch()}`
};
