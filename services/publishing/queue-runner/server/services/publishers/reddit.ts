// Reddit posts through the Companion's external browser, with the account's
// own logged-in Reddit (like X, Facebook and YouTube). The post is made on the
// community's submit page; it counts as done once Reddit opens the new post's
// page (/comments/<id>/), which happens only after Reddit has created it.

import type { Locator, Page } from "playwright-core";
import fs from "fs";
import type { PlatformUpload } from "../../../shared/schema.js";
import { redditDestinationLabel, requireRedditOptions, resolveRedditDestination } from "../../../shared/reddit-options.js";
import { publishingUploadFilePath } from "../../runtime-paths.js";
import { clickFinalAction } from "./final-click.js";
import { setLocalFileChooserFile, setLocalInputFile } from "./local-file-input.js";
import { mediaUploadTimeoutMs } from "./media-upload-tracker.js";
import { waitForLoginWithManualFallback, waitForSavedSessionVerification, type AccountLogin } from "./manual-login.js";

export const REDDIT_HOME_URL = "https://www.reddit.com/";
export const REDDIT_LOGIN_URL = "https://www.reddit.com/login/";

/** "https://www.reddit.com/r/test/comments/1abc23/my_title/" → "1abc23". */
export function redditPostIdFromUrl(url: string) {
  // The post page, or the community page Reddit returns to with ?created=t3_<id>.
  return url.match(/reddit\.com\/(?:r\/[^/]+|user\/[^/]+)\/comments\/([a-z0-9]+)/i)?.[1]
    || url.match(/[?&]created=t3_([a-z0-9]+)/i)?.[1]
    || "";
}

/** The community's submit page for this kind of post. */
export function redditSubmitUrl(subreddit: string, kind: "text" | "media") {
  const name = resolveRedditDestination(subreddit);
  const path = /^u_/i.test(name) ? `user/${encodeURIComponent(name.slice(2))}` : `r/${encodeURIComponent(name)}`;
  return `https://www.reddit.com/${path}/submit/?type=${kind === "text" ? "TEXT" : "IMAGE"}`;
}

/** Verify the destination Reddit selected, including the profile URL used by its picker. */
export function isRedditComposerDestination(url: string, destination: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/^(www\.)?reddit\.com$/i.test(parsed.hostname)) return false;
    const selected = parsed.pathname.match(/^\/(user|r)\/([^/]+)\/submit\/?$/i);
    if (!selected) return false;
    const name = resolveRedditDestination(destination);
    const selectedName = decodeURIComponent(selected[2]);
    return (selected[1].toLowerCase() === "user" ? `u_${selectedName}` : selectedName).toLowerCase() === name.toLowerCase();
  } catch { return false; }
}

/** The picker's menu item for this destination: "u/<name> · Your profile" or "r/<name> · members". */
export function redditPickerItemPattern(label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The whole handle only: u/name never matches u/name2.
  return new RegExp(`^\\s*${escaped}(?![A-Za-z0-9_-])`, "i");
}

/**
 * Reddit's own flow, as a person does it (checked live on reddit.com):
 * Create -> "Select Community" -> the picker's search box (focused, a <textarea>)
 * -> type "u/" for the account's profile or the community name -> click the
 * exact menu item -> Reddit opens /user/<name>/submit/ or /r/<name>/submit/.
 */
