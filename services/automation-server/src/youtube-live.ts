import type { BrowserContext, Locator, Page } from "playwright-core";
import type { ClaimedPublishingJob, ServerPublishingExecutor } from "./executor.ts";
import { detectServerBrowserExecutable, launchStandardXChrome } from "./login-browser.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import { setServerLocalFileChooserFile, setServerLocalInputFile } from "./local-file-input.ts";

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

async function firstAttached(locators: Locator[]) {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    if (count) return locator.last();
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

async function waitAttached(page: Page, locators: Locator[], signal: AbortSignal, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const candidate = await firstAttached(locators);
    if (candidate) return candidate;
    await page.waitForTimeout(500);
  }
  return null;
}

async function clickReversibleControl(page: Page, control: Locator, signal: AbortSignal) {
  signal.throwIfAborted();
  await control.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
  try {
    await control.click({ timeout: 5_000 });
  } catch (error) {
    signal.throwIfAborted();
    if (!await control.isVisible().catch(() => false) || !await control.isEnabled().catch(() => false)) throw error;
    // Studio sometimes leaves a transparent shell over the hydrated Create
    // control. This is only for reversible menu controls, never Publish/Save.
    await control.evaluate(element => (element as HTMLElement).click());
  }
  await page.waitForTimeout(500);
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

async function editableText(locator: Locator) {
  return locator.evaluate(element => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
    const editable = element.matches('[contenteditable="true"], [role="textbox"]')
      ? element
      : element.querySelector('[contenteditable="true"], [role="textbox"], textarea, input');
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) return editable.value;
    return (editable as HTMLElement | null)?.innerText || editable?.textContent || element.textContent || "";
  }).catch(() => "");
}

async function fillVerifiedYouTubeField(page: Page, locator: Locator, text: string, fieldName: string) {
  const expected = text.replace(/\s+/g, " ").trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fillEditable(page, locator, text);
    await page.waitForTimeout(400);
    const actual = (await editableText(locator)).replace(/\s+/g, " ").trim();
    if (actual === expected) return;
  }
  throw new Error(`YouTube Studio did not retain the requested ${fieldName}.`);
}

export function exactYouTubeButtonLabelMatches(label: RegExp, ...values: Array<string | null | undefined>) {
  return values.some(value => {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) return false;
    label.lastIndex = 0;
    return label.test(normalized);
  });
}

export function isYouTubePublishSuccessText(value: string | null | undefined) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return /(?:Video published|Your video has been published|Video saved|Your video has been saved|public on YouTube)/i.test(text)
    && !/(?:not|wasn['’]t|couldn['’]t|failed|error)/i.test(text);
}

async function enabledExactButton(page: Page, root: Locator, label: RegExp, signal: AbortSignal, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const candidates = [
      root.getByRole("button", { name: label }),
      root.locator("ytcp-button").filter({ hasText: label }),
      root.locator('[role="button"]').filter({ hasText: label }),
      root.locator("button").filter({ hasText: label }),
    ];
    for (const locator of candidates) {
      for (let index = 0, count = Math.min(await locator.count().catch(() => 0), 20); index < count; index += 1) {
        const candidate = locator.nth(index);
        if (!await candidate.isVisible().catch(() => false)) continue;
        const state = await candidate.evaluate(element => {
          const clickable = element.matches('button, [role="button"]')
            ? element
            : element.querySelector('button, [role="button"]') || element;
          const ariaLabel = clickable.getAttribute("aria-label") || "";
          const visibleText = clickable.textContent || "";
          const disabled = (clickable as HTMLButtonElement).disabled
            || clickable.hasAttribute("disabled")
            || clickable.getAttribute("aria-disabled") === "true"
            || element.hasAttribute("disabled")
            || element.getAttribute("aria-disabled") === "true";
          return { ariaLabel, visibleText, nested: clickable !== element, disabled };
        }).catch(() => null);
        // YouTube commonly exposes both aria-label="Next" and text "Next".
        // Matching their concatenation produces "Next Next", which is not an
        // exact label and made a ready upload wait until its long timeout.
        if (!state || state.disabled || !exactYouTubeButtonLabelMatches(label, state.ariaLabel, state.visibleText)) continue;
        if (state.nested) {
          const clickable = candidate.locator('button, [role="button"]').first();
          if (await clickable.isVisible().catch(() => false)) return clickable;
        }
        return candidate;
      }
    }
    await page.waitForTimeout(750);
  }
  return null;
}

