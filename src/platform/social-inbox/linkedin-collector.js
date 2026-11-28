// What the Companion does to collect LinkedIn comments and mentions, in the
// signed-in LinkedIn browser it already keeps for the account: read the
// member's own notifications (comments on their posts, mentions), find the
// Pages they administer (from their feed), then open each Page's admin
// Activity, reading the data LinkedIn sends those pages. Read-only: nothing
// is clicked, typed or sent.
import { adminPagesFromLinks, linkedinItemsFromCards, linkedinItemsFromNotifications } from "./linkedin-notifications.js";

// The notification cards as drawn on the page: each card's paragraphs and
// links. LinkedIn puts its newest notifications only here, not in its data.
async function cardsOnPage(page) {
  await page.waitForTimeout(3000);
  return page.evaluate(() => {
    const cards = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/feed/update/"]')) {
      let card = anchor.parentElement;
      for (let depth = 0; card && depth < 12; depth += 1, card = card.parentElement) {
        const texts = [...card.querySelectorAll("p")].map((p) => (p.innerText || "").trim()).filter(Boolean);
        if (texts.some((text) => /\b(commented on|replied to|mentioned)\b/i.test(text) && text.length < 200)) {
          if (!cards.has(anchor.href)) cards.set(anchor.href, { texts, links: [...card.querySelectorAll("a[href]")].map((a) => a.href) });
          break;
        }
      }
    }
    return [...cards.values()];
  }).catch(() => []);
}

// One item per comment: the page and the data can both carry it.
function mergeItems(first, second) {
  const seen = new Set(first.map((item) => item.externalId));
  const words = new Set(first.map((item) => `${item.authorName.toLowerCase()}|${item.body}`));
  return [...first, ...second.filter((item) => !seen.has(item.externalId) && !words.has(`${item.authorName.toLowerCase()}|${item.body}`))];
}

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
    const fromPage = linkedinItemsFromCards(await cardsOnPage(page));
    let fromData = [];
    let dataError = "";
    try {
      fromData = linkedinItemsFromNotifications(await (await own).json());
    } catch {
      dataError = "LinkedIn didn't load your notifications in time.";
    }
    const found = mergeItems(fromPage, fromData);
    items.push(...found);
    report.push(found.length || !dataError
      ? { id: "me", name: "Your profile", found: found.length, onPage: fromPage.length }
      : { id: "me", name: "Your profile", found: 0, error: dataError });
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
    const fromPage = linkedinItemsFromCards(await cardsOnPage(page), { pageName: target.name });
    let fromData = [];
    let dataError = "";
    try {
      fromData = linkedinItemsFromNotifications(await (await response).json(), { pageName: target.name });
    } catch {
      dataError = "LinkedIn didn't load this Page's activity in time.";
    }
    const found = mergeItems(fromPage, fromData);
    items.push(...found);
    report.push(found.length || !dataError
      ? { id: target.id, name: target.name, found: found.length, onPage: fromPage.length }
      : { id: target.id, name: target.name, found: 0, error: dataError });
  }
  if (!report.length || report.every((entry) => entry.error)) {
    throw new LinkedinCollectError("linkedin_unavailable", "LinkedIn didn't load the notifications in time. It will try again.");
  }
  return { pages: report, items, seen: items.length, complete: false };
}
