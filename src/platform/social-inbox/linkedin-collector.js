// What the Companion does to collect LinkedIn comments and mentions, in the
// signed-in LinkedIn browser it already keeps for the account: read the
// member's own notifications (comments on their posts, mentions), find the
// Pages they administer (from their feed), then open each Page's admin
// Activity, reading the data LinkedIn sends those pages. Read-only: nothing
// is clicked, typed or sent.
import { adminPagesFromLinks, linkedinItemsFromNotifications } from "./linkedin-notifications.js";

export class LinkedinCollectError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const ACTIVITY_DATA = "organizationDashNotificationCardsByNotifications";
const OWN_DATA = "voyagerIdentityDashNotificationCards";
const signedOut = (url) => /linkedin\.com\/(login|checkpoint|authwall|uas\/login)/i.test(url);
const sameName = (left, right) => String(left).trim().toLowerCase() === String(right).trim().toLowerCase();

/**
 * @param {import("playwright-core").Page} page a page in the account's signed-in browser
 * @param {{ pageNames?: string[], includeOwn?: boolean, timeoutMs?: number }} options
 *   pageNames limits it to these Pages (all admin Pages when empty); includeOwn reads the member's own notifications too
 */
export async function collectLinkedinActivity(page, { pageNames = [], includeOwn = true, timeoutMs = 45000 } = {}) {
  const items = [];
  const report = [];
  const notSignedIn = () => new LinkedinCollectError("linkedin_login_required", "LinkedIn asked for a sign-in. Open the Companion and connect LinkedIn again.");

  // 1. The member's own notifications: comments on their posts, mentions.
  if (includeOwn) {
    const own = page.waitForResponse((candidate) => candidate.url().includes(OWN_DATA), { timeout: timeoutMs });
    own.catch(() => undefined);
    await page.goto("https://www.linkedin.com/notifications/", { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (signedOut(page.url())) throw notSignedIn();
    try {
      const found = linkedinItemsFromNotifications(await (await own).json());
      items.push(...found);
      report.push({ id: "me", name: "Your profile", found: found.length });
    } catch {
      report.push({ id: "me", name: "Your profile", found: 0, error: "LinkedIn didn't load your notifications in time." });
    }
  }

  // 2. The Pages this member manages, listed in the feed's left column.
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (signedOut(page.url())) throw notSignedIn();

  // The feed's left column links each Page this member manages.
  let pages = [];
  // Members who manage no Page have none; don't wait long for them.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !pages.length) {
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href*="/admin/"]')].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute("aria-label") || "").trim() }))).catch(() => []);
    pages = adminPagesFromLinks(links);
    if (!pages.length) await page.waitForTimeout(500);
  }
  if (pageNames.length) pages = pages.filter((candidate) => pageNames.some((name) => sameName(name, candidate.name)));
  if (!pages.length && !includeOwn) {
    throw new LinkedinCollectError("linkedin_no_pages", pageNames.length
      ? `This LinkedIn account doesn't manage ${pageNames.join(", ")} anymore.`
      : "This LinkedIn account doesn't manage any Page.");
  }

  // 3. Each Page's admin Activity: comments on its posts, mentions of it.
  for (const target of pages) {
    const response = page.waitForResponse(async (candidate) => {
      if (!candidate.url().includes("/voyager/api/graphql")) return false;
      const text = await candidate.text().catch(() => "");
      return text.includes(ACTIVITY_DATA);
    }, { timeout: timeoutMs });
    response.catch(() => undefined);
    await page.goto(`https://www.linkedin.com/company/${target.id}/admin/notifications/all/`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (signedOut(page.url())) throw notSignedIn();
    try {
      const body = await (await response).json();
      const found = linkedinItemsFromNotifications(body, { pageName: target.name });
      items.push(...found);
      report.push({ id: target.id, name: target.name, found: found.length });
    } catch {
      report.push({ id: target.id, name: target.name, found: 0, error: "LinkedIn didn't load this Page's activity in time." });
    }
  }
  if (!report.length || report.every((entry) => entry.error)) {
    throw new LinkedinCollectError("linkedin_unavailable", "LinkedIn didn't load the notifications in time. It will try again.");
  }
  return { pages: report, items, seen: items.length, complete: false };
}
