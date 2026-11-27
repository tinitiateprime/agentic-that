// What the Companion does to collect X replies and mentions, in the signed-in
// X browser it already keeps for the account: open x.com's Mentions tab and
// read the notifications data X sends that page. Read-only: nothing is
// clicked, typed or sent.
import { xItemsFromNotifications } from "./x-notifications.js";

export class XCollectError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const NOTIFICATIONS_DATA = "/NotificationsTimeline";
const signedOut = (url) => /x\.com\/(i\/flow\/login|login|account\/access)|twitter\.com\/(i\/flow\/login|login)/i.test(url);

/** @param {import("playwright-core").Page} page a page in the account's signed-in browser */
export async function collectXMentions(page, { timeoutMs = 45000 } = {}) {
  const response = page.waitForResponse((candidate) => candidate.url().includes(NOTIFICATIONS_DATA), { timeout: timeoutMs });
  response.catch(() => undefined);
  await page.goto("https://x.com/notifications/mentions", { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (signedOut(page.url())) throw new XCollectError("x_login_required", "X asked for a sign-in. Open the Companion and connect X again.");
  let body;
  try {
    const answer = await response;
    if (!answer.ok()) throw new XCollectError("x_unavailable", `X didn't send the notifications (code ${answer.status()}).`);
    body = await answer.json();
  } catch (error) {
    if (error instanceof XCollectError) throw error;
    if (signedOut(page.url())) throw new XCollectError("x_login_required", "X asked for a sign-in. Open the Companion and connect X again.");
    throw new XCollectError("x_unavailable", "X didn't load the notifications in time. It will try again.");
  }
  const items = xItemsFromNotifications(body);
  return { items, seen: items.length, complete: false };
}
