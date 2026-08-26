import type { BrowserContext, Locator, Page } from "playwright-core";
import type { ClaimedPublishingJob, ServerPublishingExecutor } from "./executor.ts";
import { detectServerBrowserExecutable, launchStandardXChrome } from "./login-browser.ts";
import type { AutomationFileStore } from "./profile-store.ts";

async function firstVisible(locators: Locator[]) {
  for (const locator of locators) {
    for (let index = 0, count = Math.min(await locator.count().catch(() => 0), 12); index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function firstEnabledVisible(locators: Locator[]) {
  for (const locator of locators) {
    for (let index = 0, count = Math.min(await locator.count().catch(() => 0), 12); index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function waitVisible(page: Page, locators: Locator[], signal: AbortSignal, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const candidate = await firstVisible(locators);
    if (candidate) return candidate;
    await page.waitForTimeout(500);
  }
  return null;
}

async function youtubeAuthenticated(context: BrowserContext, page: Page) {
  const cookies = await context.cookies();
  const cookieReady = cookies.some(cookie =>
    ["SAPISID", "__Secure-3PAPISID", "SID"].includes(cookie.name)
    && Boolean(cookie.value)
    && (cookie.domain.endsWith(".youtube.com") || cookie.domain.endsWith(".google.com"))
  );
  if (!cookieReady) return false;
  try {
    const url = new URL(page.url());
    return (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com"))
      && !/\/signin(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function fillEditable(page: Page, locator: Locator, text: string) {
  await locator.click({ timeout: 10_000 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
  if (text) await page.keyboard.insertText(text);
}

async function enabledExactButton(page: Page, root: Locator, label: RegExp, signal: AbortSignal, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const button = await firstEnabledVisible([
      root.getByRole("button", { name: label }),
      root.locator("ytcp-button").filter({ hasText: label }),
      root.locator("button").filter({ hasText: label }),
    ]);
    if (button) {
      const text = (await button.textContent().catch(() => ""))?.replace(/\s+/g, " ").trim() || "";
      const aria = (await button.getAttribute("aria-label").catch(() => ""))?.trim() || "";
      if (label.test(text) || label.test(aria)) return button;
    }
    await page.waitForTimeout(750);
  }
  return null;
}

async function submitFinalAction(
  finalAction: Locator,
  expectedLabel: RegExp,
  signal: AbortSignal,
  onFinalActionStarting: () => Promise<void>,
) {
  const label = `${await finalAction.getAttribute("aria-label").catch(() => "") || ""} ${await finalAction.textContent().catch(() => "") || ""}`
    .replace(/\s+/g, " ").trim();
  if (!expectedLabel.test(label)) throw new Error("YouTube's final control did not pass its exact label guard.");
  await onFinalActionStarting();
  signal.throwIfAborted();
  await finalAction.click({ timeout: 15_000 });
}

async function openCommunityComposer(page: Page, signal: AbortSignal) {
  const create = await waitVisible(page, [
    page.getByRole("button", { name: /^Create$/i }),
    page.locator('button[aria-label="Create"]'),
  ], signal, 45_000);
  if (!create) throw new Error("YouTube's Create control was unavailable.");
  await create.click({ timeout: 10_000 });
  const createPost = await waitVisible(page, [
    page.getByRole("menuitem", { name: /Create post/i }),
    page.locator('[role="menuitem"]').filter({ hasText: /^Create post$/i }),
    page.getByText(/^Create post$/i),
  ], signal, 20_000);
  if (!createPost) throw new Error("YouTube Community posts are not enabled for this channel.");
  await createPost.click({ timeout: 10_000 });
  const composer = await waitVisible(page, [
    page.locator("ytd-backstage-post-dialog-renderer"),
    page.locator('[role="dialog"]').filter({ hasText: /Visibility|Post|Image poll|Quiz/i }),
  ], signal, 30_000);
  if (!composer) throw new Error("YouTube's Community post composer did not open.");
  return composer;
}

async function publishCommunityPost(
  page: Page,
  job: ClaimedPublishingJob,
  files: AutomationFileStore,
  signal: AbortSignal,
  onFinalActionStarting: () => Promise<void>,
  reportProgress: (message: string) => void,
) {
  const composer = await openCommunityComposer(page, signal);
  const editor = await waitVisible(page, [
    composer.locator('[contenteditable="true"]').first(),
    composer.getByRole("textbox").first(),
    composer.locator("textarea").first(),
  ], signal, 20_000);
  if (!editor) throw new Error("YouTube's Community post text editor was unavailable.");
  await fillEditable(page, editor, job.caption);
  if (job.media[0]) {
    reportProgress("Uploading the image to YouTube's Community composer.");
    const input = composer.locator('input[type="file"]').last();
    if (!await input.count()) {
      const image = await firstVisible([
        composer.getByRole("button", { name: /^Image$|Add image/i }),
        composer.getByText(/^Image$/i),
      ]);
      if (!image) throw new Error("YouTube's Community image control was unavailable.");
      await image.click({ timeout: 10_000 });
    }
    const target = await input.count() ? input : page.locator('input[type="file"]').last();
    if (!await target.count()) throw new Error("YouTube's Community image input was unavailable.");
    await target.setInputFiles(files.mediaFilePath(job.media[0].storageKey));
  }
  const post = await enabledExactButton(page, composer, /^Post$/i, signal, 120_000);
  if (!post) throw new Error("YouTube's exact Community Post button did not become enabled.");
  reportProgress("Final YouTube Community Post authorized. Recording the irreversible action before clicking.");
  await submitFinalAction(post, /^Post$/i, signal, onFinalActionStarting);
  await composer.waitFor({ state: "hidden", timeout: 90_000 });
}

async function uploadVideo(
  page: Page,
  job: ClaimedPublishingJob,
  files: AutomationFileStore,
  signal: AbortSignal,
  onFinalActionStarting: () => Promise<void>,
  reportProgress: (message: string) => void,
) {
  const options = job.platformOptions.youtube;
  if (!options || !job.media[0]) throw new Error("YouTube video options and one video file are required.");
  let input = page.locator('input[type="file"][accept*="video"], ytcp-uploads-dialog input[type="file"], input[type="file"]').last();
  if (!await input.count()) {
    const create = await waitVisible(page, [page.getByRole("button", { name: /^Create$/i }), page.locator("ytcp-button#create-icon")], signal, 30_000);
    if (create) await create.click({ timeout: 10_000 });
    const upload = await waitVisible(page, [page.getByRole("menuitem", { name: /Upload videos/i }), page.getByText(/^Upload videos$/i)], signal, 20_000);
    if (upload) await upload.click({ timeout: 10_000 });
    input = page.locator('input[type="file"][accept*="video"], ytcp-uploads-dialog input[type="file"], input[type="file"]').last();
  }
  if (!await input.count()) throw new Error("YouTube Studio's video input was unavailable.");
  reportProgress("Uploading the video to YouTube Studio.");
  await input.setInputFiles(files.mediaFilePath(job.media[0].storageKey));
  const dialog = await waitVisible(page, [page.locator("ytcp-uploads-dialog")], signal, 60_000);
  if (!dialog) throw new Error("YouTube Studio's upload dialog did not open.");
  const title = await waitVisible(page, [dialog.locator("#title-textarea #textbox"), dialog.locator("#title-textarea")], signal, 60_000);
  const description = await waitVisible(page, [dialog.locator("#description-textarea #textbox"), dialog.locator("#description-textarea")], signal, 30_000);
  if (!title || !description) throw new Error("YouTube Studio's title or description editor was unavailable.");
  await fillEditable(page, title, options.title);
  await fillEditable(page, description, job.caption);

  const audienceText = options.audience === "made_for_kids"
    ? /Yes,? (?:it['’]s|this video is) made for kids/i
    : /No,? (?:it['’]s|this video is) not made for kids/i;
  const audience = await waitVisible(page, [
    dialog.getByRole("radio", { name: audienceText }),
    dialog.locator("tp-yt-paper-radio-button").filter({ hasText: audienceText }),
  ], signal, 60_000);
  if (!audience) throw new Error("YouTube Studio's requested audience option was unavailable.");
  await audience.click({ timeout: 10_000 });
  const selectedAudience = await audience.getAttribute("aria-checked").catch(() => null);
  if (selectedAudience === "false") throw new Error("YouTube did not retain the selected audience classification.");

  for (const step of ["Video elements", "Checks", "Visibility"]) {
    const next = await enabledExactButton(page, dialog, /^Next$/i, signal, 120_000);
    if (!next) throw new Error(`YouTube's Next button did not become enabled before ${step}.`);
    await next.click({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
  }

  const visibilityText = new RegExp(`^${options.visibility}$`, "i");
  const visibility = await waitVisible(page, [
    dialog.getByRole("radio", { name: visibilityText }),
    dialog.locator(`tp-yt-paper-radio-button[name="${options.visibility.toUpperCase()}"]`),
    dialog.locator("tp-yt-paper-radio-button").filter({ hasText: visibilityText }),
  ], signal, 60_000);
  if (!visibility) throw new Error(`YouTube Studio's ${options.visibility} visibility option was unavailable.`);
  await visibility.click({ timeout: 10_000 });
  const selectedVisibility = await visibility.getAttribute("aria-checked").catch(() => null);
  if (selectedVisibility === "false") throw new Error("YouTube did not retain the selected visibility.");

  const finalLabel = options.visibility === "public" ? /^(?:Publish|Save)$/i : /^Save$/i;
  const finalAction = await enabledExactButton(page, dialog, finalLabel, signal, 180_000);
  if (!finalAction) throw new Error("YouTube Studio's exact final Save or Publish button did not become enabled.");
  const platformPostUrl = await dialog.locator('a[href*="youtu.be"], a[href*="youtube.com/watch"]').first().getAttribute("href").catch(() => null);
  reportProgress(`Final YouTube ${options.visibility} action authorized. Recording the irreversible action before clicking.`);
  await submitFinalAction(finalAction, finalLabel, signal, onFinalActionStarting);
  const confirmationDeadline = Date.now() + 120_000;
  let confirmed = false;
  while (Date.now() < confirmationDeadline) {
    signal.throwIfAborted();
    if (!await dialog.isVisible().catch(() => false)) { confirmed = true; break; }
    if (await firstVisible([
      page.getByText(/Video published|Your video has been published|Changes saved/i),
      page.locator("ytcp-video-share-dialog"),
    ])) { confirmed = true; break; }
    await page.waitForTimeout(750);
  }
  if (!confirmed) throw new Error("YouTube did not show a publish/save confirmation.");
  return platformPostUrl || undefined;
}

export class PlaywrightYouTubePublishingExecutor implements ServerPublishingExecutor {
  readonly platform = "youtube" as const;

  constructor(private readonly files: AutomationFileStore, private readonly configuredExecutablePath: string) {}

  async publish(
    job: ClaimedPublishingJob,
    signal: AbortSignal,
    onFinalActionStarting: () => Promise<void>,
    reportProgress: (message: string) => void = () => undefined,
  ) {
    if (job.platform !== "youtube") throw new Error("The YouTube executor received a different platform.");
    if (job.executionMode !== "LIVE" || job.validationStage !== "LOCAL") throw new Error("The YouTube executor refuses jobs outside the authorized live stage.");
    const executablePath = detectServerBrowserExecutable(this.configuredExecutablePath);
    if (!executablePath) throw new Error("Google Chrome or Microsoft Edge is required for YouTube publishing.");
    const video = Boolean(job.media[0]?.mimeType.toLowerCase().startsWith("video/"));
    const targetUrl = video ? "https://www.youtube.com/upload" : "https://www.youtube.com/";
    const browserSession = await launchStandardXChrome(executablePath, this.files.profileDirectory(job.accountId), targetUrl, false);
    let finalActionAttempted = false;
    try {
      const { page, context } = browserSession;
      await Promise.all(context.pages().filter(candidate => candidate !== page).map(candidate => candidate.close().catch(() => undefined)));
      reportProgress("Opening YouTube with the saved server session.");
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (!await youtubeAuthenticated(context, page)) {
        return { state: "LOGIN_REQUIRED" as const, errorCode: "YOUTUBE_LOGIN_REQUIRED", errorMessage: "Reconnect the YouTube account." };
      }
      const fencedAction = async () => {
        await onFinalActionStarting();
        finalActionAttempted = true;
      };
      if (video) {
        const platformPostUrl = await uploadVideo(page, job, this.files, signal, fencedAction, reportProgress);
        return { state: "PUBLISHED" as const, platformPostUrl };
      }
      await publishCommunityPost(page, job, this.files, signal, fencedAction, reportProgress);
      return { state: "PUBLISHED" as const };
    } catch (error) {
      const page = browserSession.page;
      if (!page.isClosed()) {
        const screenshot = await page.screenshot({ type: "jpeg", quality: 75, animations: "disabled" }).catch(() => null);
        if (screenshot) await this.files.storePublishingPreview(job.id, screenshot).catch(() => undefined);
      }
      if (finalActionAttempted) {
        return { state: "UNCERTAIN" as const, errorCode: "YOUTUBE_RESULT_UNCERTAIN", errorMessage: error instanceof Error ? error.message : "YouTube confirmation was unavailable." };
      }
      throw error;
    } finally {
      await browserSession.close().catch(() => undefined);
    }
  }
}