export async function openRedditComposer(page: Page, destination: string, timeoutMs = 30_000) {
  const name = resolveRedditDestination(destination);
  const label = redditDestinationLabel(name);
  const isProfile = /^u_/i.test(name);
  try {
    const create = await firstVisible([
      page.locator('a[href="/submit"], a[href="/submit/"], a[href^="/submit?"]'),
      page.getByRole("link", { name: /^create(?: post)?$/i }),
      page.getByRole("button", { name: /^create(?: post)?$/i }),
    ], timeoutMs);
    if (!create) throw new Error("Reddit's Create button didn't appear.");
    console.log("Opening Reddit Create...");
    await create.click({ timeout: timeoutMs });

    const select = await firstVisible([page.getByRole("button", { name: /^select (?:a )?community$/i })], timeoutMs);
    if (!select) throw new Error("Reddit's Select Community button didn't appear.");
    await select.click({ timeout: timeoutMs });

    // The picker's own search box has the plain "Search" placeholder (the site
    // search says "Search Reddit"), so the wrong box is never typed into.
    const search = await firstVisible([
      page.locator('faceplate-search-input textarea[placeholder="Search"], faceplate-search-input input[placeholder="Search"]'),
    ], timeoutMs);
    if (!search) throw new Error("Reddit's Choose community search didn't open.");
    console.log(`Selecting Reddit destination ${label}...`);
    await search.click({ timeout: timeoutMs });
    await search.fill("");
    // Real key presses: Reddit searches as the user types.
    await search.pressSequentially(isProfile ? "u/" : name, { delay: 120 });

    const item = await firstVisible([page.getByRole("menuitem").filter({ hasText: redditPickerItemPattern(label) })], timeoutMs);
    if (!item) {
      throw new Error(isProfile
        ? `Reddit didn't offer ${label} (Your profile) after typing u/.`
        : `Reddit didn't offer ${label} in Choose community. Check the community name and that this account can post there.`);
    }
    await item.click({ timeout: timeoutMs });
    await page.waitForURL(url => isRedditComposerDestination(url.toString(), name), { timeout: timeoutMs });
  } catch (error) {
    // Same destination by its own address when the picker misbehaves.
    console.warn(`Reddit's picker didn't select ${label} (${error instanceof Error ? error.message : error}); opening its post page directly.`);
    await page.goto(redditSubmitUrl(name, "text"), { waitUntil: "domcontentloaded" });
    const problem = await redditPageProblem(page);
    if (problem) throw new Error(problem);
  }
  if (!isRedditComposerDestination(page.url(), name)) {
    throw new Error(`Reddit didn't open ${label} as the post destination. No post was submitted.`);
  }
  console.log(`Reddit destination ${label} selected.`);
}

/** Reddit's refusals, in plain words (null when the text isn't one). */
export function explainRedditProblem(text: string) {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return null;
  if (/flair/i.test(value) && /(required|must|select|choose|add)/i.test(value)) return "This community requires a post flair. Choose one in the community's rules, or post in a community without required flair.";
  if (/doing that too much|try again in|rate limit/i.test(value)) return `Reddit is limiting this account for a while: ${value}`;
  if (/(community|subreddit).*(doesn.t exist|not found|banned|private)|isn.t available|no longer available/i.test(value)) return `Reddit says this community can't be posted to: ${value}`;
  if (/not allowed to post|only approved|restricted community|can.t post here|isn.t allowed/i.test(value)) return `This community doesn't let this account post: ${value}`;
  if (/karma|account (is )?too new|account age/i.test(value)) return `This community needs more karma or an older account: ${value}`;
  if (/title is required|add a title|needs a title/i.test(value)) return "Reddit needs a title for this post.";
  if (/(image|video|file).*(too large|not supported|unsupported|failed)/i.test(value)) return `Reddit didn't accept the media: ${value}`;
  if (/(images|videos|media).*(not allowed|disabled)|doesn.t allow (images|videos|media)/i.test(value)) return `This community doesn't allow photo or video posts: ${value}`;
  return null;
}

async function firstVisible(candidates: Locator[], timeoutMs = 0) {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const item = candidate.nth(index);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    if (Date.now() < deadline) await page_wait(400);
  } while (Date.now() < deadline);
  return null;
}

const page_wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The logged-in username, asked from Reddit itself ("" when signed out). */
export async function redditUsername(page: Page) {
  if (!/reddit\.com/i.test(page.url())) return "";
  return page.evaluate(async () => {
    try {
      const response = await fetch("/api/me.json", { credentials: "include", headers: { accept: "application/json" } });
      if (!response.ok) return "";
      const body = await response.json();
      return String(body?.data?.name || body?.name || "");
    } catch {
      return "";
    }
  }).catch(() => "");
}

