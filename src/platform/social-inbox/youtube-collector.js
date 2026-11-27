// What the Companion does to collect YouTube comments, in the signed-in
// YouTube browser it already keeps for the account: open YouTube Studio's
// comments page (newest, not yet answered) and read the data YouTube sends
// that page. Read-only: nothing is clicked, typed or sent.
import { studioCommentsUrl, youtubeCommentsFromStudio } from "./youtube-comments.js";

export class YoutubeCollectError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const COMMENTS_DATA = "/youtubei/v1/comment/get_comments";

/**
 * @param {import("playwright-core").Page} page a page in the account's signed-in browser
 * @returns {Promise<{ channelId: string, items: object[], seen: number, complete: boolean }>}
 */
export async function collectYoutubeComments(page, { timeoutMs = 45000, includeOwn = false, unansweredOnly = true } = {}) {
  await page.goto("https://studio.youtube.com/", { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  let channelId = "";
  while (Date.now() < deadline) {
    const url = page.url();
    if (/accounts\.google\.com|ServiceLogin|signin/i.test(url)) {
      throw new YoutubeCollectError("youtube_login_required", "YouTube asked for a sign-in. Open the Companion and connect YouTube again.");
    }
    channelId = /studio\.youtube\.com\/channel\/(UC[\w-]{10,})/.exec(url)?.[1] || "";
    if (channelId) break;
    await page.waitForTimeout(250);
  }
  if (!channelId) throw new YoutubeCollectError("youtube_channel_missing", "YouTube Studio didn't open a channel for this account.");

  const response = page.waitForResponse(
    (candidate) => candidate.url().includes(COMMENTS_DATA) && candidate.request().method() === "POST",
    { timeout: timeoutMs },
  );
  // If the page fails to open, nothing waits on this; keep that rejection handled.
  response.catch(() => undefined);
  await page.goto(studioCommentsUrl(channelId, { unansweredOnly }), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  let body;
  try {
    const answer = await response;
    if (!answer.ok()) throw new YoutubeCollectError("youtube_unavailable", `YouTube Studio didn't send the comments (code ${answer.status()}).`);
    body = await answer.json();
  } catch (error) {
    if (error instanceof YoutubeCollectError) throw error;
    throw new YoutubeCollectError("youtube_unavailable", "YouTube Studio didn't load the comments in time. It will try again.");
  }
  const threads = Array.isArray(body?.contents?.itemSectionRenderer?.contents) ? body.contents.itemSectionRenderer.contents : [];
  return {
    channelId,
    seen: threads.filter((entry) => entry?.commentThreadRenderer).length,
    // No "load more" marker: this is every unanswered comment, so anything
    // not in it has been answered on YouTube.
    complete: !threads.some((entry) => entry?.continuationItemRenderer),
    items: youtubeCommentsFromStudio(body, { includeOwn }),
  };
}
