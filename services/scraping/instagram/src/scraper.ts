import chromiumPack from "@sparticuz/chromium";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright-core";

export type InstagramScrapeInput = {
  query: string;
  maxResults?: number;
  recentDays?: number;
  onlyPostsNewerThan?: string;
};

export type InstagramPost = {
  username: string | null;
  display_name: string | null;
  post_url: string;
  thumbnail_url: string | null;
  comments_count: number | null;
  likes: number | null;
  follower_count: number | null;
  top_comments: { username: string; text: string }[];
  timestamp: string | null;
  caption: string | null;
};

type NormalizedQuery = {
  mode: "profile" | "hashtag" | "post";
  label: string;
  startUrl: string;
  postUrl?: string;
  tag?: string;
};

type ProfileInfo = {
  username: string | null;
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

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(moduleDir, "..");
const instagramHost = "https://www.instagram.com";
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
      return { mode: "profile", label: `@${username}`, startUrl: `${instagramHost}/${username}/` };
    }
    throw new Error("Use an Instagram profile, hashtag, post, or reel URL.");
  }

  if (raw.startsWith("#")) {
    const tag = raw.replace(/^#+/, "").trim();
    if (!tag) throw new Error("Enter a hashtag.");
    return { mode: "hashtag", label: `#${tag}`, startUrl: `${instagramHost}/explore/tags/${encodeURIComponent(tag)}/`, tag };
  }

  const username = raw.replace(/^@+/, "").trim();
  if (!/^[A-Za-z0-9._]+$/.test(username)) {
    throw new Error("Use a valid Instagram username, hashtag, or URL.");
  }
  return { mode: "profile", label: `@${username}`, startUrl: `${instagramHost}/${username}/` };
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

async function storageState() {
  const json = process.env.INSTAGRAM_STORAGE_STATE_JSON?.trim();
  if (json) return JSON.parse(json) as BrowserContextOptions["storageState"];

  const base64 = process.env.INSTAGRAM_STORAGE_STATE_BASE64?.trim();
  if (base64) return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as BrowserContextOptions["storageState"];

  const configuredPath = process.env.INSTAGRAM_STORAGE_STATE_PATH?.trim();
  const localPath = configuredPath || path.join(serviceRoot, "account_config", "sessions", "instagram.json");
  if (existsSync(localPath)) return await readJsonFile(localPath) as BrowserContextOptions["storageState"];

  return undefined;
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
  const state = await storageState();
  if (state) contextOptions.storageState = state;
  const context = await browser.newContext(contextOptions);
  return context.newPage();
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

function apiMediaToPost(media: Record<string, unknown>): InstagramPost | null {
  const code = cleanText(media.code);
  const takenAt = Number(media.taken_at);
  if (!code || !Number.isFinite(takenAt)) return null;

  const user = media.user && typeof media.user === "object" ? media.user as Record<string, unknown> : {};
  const username = cleanText(user.username) || null;
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
    top_comments: [],
    timestamp: new Date(takenAt * 1000).toISOString(),
    caption: cleanText((media.caption as Record<string, unknown> | undefined)?.text) || null
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

function cutoffDate(input: InstagramScrapeInput) {
  if (input.onlyPostsNewerThan) {
    const parsed = new Date(input.onlyPostsNewerThan);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  const days = Math.max(1, Math.min(365, Number(input.recentDays) || 7));
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

export async function runInstagramScrape(input: InstagramScrapeInput) {
  const normalized = normalizeQuery(input.query);
  const maxResults = Math.max(1, Math.min(20, Number(input.maxResults) || 10));
  const candidateCount = normalized.mode === "post" ? 1 : Math.min(60, Math.max(maxResults * 4, 16));
  const cutoff = cutoffDate(input);

  const browser = await launchBrowser();
  try {
    const page = await createPage(browser);
    await page.goto(normalized.startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

    const fallbackProfile = normalized.mode === "profile" ? await profileInfo(page) : undefined;
    if (normalized.mode === "hashtag" && normalized.tag) {
      const apiPosts = await collectHashtagApiPosts(page, normalized.tag, maxResults, cutoff);
      if (apiPosts.length > 0) {
        return {
          query: normalized.label,
          results: apiPosts.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
        };
      }
    }

    const postUrls = normalized.postUrl ? [normalized.postUrl] : await collectPostLinks(page, candidateCount);
    const results: InstagramPost[] = [];

    for (const postUrl of postUrls) {
      if (results.length >= maxResults) break;
      try {
        const post = await scrapePost(page, postUrl, fallbackProfile);
        if (!post) continue;
        if (post.timestamp && new Date(post.timestamp).getTime() < cutoff.getTime()) continue;
        results.push(post);
      } catch {
        continue;
      }
    }

    return {
      query: normalized.label,
      results: results.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
    };
  } finally {
    await browser.close();
  }
}

export const instagramServiceInfo = {
  serviceRoot,
  dataDir: path.join(serviceRoot, "data"),
  platform: `${os.platform()}-${os.arch()}`
};