async function isLoggedIn(page: Page) {
  if (/reddit\.com\/(login|register|account\/login)/i.test(page.url())) return false;
  return Boolean(await redditUsername(page));
}

async function isManualVerificationVisible(page: Page, url: string) {
  if (/captcha|challenge|verify|two[-_]?factor|otp/i.test(url)) return true;
  return Boolean(await firstVisible([
    page.locator('iframe[src*="captcha" i], iframe[title*="captcha" i]'),
    page.getByText(/verification code|two-factor|check your email for a code/i),
  ]));
}

async function loginFormIsVisible(page: Page) {
  return Boolean(await firstVisible([
    page.locator('input[name="username"], input#login-username'),
    page.locator('input[name="password"], input#login-password'),
  ]));
}

async function getLoginError(page: Page) {
  const error = await firstVisible([page.locator('[role="alert"], faceplate-form-helper-text[status="error"], .error').filter({ hasText: /incorrect|invalid|wrong|try again/i })]);
  return (await error?.textContent().catch(() => ""))?.replace(/\s+/g, " ").trim() || null;
}

/** Closes Reddit's own pop-ups (cookie banner, "use the app") that cover the page. */
async function dismissRedditInterruptions(page: Page) {
  const button = await firstVisible([
    page.getByRole("button", { name: /^(accept all|accept|reject optional cookies|continue|not now|close)$/i }),
  ]);
  if (button) await button.click({ timeout: 2000 }).catch(() => undefined);
}

