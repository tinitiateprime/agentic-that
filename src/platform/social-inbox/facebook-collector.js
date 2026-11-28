// What the Companion does to collect Facebook comments, in the signed-in
// Facebook browser it already keeps for the account: open the profile's Reels
// and Photos tabs, then each of the latest reels and photo posts, reading the
// comment data Facebook sends each one's page. Read-only: nothing is clicked,
// typed or sent.
import { facebookDocuments, facebookItemsFromPost, facebookItemsFromReel, photoIdsFromLinks, reelIdsFromLinks } from "./facebook-comments.js";

export class FacebookCollectError extends Error {
  constructor(code, message, details = null) { super(message); this.code = code; this.details = details; }
}

// Facebook names the data that carries comments differently for different
// accounts and pages (a profile's reel: …CommentPreloadingQuery; a photo:
// CometPhotoRootContentQuery; others: …UFI…/…Feedback…/…Comments…). Any of
// them is read; the reader only keeps real comment objects.
const COMMENT_DATA = /Comment|Feedback|UFI|PhotoRootContent/i;
// Live-update streams never finish and actions carry no comments: skip them.
const NOT_DATA = /Subscription|Mutation|Typing|Presence/i;
// No single response is waited on longer than this.
const textWithin = (response, ms) => Promise.race([response.text(), new Promise((resolve) => setTimeout(() => resolve(""), ms))]).catch(() => "");
const signedOut = (url) => /facebook\.com\/(login|checkpoint|recover)/i.test(url);
const friendlyName = (response) => /fb_api_req_friendly_name=([^&]+)/.exec(response.request().postData() || "")?.[1] || "";

// Facebook can load a post's data more than once (a photo's first response
// carries no comments; a later one does), so every comment-carrying response
// is read until `settleMs` after the first one, or until `timeoutMs`. The
// names of all data the page loaded are kept, to explain a failure.
async function readAllResponses(page, address, { timeoutMs, settleMs = 4000 }) {
  const texts = [];
  const names = new Set();
  const pending = [];
  let firstAt = 0;
  const listener = (response) => {
    if (!response.url().includes("/api/graphql")) return;
    const name = friendlyName(response);
    if (name) names.add(name);
    if (!COMMENT_DATA.test(name) || NOT_DATA.test(name)) return;
    firstAt ||= Date.now();
    pending.push(textWithin(response, 5000).then((text) => { if (text) texts.push(text); }));
  };
  page.on("response", listener);
  try {
    await page.goto(address, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !(firstAt && Date.now() - firstAt >= settleMs)) {
      if (signedOut(page.url())) break;
      await page.waitForTimeout(250);
    }
    await Promise.all(pending);
  } finally {
    page.off("response", listener);
  }
  // Facebook sometimes builds a post's data into the page itself (no
  // separate request): read the page's own data blocks too.
  const embedded = await page.evaluate(() => [...document.querySelectorAll('script[type="application/json"]')]
    .map((script) => script.textContent || "")
    .filter((text) => text.length < 3000000 && /"legacy_fbid"|comment/i.test(text))).catch(() => []);
  return { texts, embedded, names: [...names].slice(0, 12), finalUrl: page.url() };
}

/**
 * @param {import("playwright-core").Page} page a page in the account's signed-in browser
 * @param {{ reels?: number, photos?: number, timeoutMs?: number }} options how many of the latest reels and photo posts to read
 */