function youtubeUploadTransitionTimeout() {
  const configured = Number(process.env.YOUTUBE_UPLOAD_TRANSITION_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return 20 * 60_000;
  return Math.max(60_000, Math.min(60 * 60_000, Math.floor(configured)));
}

async function currentYouTubeUploadStage(page: Page, root: Locator = page.locator("body")) {
  if (await firstVisible([
    root.getByText(/Choose when to publish|Save or publish/i),
    root.getByRole("radio", { name: /^Public$|^Private$|^Unlisted$/i }),
    root.locator('tp-yt-paper-radio-button[name="PUBLIC"], tp-yt-paper-radio-button[name="PRIVATE"], tp-yt-paper-radio-button[name="UNLISTED"]'),
  ])) return "Visibility";
  if (await firstVisible([
    root.getByText(/check your video for issues|we['’]ll check your video|Copyright checks?/i),
  ])) return "Checks";
  if (await firstVisible([
    root.getByText(/Use cards and an end screen|Add subtitles/i),
  ])) return "Video elements";
  if (await firstVisible([
    root.getByText(/Ad suitability|Tell us about your video|Does your video contain/i),
  ])) return "Ad suitability";
  if (await firstVisible([
    root.getByText(/Monetization|Earn money from your video|Turn on ads/i),
  ])) return "Monetization";
  if (await firstVisible([
    root.locator("#title-textarea"),
  ])) return "Details";
  return "the current upload step";
}

async function visibleYouTubeUploadError(page: Page) {
  const error = await firstVisible([
    page.locator('[role="alert"]'),
    page.locator("#error-message"),
    page.getByText(/upload failed|processing abandoned|daily upload limit|invalid file|couldn['’]t upload/i),
  ]);
  const message = (await error?.textContent().catch(() => ""))?.replace(/\s+/g, " ").trim() || "";
  return message.slice(0, 500);
}

async function advanceYouTubeUploadToVisibility(
  page: Page,
  dialog: Locator,
  signal: AbortSignal,
  reportProgress: (message: string) => void,
) {
  const deadline = Date.now() + youtubeUploadTransitionTimeout();
  for (let transitions = 0; transitions < 10 && Date.now() < deadline; transitions += 1) {
    signal.throwIfAborted();
    const stage = await currentYouTubeUploadStage(page, dialog);
    if (stage === "Visibility") return;
    reportProgress(`Waiting for YouTube's ${stage} step to become ready.`);
    const next = await enabledExactButton(
      page,
      dialog,
      /^Next$/i,
      signal,
      Math.max(1_000, deadline - Date.now()),
    );
    if (!next) {
      const uploadError = await visibleYouTubeUploadError(page);
      throw new Error(uploadError
        ? `YouTube stopped at ${stage}: ${uploadError}`
        : `YouTube's Next button did not become enabled on ${stage} before the upload timeout.`);
    }
    await clickReversibleControl(page, next, signal);
    reportProgress(`YouTube accepted the ${stage} step.`);
    if (stage === "the current upload step") {
      await page.waitForTimeout(1_500);
      continue;
    }
    const transitionDeadline = Math.min(deadline, Date.now() + 30_000);
    let transitioned = false;
    while (Date.now() < transitionDeadline) {
      signal.throwIfAborted();
      const nextStage = await currentYouTubeUploadStage(page, dialog);
      if (nextStage === "Visibility" || nextStage !== stage) {
        transitioned = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!transitioned) {
      throw new Error(`YouTube accepted Next but did not advance beyond ${stage}.`);
    }
  }
  const stage = await currentYouTubeUploadStage(page, dialog);
  const uploadError = await visibleYouTubeUploadError(page);
  throw new Error(uploadError
    ? `YouTube stopped at ${stage}: ${uploadError}`
    : `YouTube did not reach Visibility; it remained on ${stage}.`);
}

async function submitFinalAction(
  finalAction: Locator,
  expectedLabel: RegExp,
  signal: AbortSignal,
  onFinalActionStarting: () => Promise<void>,
) {
  const ariaLabel = await finalAction.getAttribute("aria-label").catch(() => "");
  const visibleText = await finalAction.textContent().catch(() => "");
  if (!exactYouTubeButtonLabelMatches(expectedLabel, ariaLabel, visibleText)) {
    throw new Error("YouTube's final control did not pass its exact label guard.");
  }
  await onFinalActionStarting();
  signal.throwIfAborted();
  await finalAction.click({ timeout: 15_000 });
}

async function youtubeRadioSelected(locator: Locator) {
  return locator.evaluate(element => {
    const radio = element.matches('tp-yt-paper-radio-button, [role="radio"], input[type="radio"]')
      ? element
      : element.closest('tp-yt-paper-radio-button, [role="radio"], label')
        || element.querySelector('tp-yt-paper-radio-button, [role="radio"], input[type="radio"]')
        || element;
    const input = radio instanceof HTMLInputElement
      ? radio
      : radio.querySelector<HTMLInputElement>('input[type="radio"]');
    return radio.getAttribute("aria-checked") === "true"
      || radio.hasAttribute("checked")
      || Boolean(input?.checked)
      || ("checked" in radio && Boolean((radio as HTMLElement & { checked?: boolean }).checked));
  }).catch(() => false);
}

async function selectYouTubeRadio(
  page: Page,
  root: Locator,
  label: RegExp,
  names: string[],
  fieldName: string,
  signal: AbortSignal,
) {
  const nameSelector = names.map(name => `tp-yt-paper-radio-button[name="${name}"], [role="radio"][name="${name}"], input[type="radio"][name="${name}"]`).join(", ");
  const candidates = () => [
    root.getByRole("radio", { name: label }),
    ...(nameSelector ? [root.locator(nameSelector)] : []),
    root.locator("tp-yt-paper-radio-button").filter({ hasText: label }),
  ];
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const radio = await firstVisible(candidates());
    if (radio) {
      if (!await youtubeRadioSelected(radio)) {
        await radio.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
        await radio.click({ timeout: 10_000 });
      }
      const selectionDeadline = Date.now() + 10_000;
      while (Date.now() < selectionDeadline) {
        signal.throwIfAborted();
        for (const locator of candidates()) {
          for (let index = 0, count = Math.min(await locator.count().catch(() => 0), 12); index < count; index += 1) {
            const candidate = locator.nth(index);
            if (await candidate.isVisible().catch(() => false) && await youtubeRadioSelected(candidate)) return;
          }
        }
        await page.waitForTimeout(300);
      }
      throw new Error(`YouTube Studio did not retain the requested ${fieldName}.`);
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`YouTube Studio's requested ${fieldName} option was unavailable.`);
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
    await setServerLocalInputFile(page, target, files.mediaFilePath(job.media[0].storageKey));
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
  const inputCandidates = () => [
    page.locator('ytcp-uploads-dialog input[type="file"]'),
    page.locator('input[type="file"][accept*="video"]'),
    page.locator('input[type="file"]'),
  ];
  reportProgress("Uploading the video to YouTube Studio.");
  const filePath = files.mediaFilePath(job.media[0].storageKey);
  const useExistingInput = async (timeout: number) => {
    const input = await waitAttached(page, inputCandidates(), signal, timeout);
    if (!input) return false;
    await setServerLocalInputFile(page, input, filePath);
    return true;
  };
  const clickUploadControl = async (control: Locator) => {
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 8_000 }).catch(() => null);
    await clickReversibleControl(page, control, signal);
    const chooser = await chooserPromise;
    if (chooser) {
      await setServerLocalFileChooserFile(page, chooser, filePath);
      return true;
    }
    return useExistingInput(5_000);
  };

  let attached = await useExistingInput(5_000);
  if (!attached) {
    const selectFiles = await waitVisible(page, [
      page.getByRole("button", { name: /Select files/i }),
      page.getByText(/^Select files$/i),
      page.locator("ytcp-button").filter({ hasText: /Select files/i }),
    ], signal, 8_000);
    if (selectFiles) attached = await clickUploadControl(selectFiles);
  }
  if (!attached) {
    const directUpload = await waitVisible(page, [
      page.getByRole("button", { name: /^Upload videos$/i }),
      page.getByText(/^Upload videos$/i),
      page.locator("ytcp-button").filter({ hasText: /^Upload videos$/i }),
    ], signal, 8_000);
    if (directUpload) attached = await clickUploadControl(directUpload);
  }
  if (!attached) {
    const create = await waitVisible(page, [
      page.getByRole("button", { name: /^Create$/i }),
      page.locator('button[aria-label*="Create" i], button[title*="Create" i]'),
      page.locator("ytcp-button#create-icon"),
      page.locator("#create-icon").filter({ hasText: /Create/i }),
      page.getByText(/^Create$/i),
    ], signal, 20_000);
    if (create) {
      await clickReversibleControl(page, create, signal);
      const upload = await waitVisible(page, [
        page.getByRole("menuitem", { name: /Upload videos/i }),
        page.locator('[role="menuitem"]').filter({ hasText: /Upload videos/i }),
        page.getByText(/^Upload videos$/i),
      ], signal, 15_000);
      if (upload) attached = await clickUploadControl(upload);
    }
  }
  if (!attached) {
    const finalSelectFiles = await waitVisible(page, [
      page.getByRole("button", { name: /Select files/i }),
      page.getByText(/^Select files$/i),
      page.locator("ytcp-button").filter({ hasText: /Select files/i }),
    ], signal, 10_000);
    if (finalSelectFiles) attached = await clickUploadControl(finalSelectFiles);
  }
  if (!attached) attached = await useExistingInput(5_000);
  if (!attached) throw new Error("YouTube Studio did not expose an Upload videos, Select files, or video file-input control.");
  // Current Studio builds sometimes render the metadata step without the
  // legacy ytcp-uploads-dialog custom element. The title is the stable proof
  // that the selected video was accepted, so derive the owning root from it.
  const title = await waitVisible(page, [
    page.locator("ytcp-uploads-dialog #title-textarea #textbox"),
    page.locator("#title-textarea #textbox"),
    page.locator('#title-textarea[contenteditable="true"]'),
    page.locator("#title-textarea"),
  ], signal, 120_000);
  if (!title) throw new Error("YouTube Studio accepted the file but did not show its video metadata fields.");
  const customDialog = title.locator("xpath=ancestor::ytcp-uploads-dialog[1]");
  const roleDialog = title.locator("xpath=ancestor::*[@role='dialog'][1]");
  const dialog = await customDialog.count() ? customDialog : await roleDialog.count() ? roleDialog : page.locator("body");
  const description = await waitVisible(page, [
    dialog.locator("#description-textarea #textbox"),
    page.locator("#description-textarea #textbox"),
    dialog.locator('#description-textarea[contenteditable="true"]'),
    page.locator("#description-textarea"),
  ], signal, 60_000);
  if (!description) throw new Error("YouTube Studio's description editor was unavailable.");
  reportProgress("Filling and verifying the YouTube title and description.");
  await fillVerifiedYouTubeField(page, title, options.title, "video title");
  await fillVerifiedYouTubeField(page, description, job.caption, "video description");

  const audienceText = options.audience === "made_for_kids"
    ? /Yes,? (?:it['’]s|this video is) made for kids/i
    : /No,? (?:it['’]s|this video is) not made for kids/i;
  const audienceNames = options.audience === "made_for_kids"
    ? ["VIDEO_MADE_FOR_KIDS_MFK", "MADE_FOR_KIDS"]
    : ["VIDEO_MADE_FOR_KIDS_NOT_MFK", "NOT_MADE_FOR_KIDS"];
  reportProgress(`Selecting the dashboard audience choice: ${options.audience === "made_for_kids" ? "made for kids" : "not made for kids"}.`);
  await selectYouTubeRadio(page, dialog, audienceText, audienceNames, "audience classification", signal);

  // Channels can have extra monetization, ad-suitability, or rights screens.
  // Follow the visible Studio state until Visibility instead of assuming that
  // every account has exactly three Next transitions.
  await advanceYouTubeUploadToVisibility(page, dialog, signal, reportProgress);

  const visibilityText = new RegExp(`^${options.visibility}$`, "i");
  reportProgress(`Selecting the dashboard visibility choice: ${options.visibility}.`);
  await selectYouTubeRadio(
    page,
    dialog,
    visibilityText,
    [options.visibility.toUpperCase()],
    `${options.visibility} visibility`,
    signal,
  );

  const finalLabel = options.visibility === "public" ? /^(?:Publish|Save)$/i : /^Save$/i;
  const finalAction = await enabledExactButton(page, dialog, finalLabel, signal, youtubeUploadTransitionTimeout());
  if (!finalAction) throw new Error("YouTube Studio's exact final Save or Publish button did not become enabled.");
  const platformPostUrl = await dialog.locator('a[href*="youtu.be"], a[href*="youtube.com/watch"]').first().getAttribute("href").catch(() => null);
  reportProgress(`Final YouTube ${options.visibility} action authorized. Recording the irreversible action before clicking.`);
  await submitFinalAction(finalAction, finalLabel, signal, onFinalActionStarting);
  const confirmationDeadline = Date.now() + 120_000;
  let confirmed = false;
  while (Date.now() < confirmationDeadline) {
    signal.throwIfAborted();
    const shareDialog = await firstVisible([page.locator("ytcp-video-share-dialog")]);
    if (shareDialog) { confirmed = true; break; }
    const notices = page.locator('[role="alert"], [role="status"], [aria-live], ytcp-video-share-dialog');
    for (let index = 0, count = Math.min(await notices.count().catch(() => 0), 20); index < count; index += 1) {
      const notice = notices.nth(index);
      if (!await notice.isVisible().catch(() => false)) continue;
      if (isYouTubePublishSuccessText(await notice.textContent().catch(() => ""))) {
        confirmed = true;
        break;
      }
    }
    if (confirmed) break;
    const failure = await firstVisible([
      page.locator('[role="alert"], [role="status"], [aria-live]').filter({ hasText: /couldn['’]t (?:save|publish)|failed to (?:save|publish)|publish failed|try again/i }),
    ]);
    const failureText = (await failure?.textContent().catch(() => ""))?.replace(/\s+/g, " ").trim();
    if (failureText) throw new Error(`YouTube rejected the final action: ${failureText}`);
    await page.waitForTimeout(750);
  }
  if (!confirmed) {
    throw new Error("YouTube did not show an explicit publish/save confirmation. Closing the upload dialog alone is not proof of delivery.");
  }
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
