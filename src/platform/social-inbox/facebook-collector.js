// What the Companion does to collect Facebook comments, in the signed-in
// Facebook browser it already keeps for the account: open the profile's Reels
// tab, then each of the latest reels, reading the comment data Facebook sends
// each reel's page. Read-only: nothing is clicked, typed or sent.
import { facebookDocuments, facebookItemsFromReel, reelIdsFromLinks } from "./facebook-comments.js";

export class FacebookCollectError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const COMMENTS_QUERY = "CommentPreloading";
const signedOut = (url) => /facebook\.com\/(login|checkpoint|recover)/i.test(url);

/**
 * @param {import("playwright-core").Page} page a page in the account's signed-in browser
 * @param {{ reels?: number, timeoutMs?: number }} options how many of the latest reels to read
 */
export async function collectFacebookReelComments(page, { reels = 6, timeoutMs = 45000 } = {}) {
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
    const response = page.waitForResponse(
      (candidate) => candidate.url().includes("/api/graphql") && (candidate.request().postData() || "").includes(COMMENTS_QUERY),
      { timeout: timeoutMs },
    );
    response.catch(() => undefined);
    await page.goto(`https://www.facebook.com/reel/${reelId}/`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (signedOut(page.url())) throw notSignedIn();
    try {
      const found = facebookItemsFromReel(facebookDocuments(await (await response).text()), { reelId, ownerId });
      items.push(...found);
      report.push({ id: reelId, found: found.length });
    } catch {
      report.push({ id: reelId, found: 0, error: "Facebook didn't load this reel's comments in time." });
    }
  }
  if (ids.length && report.every((entry) => entry.error)) {
    throw new FacebookCollectError("facebook_unavailable", "Facebook didn't load the reels' comments in time. It will try again.");
  }
  return { reels: report, items, seen: items.length, complete: false };
}