export async function collectFacebookReelComments(page, { reels = 6, photos = 6, timeoutMs = 45000, budgetMs = 210000 } = {}) {
  // The whole check stays well inside the Companion's 5-minute job lease.
  const stopAt = Date.now() + budgetMs;
  const notSignedIn = () => new FacebookCollectError("facebook_login_required", "Facebook asked for a sign-in. Open the Companion and connect Facebook again.");
  await page.goto("https://www.facebook.com/me/", { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (signedOut(page.url())) throw notSignedIn();
  const profile = new URL(page.url());
  const ownerId = profile.searchParams.get("id") || "";
  const reelsUrl = profile.pathname.startsWith("/profile.php")
    ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(ownerId)}&sk=reels_tab`
    : `https://www.facebook.com${profile.pathname.replace(/\/$/, "")}/reels/`;
  await page.goto(reelsUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (signedOut(page.url())) throw notSignedIn();

  let ids = [];
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !ids.length) {
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href*="/reel/"]')].map((a) => a.getAttribute("href"))).catch(() => []);
    ids = reelIdsFromLinks(hrefs, reels);
    if (!ids.length) await page.waitForTimeout(500);
  }

  const items = [];
  const report = [];
  const perItemMs = Math.min(timeoutMs, 12000);
  // Three posts in a row with no comment data at all: stop early instead of
  // spending minutes, and report what the pages loaded.
  const stuck = () => report.length >= 3 && report.slice(-3).every((entry) => entry.error);

  for (const reelId of ids) {
    if (stuck() || Date.now() > stopAt) break;
    const read = await readAllResponses(page, `https://www.facebook.com/reel/${reelId}/`, { timeoutMs: perItemMs });
    if (signedOut(read.finalUrl)) throw notSignedIn();
    if (!read.texts.length && !read.embedded.length) {
      report.push({ id: reelId, found: 0, error: "no comment data", loaded: read.names, url: read.finalUrl.slice(0, 120) });
      continue;
    }
    const found = facebookItemsFromReel([...read.texts, ...read.embedded].flatMap(facebookDocuments), { reelId, ownerId });
    items.push(...found);
    report.push({ id: reelId, found: found.length });
  }

  // Photo posts: the Photos tab lists them newest first.
  const photosUrl = reelsUrl.replace("sk=reels_tab", "sk=photos").replace(/\/reels\/$/, "/photos/");
  await page.goto(photosUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (signedOut(page.url())) throw notSignedIn();
  let photoIds = [];
  const photoDeadline = Date.now() + 15000;
  while (Date.now() < photoDeadline && !photoIds.length) {
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href*="fbid="], a[href*="/photos/"]')].map((a) => a.getAttribute("href"))).catch(() => []);
    photoIds = photoIdsFromLinks(hrefs, photos);
    if (!photoIds.length) await page.waitForTimeout(500);
  }
  const reelReports = report.length;
  for (const photoId of photoIds) {
    if (Date.now() > stopAt || (report.length - reelReports >= 3 && report.slice(-3).every((entry) => entry.error))) break;
    const read = await readAllResponses(page, `https://www.facebook.com/photo.php?fbid=${photoId}`, { timeoutMs: perItemMs });
    if (signedOut(read.finalUrl)) throw notSignedIn();
    if (!read.texts.length && !read.embedded.length) {
      // Some photos (a profile picture, for one) open without any comment
      // data. That's "no comments here", not a broken check; what loaded is
      // kept so a real change on Facebook can still be seen.
      report.push({ id: photoId, kind: "photo", found: 0, note: "no comment data", loaded: read.names, url: read.finalUrl.slice(0, 120) });
      continue;
    }
    const found = facebookItemsFromPost([...read.texts, ...read.embedded].flatMap(facebookDocuments), { photoId, ownerId });
    items.push(...found);
    report.push({ id: photoId, kind: "photo", found: found.length });
  }

  if (report.length && report.every((entry) => entry.error)) {
    throw new FacebookCollectError("facebook_unavailable", "Facebook didn't load the comments in time. It will try again.", {
      profile: profile.pathname.startsWith("/profile.php") ? "profile" : "page or named profile",
      reelsFound: ids.length,
      photosFound: photoIds.length,
      checked: report.slice(0, 6),
    });
  }
  // A post with several photos shows the same comment on each photo.
  const unique = items.filter((item, index) => items.findIndex((other) => other.externalId === item.externalId) === index);
  return { reels: report, items: unique, seen: unique.length, complete: false };
}