export async function loginToReddit(page: Page, accountLogin?: AccountLogin) {
  const savedSessionOnly = Boolean(accountLogin?.useSavedSessionOnly);
  console.log("Navigating to Reddit...");
  await page.goto(REDDIT_HOME_URL, { timeout: 60000, waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await dismissRedditInterruptions(page);

  if (await isLoggedIn(page)) {
    console.log("Reddit session already active.");
  } else if (savedSessionOnly) {
    await waitForSavedSessionVerification({
      page,
      platform: "Reddit",
      isLoggedIn: () => isLoggedIn(page),
      beforeCheck: () => dismissRedditInterruptions(page),
    });
  } else {
    await page.goto(REDDIT_LOGIN_URL, { timeout: 60000, waitUntil: "domcontentloaded" });
    console.log("Complete the Reddit login in the visible browser; Companion will save the session after the account opens.");
    await waitForLoginWithManualFallback({
      page,
      platform: "Reddit",
      normalTimeoutMs: 90000,
      pollMs: 750,
      isLoggedIn: () => isLoggedIn(page),
      isManualVerificationVisible: (url) => isManualVerificationVisible(page, url),
      isLoginFormVisible: () => loginFormIsVisible(page),
      getLoginError: () => getLoginError(page),
      beforeCheck: () => dismissRedditInterruptions(page),
      allowManualLoginFromStart: true,
      ignoreLoginErrors: Boolean(accountLogin?.ignoreLoginErrors),
      embeddedLogin: Boolean(accountLogin?.embeddedLogin),
    });
  }
  console.log("Reddit ready.");
  return { success: true };
}

/** Any refusal Reddit shows on the submit page, in plain words. */
async function redditPageProblem(page: Page) {
  // Reddit lists submit errors under the Post button as plain <li> items.
  const texts = await page.locator('[role="alert"], faceplate-toast, [slot="error"], faceplate-form-helper-text, .error, shreddit-async-loader [role="status"], r-post-form-submit-button ~ ul li, ul li:has-text("doesn\'t exist"), ul li:has-text("try again")')
    .evaluateAll((elements) => elements.filter((element) => (element as HTMLElement).offsetParent !== null || element.getClientRects().length).map((element) => (element.textContent || "").trim()).filter(Boolean))
    .catch(() => [] as string[]);
  for (const text of texts) {
    const explained = explainRedditProblem(text);
    if (explained) return explained;
  }
  return null;
}

async function fillTitle(page: Page, title: string) {
  const field = await firstVisible([
    page.locator('post-composer-title textarea[name="title"]'),
    page.locator('textarea[name="title"]'),
  ], 30_000);
  if (!field) {
    const problem = await redditPageProblem(page);
    throw new Error(problem || "Reddit's post form didn't open for this community.");
  }
  await field.click();
  await field.fill(title.slice(0, 300));
}

async function fillBody(page: Page, text: string) {
  if (!text) return;
  const body = await firstVisible([
    page.locator('div[name="body"][contenteditable="true"]'),
    page.locator('shreddit-composer [contenteditable="true"][role="textbox"]'),
  ], 10_000);
  if (!body) throw new Error("Reddit's post body editor didn't appear. No post was submitted.");
  await body.click();
  await page.keyboard.insertText(text);
}

/** Reddit stores attached media in its upload bucket; a finished upload answers 2xx there. */
export function isRedditMediaUploadResponse(method: string, url: string, status: number) {
  return method.toUpperCase() === "POST" && status >= 200 && status < 300 && /reddit-uploaded-(?:media|video)[^/]*\.amazonaws\.com/i.test(url);
}

async function attachMedia(page: Page, filePath: string, kind: "image" | "video", sizeBytes = 0) {
  const timeout = Number(process.env.REDDIT_UPLOAD_TIMEOUT_MS ?? mediaUploadTimeoutMs(sizeBytes));
  // The preview shows at once from this computer; the post must wait for Reddit's own upload to finish.
  let finished = false;
  const uploaded = page.waitForResponse((response) => isRedditMediaUploadResponse(response.request().method(), response.url(), response.status()), { timeout })
    .then(() => { finished = true; })
    .catch(() => undefined);
  // Reddit's form makes a photo or video post from its own Image / Video button (as a person would).
  const button = await firstVisible([
    page.locator(kind === "video" ? "post-composer-toolbar-button-video button" : "post-composer-toolbar-button-image button"),
    page.locator("post-composer-standalone-toolbar").getByRole("button", { name: kind === "video" ? /^video$/i : /^image$/i }),
  ], 20_000);
  if (button) {
    const chooser = page.waitForEvent("filechooser", { timeout: 15_000 });
    await button.click();
    const picker = await chooser;
    // Reddit rebuilds its file input right after a file is picked, so hand the file over in one step.
    await picker.setFiles(filePath).catch(() => setLocalFileChooserFile(picker, filePath));
  } else {
    // Older form: the media field's own input.
    const input = page.locator(`post-composer-standalone-toolbar input[type="file"][accept*="${kind}"], r-post-media-input#post-composer_media input[type="file"]`).first();
    await input.waitFor({ state: "attached", timeout: 30_000 });
    await setLocalInputFile(page, input, filePath);
  }
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const problem = await redditPageProblem(page);
    if (problem) throw new Error(problem);
    if (finished) {
      // Reddit then registers the uploaded file with the post form.
      await page.waitForTimeout(2000);
      return;
    }
    await page.waitForTimeout(500);
  }
  void uploaded;
  throw new Error("Reddit didn't finish uploading the media in time.");
}

async function setTags(page: Page, nsfw?: boolean, spoiler?: boolean) {
  for (const [wanted, name] of [[nsfw, /nsfw/i], [spoiler, /spoiler/i]] as const) {
    if (!wanted) continue;
    const toggle = await firstVisible([page.getByRole("switch", { name }), page.getByRole("checkbox", { name }), page.getByRole("button", { name })], 3000);
    if (toggle && (await toggle.getAttribute("aria-checked")) !== "true") await toggle.click().catch(() => undefined);
  }
}

export async function submitAndConfirm(page: Page, title: string, onSubmitted?: () => Promise<void> | void, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let postButton: Locator | null = null;
  let ready = false;
  while (Date.now() < deadline) {
    postButton = await firstVisible([
      page.locator("#inner-post-submit-button"),
      page.locator('r-post-form-submit-button button, [slot="submit-button"] button'),
      page.getByRole("button", { name: /^post$/i }),
    ]);
    if (postButton && await postButton.isEnabled().catch(() => false) && (await postButton.getAttribute("aria-disabled")) !== "true") {
      ready = true;
      break;
    }
    const problem = await redditPageProblem(page);
    if (problem) throw new Error(problem);
    await page.waitForTimeout(500);
  }
  if (!postButton) throw new Error("Reddit's Post button didn't show.");
  if (!ready) throw new Error("Reddit's Post button stayed disabled. No post was submitted. Check the title, media upload, and required tags.");
  const username = await redditUsername(page);
  const clickedAt = Math.floor(Date.now() / 1000) - 10;
  console.log("Clicking Reddit Post button...");
  await clickFinalAction(page, postButton, "Reddit Post");
  await onSubmitted?.();

  // Confirmed when Reddit opens the new post, or when it lists the post (this
  // exact title, made after the click) among the account's own posts. Reddit
  // sometimes goes back to the community page instead of opening the post.
  let lastListCheck = 0;
  while (Date.now() < deadline + 120_000) {
    const postId = redditPostIdFromUrl(page.url());
    if (postId) {
      console.log(`Reddit post published (${postId}).`);
      return postId;
    }
    const problem = await redditPageProblem(page);
    if (problem) throw new Error(problem);
    const leftSubmit = !/\/submit/i.test(page.url());
    if (username && (leftSubmit || Date.now() - lastListCheck > 5000)) {
      lastListCheck = Date.now();
      const listed = await findOwnRedditPost(page, username, title, clickedAt);
      if (listed) {
        console.log(`Reddit post published (${listed}).`);
        return listed;
      }
    }
    await page.waitForTimeout(leftSubmit ? 1500 : 500);
  }
  throw new Error("Reddit did not confirm the new post. Check the community before retrying.");
}

/** The account's own post with this title made after `since` (unix seconds): its permalink, or "". */
export async function findOwnRedditPost(page: Page, username: string, title: string, since: number) {
  return page.evaluate(async ({ username, title, since }) => {
    try {
      const response = await fetch(`https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.json?limit=10&sort=new&raw_json=1`, { credentials: "include", cache: "no-store" });
      if (!response.ok) return "";
      const body = await response.json();
      const wanted = title.trim().toLowerCase();
      const hit = (body?.data?.children || []).map((child: { data?: Record<string, unknown> }) => child.data || {})
        .find((post: Record<string, unknown>) => String(post.title || "").trim().toLowerCase() === wanted && Number(post.created_utc || 0) >= since);
      return hit ? `https://www.reddit.com${String(hit.permalink || "")}` : "";
    } catch {
      return "";
    }
  }, { username, title, since }).catch(() => "");
}

export async function postToReddit(page: Page, upload: PlatformUpload, accountLogin?: AccountLogin) {
  const reddit = requireRedditOptions("reddit", upload.platformOptions)?.reddit;
  if (!reddit) throw new Error("Reddit posts need a community and a title.");
  const isTextOnly = upload.postFormat === "text" || upload.mimeType === "text/plain" || !upload.fileName;
  const filePath = isTextOnly ? "" : publishingUploadFilePath(upload.fileName);
  if (!isTextOnly && !fs.existsSync(filePath)) throw new Error(`Reddit upload file not found: ${filePath}`);

  await loginToReddit(page, accountLogin);
  const username = await redditUsername(page);
  if (!username) throw new Error("Couldn't verify the logged-in Reddit account. Reconnect Reddit and try again.");
  const destination = resolveRedditDestination(reddit.subreddit, username);
  await openRedditComposer(page, destination);
  await page.waitForTimeout(2000);
  await dismissRedditInterruptions(page);
  await fillTitle(page, reddit.title);
  const isVideo = !isTextOnly && (upload.postFormat === "video" || /^video\//i.test(upload.mimeType || ""));
  if (!isTextOnly) await attachMedia(page, filePath, isVideo ? "video" : "image", upload.size);
  await fillBody(page, String(upload.caption || "").trim());
  await setTags(page, reddit.nsfw, reddit.spoiler);
  if (!isRedditComposerDestination(page.url(), destination)) throw new Error("Reddit's post destination changed while preparing the post. No post was submitted.");
  // Reddit can take minutes to open a new video post; the wait ends as soon as it does.
  const posted = await submitAndConfirm(page, reddit.title.slice(0, 300), accountLogin?.onFinalActionSubmitted, isVideo ? 10 * 60_000 : undefined).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // Reddit answers PROFILE_SUBREDDIT_NOEXIST ("that community doesn't exist") when it won't take profile posts from this account.
    if (/^u_/i.test(destination) && /doesn.t exist/i.test(message)) {
      throw new Error(`Reddit refused to post on u/${username}'s profile (Reddit says the profile "doesn't exist"; new or low-karma accounts often can't post to their profile yet). Nothing was posted. Choose a community, or try again once the account is older.`);
    }
    throw error;
  });
  const postId = redditPostIdFromUrl(posted) || posted;
  await assertRedditPostKept(page, postId);
  return {
    success: true,
    postUrl: /^https:\/\/(www\.)?reddit\.com\//.test(posted) ? posted : /^[a-z0-9]+$/i.test(postId) ? `https://www.reddit.com/comments/${postId}/` : undefined,
  };
}

