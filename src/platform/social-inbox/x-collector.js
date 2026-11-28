// What the Companion does to collect X replies and mentions, in the signed-in
// X browser it already keeps for the account: open x.com's notifications (the
// All tab: the Mentions tab leaves out some replies in a thread) and read the
// notifications data X sends that page, keeping only replies, mentions and
// quotes. Read-only: nothing is clicked, typed or sent.
import { xItemsFromNotifications } from "./x-notifications.js";

export class XCollectError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const NOTIFICATIONS_DATA = "/NotificationsTimeline";
const signedOut = (url) => /x\.com\/(i\/flow\/login|login|account\/access)|twitter\.com\/(i\/flow\/login|login)/i.test(url);

/** @param {import("playwright-core").Page} page a page in the account's signed-in browser */
export async function collectXMentions(page, { timeoutMs = 45000, settleMs = 4000 } = {}) {
  // X can load its notifications more than once (one full, one empty), so
  // every response is read until a few seconds after the first one.
  const bodies = [];
  const pending = [];
  let firstAt = 0;
  let failedStatus = 0;
  const listener = (response) => {
    if (!response.url().includes(NOTIFICATIONS_DATA)) return;
    firstAt ||= Date.now();
    if (!response.ok()) { failedStatus = response.status(); return; }
    pending.push(response.json().then((body) => bodies.push(body)).catch(() => undefined));
  };
  page.on("response", listener);
  try {
    await page.goto("https://x.com/notifications", { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !(firstAt && Date.now() - firstAt >= settleMs)) {
      if (signedOut(page.url())) break;
      await page.waitForTimeout(250);
    }
    await Promise.all(pending);
  } finally {
    page.off("response", listener);
  }
  if (signedOut(page.url())) throw new XCollectError("x_login_required", "X asked for a sign-in. Open the Companion and connect X again.");
  if (!bodies.length) {
    throw new XCollectError("x_unavailable", failedStatus
      ? `X didn't send the notifications (code ${failedStatus}).`
      : "X didn't load the notifications in time. It will try again.");
  }
  const seen = new Set();
  const items = bodies.flatMap((body) => xItemsFromNotifications(body)).filter((item) => !seen.has(item.externalId) && seen.add(item.externalId));
  return { items, seen: items.length, complete: false };
}
