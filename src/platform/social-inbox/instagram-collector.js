// What the Companion does to collect Instagram comments and mentions, in the
// signed-in Instagram browser it already keeps for the account: open
// instagram.com/notifications and read the activity data Instagram sends that
// page. Read-only: nothing is clicked, typed or sent.
import { instagramItemsFromActivity } from "./instagram-activity.js";

export class InstagramCollectError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const ACTIVITY_QUERY = "PolarisActivityFeedStoriesViewQuery";
const signedOut = (url) => /instagram\.com\/(accounts\/login|challenge|accounts\/suspended)/i.test(url);

/** @param {import("playwright-core").Page} page a page in the account's signed-in browser */
export async function collectInstagramActivity(page, { timeoutMs = 45000 } = {}) {
  const response = page.waitForResponse(
    (candidate) => candidate.url().includes("/graphql") && (candidate.request().postData() || "").includes(ACTIVITY_QUERY),
    { timeout: timeoutMs },
  );
  response.catch(() => undefined);
  await page.goto("https://www.instagram.com/notifications/", { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (signedOut(page.url())) {
    throw new InstagramCollectError("instagram_login_required", /suspended/i.test(page.url())
      ? "Instagram has suspended this account or wants it confirmed. Open Instagram to sort it out."
      : "Instagram asked for a sign-in. Open the Companion and connect Instagram again.");
  }
  let body;
  try {
    body = await (await response).json();
  } catch {
    if (signedOut(page.url())) throw new InstagramCollectError("instagram_login_required", "Instagram asked for a sign-in. Open the Companion and connect Instagram again.");
    throw new InstagramCollectError("instagram_unavailable", "Instagram didn't load the notifications in time. It will try again.");
  }
  const items = instagramItemsFromActivity(body);
  return { items, seen: items.length, complete: false };
}