/** A community's AutoModerator note, cut to its first sentences. */
export function summarizeRemovalNote(note: string) {
  const text = note
    .replace(/\s+/g, " ")
    .replace(/\*?I am a bot[\s\S]*$/i, "")
    .replace(/[*_>#`]+/g, "")
    .replace(/^\s*(hi|hello|hey)\b,?\s*(u\/)?[\w-]*,?\s*/i, "")
    .trim();
  return text.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ").slice(0, 400);
}

/**
 * Communities often remove new posts automatically (account age, karma, rules)
 * a few seconds after Reddit accepts them. The post only counts as published if
 * it is still up shortly after; otherwise the community's own reason is shown.
 */
export async function assertRedditPostKept(page: Page, postId: string) {
  if (!/^[a-z0-9]+$/i.test(postId)) return;
  const deadline = Date.now() + Number(process.env.REDDIT_REMOVAL_CHECK_MS ?? 25_000);
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    const removal = await page.evaluate(async (id) => {
      try {
        // The post page's data (the post, then its comments); /api/info.json is blocked for browsers.
        const response = await fetch(`https://www.reddit.com/comments/${id}.json?raw_json=1&limit=10`, { credentials: "include", cache: "no-store" });
        if (!response.ok) return null;
        const listing = await response.json();
        const post = listing?.[0]?.data?.children?.[0]?.data;
        const automod = (listing?.[1]?.data?.children || []).map((child: { data?: Record<string, unknown> }) => child.data || {})
          .find((comment: Record<string, unknown>) => String(comment.author || "").toLowerCase() === "automoderator" && /removed/i.test(String(comment.body || "")));
        if (!post?.removed_by_category && !automod) return null;
        return { category: String(post?.removed_by_category || "automod"), note: String(automod?.body || "") };
      } catch {
        return null;
      }
    }, postId).catch(() => null);
    if (removal) {
      const reason = summarizeRemovalNote(removal.note);
      throw new Error(`Reddit published the post, but ${removal.note ? "the community's AutoModerator" : "Reddit's filters"} removed it right away.${reason ? ` Their reason: ${reason}` : " Check the community's rules (account age, karma, flair) before posting there again."}`);
    }
  }
}
