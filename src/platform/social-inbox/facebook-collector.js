// What the Companion does to collect Facebook comments, in the signed-in
// Facebook browser it already keeps for the account: open the profile's Reels
// and Photos tabs, then each of the latest reels and photo posts, reading the
// comment data Facebook sends each one's page. Read-only: nothing is clicked,
// typed or sent.
import { facebookDocuments, facebookItemsFromPost, facebookItemsFromReel, photoIdsFromLinks, reelIdsFromLinks } from "./facebook-comments.js";

export class FacebookCollectError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const COMMENTS_QUERY = "CommentPreloading";
const PHOTO_QUERY = "CometPhotoRootContentQuery";
const signedOut = (url) => /facebook\.com\/(login|checkpoint|recover)/i.test(url);

// Facebook can load a post's data more than once (a photo's first response
// carries no comments; a later one does), so every matching response is read:
// until `settleMs` after the first one arrives, or until `timeoutMs`.
async function readAllResponses(page, query, address, { timeoutMs, settleMs = 4000 }) {
  const texts = [];
  const pending = [];
  let firstAt = 0;
  const listener = (response) => {
    if (!response.url().includes("/api/graphql") || !(response.request().postData() || "").includes(query)) return;
    firstAt ||= Date.now();
    pending.push(response.text().then((text) => texts.push(text)).catch(() => undefined));
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
  return texts;
}

/**
 * @param {import("playwright-core").Page} page a page in the account's signed-in browser
 * @param {{ reels?: number, photos?: number, timeoutMs?: number }} options how many of the latest reels and photo posts to read
 */
export async function collectFacebookReelComments(page, { reels = 6, photos = 6, timeoutMs = 45000 } = {}) {
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
  for (const reelId of ids) {
    const texts = await readAllResponses(page, COMMENTS_QUERY, `https://www.facebook.com/reel/${reelId}/`, { timeoutMs: Math.min(timeoutMs, 20000) });
    if (signedOut(page.url())) throw notSignedIn();
    if (!texts.length) {
      report.push({ id: reelId, found: 0, error: "Facebook didn't load this reel's comments in time." });
      continue;
    }
    const found = facebookItemsFromReel(texts.flatMap(facebookDocuments), { reelId, ownerId });
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
  for (const photoId of photoIds) {
    const texts = await readAllResponses(page, PHOTO_QUERY, `https://www.facebook.com/photo.php?fbid=${photoId}`, { timeoutMs: Math.min(timeoutMs, 20000) });
    if (signedOut(page.url())) throw notSignedIn();
    if (!texts.length) {
      report.push({ id: photoId, kind: "photo", found: 0, error: "Facebook didn't load this post's comments in time." });
      continue;
    }
    const found = facebookItemsFromPost(texts.flatMap(facebookDocuments), { photoId, ownerId });
    items.push(...found);
    report.push({ id: photoId, kind: "photo", found: found.length });
  }

  if (report.length && report.every((entry) => entry.error)) {
    throw new FacebookCollectError("facebook_unavailable", "Facebook didn't load the comments in time. It will try again.");
  }
  // A post with several photos shows the same comment on each photo.
  const unique = items.filter((item, index) => items.findIndex((other) => other.externalId === item.externalId) === index);
  return { reels: report, items: unique, seen: unique.length, complete: false };
}
