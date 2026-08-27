import type { BrowserContext, Locator, Page, Request, Response } from "playwright-core";
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

type YouTubeCommunityPublishEvidence = {
  state: "PUBLISHED";
} | {
  state: "FAILED";
  message: string;
};

class YouTubeCommunityPublishRejectedError extends Error {}

export function isYouTubeCommunityCreateRequest(value: string) {
  try {
    return /\/youtubei\/v1\/backstage\/(?:create_post|create_backstage_post)\/?$/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

export function interpretYouTubeCommunityPublishResponse(statusCode: number, body: unknown): YouTubeCommunityPublishEvidence {
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const error = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : null;
  const errorMessage = typeof error?.message === "string" ? error.message.replace(/\s+/g, " ").trim() : "";
  if (statusCode >= 200 && statusCode < 300 && !error) return { state: "PUBLISHED" };
  return {
    state: "FAILED",
    message: (errorMessage || `YouTube rejected the Community post request with HTTP ${statusCode}.`).slice(0, 700),
  };
}

function isYouTubeCommunityPublishSuccessText(value: string | null | undefined) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return /(?:Post created|Post published|Your post (?:has been )?(?:created|published)|Successfully (?:created|published) post)/i.test(text)
    && !/(?:not|wasn['’]t|couldn['’]t|failed|error)/i.test(text);
}

async function enabledExactButton(page: Page, root: Locator, label: RegExp, signal: AbortSignal, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const candidates = [
      root.locator("#next-button, #done-button"),
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

function youtubeUploadStepReadyTimeout() {
  const configured = Number(process.env.YOUTUBE_UPLOAD_STEP_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return 3 * 60_000;
  return Math.max(30_000, Math.min(15 * 60_000, Math.floor(configured)));
}

async function resolveYouTubeUploadRoot(page: Page) {
  // The ytcp-uploads-dialog host itself has a zero-sized box in current
  // Studio builds, but it remains the stable owner while Details, Video
  // elements, Checks, and Visibility replace their inner DOM. Never anchor
  // this locator to a field from one panel: that field is removed on Next.
  const uploadHost = page.locator("ytcp-uploads-dialog").first();
  if (await uploadHost.count().catch(() => 0) && await firstVisible([
    uploadHost.locator("#title-textarea"),
    uploadHost.locator("#next-button"),
    uploadHost.locator("#done-button"),
    uploadHost.getByText(/Use cards and an end screen|check your video for issues|Choose when to publish|Save or publish/i),
  ])) return uploadHost;

  // Retain a fallback for Studio variants that omit the custom host. Pick a
  // currently visible dialog only when it contains upload-specific controls.
  const dialogs = page.locator('tp-yt-paper-dialog[role="dialog"], [role="dialog"]');
  for (let index = 0, count = Math.min(await dialogs.count().catch(() => 0), 20); index < count; index += 1) {
    const candidate = dialogs.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    if (await firstVisible([
      candidate.locator("#title-textarea"),
      candidate.locator("#next-button"),
      candidate.locator("#done-button"),
      candidate.getByText(/Use cards and an end screen|check your video for issues|Choose when to publish|Save or publish/i),
    ])) return candidate;
  }
  return null;
}

async function waitForYouTubeUploadRoot(page: Page, signal: AbortSignal, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const root = await resolveYouTubeUploadRoot(page);
    if (root) return root;
    await page.waitForTimeout(300);
  }
  return null;
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
  return "Unknown";
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
  signal: AbortSignal,
  reportProgress: (message: string) => void,
) {
  const deadline = Date.now() + youtubeUploadTransitionTimeout();
  for (let transitions = 0; transitions < 10 && Date.now() < deadline; transitions += 1) {
    signal.throwIfAborted();
    const dialog = await waitForYouTubeUploadRoot(page, signal, 15_000);
    if (!dialog) throw new Error("YouTube Studio's active upload dialog disappeared before Visibility.");
    const stage = await currentYouTubeUploadStage(page, dialog);
    if (stage === "Visibility") return;
    if (stage === "Unknown") {
      throw new Error("YouTube Studio displayed an unrecognized upload step instead of Details, Video elements, Checks, or Visibility.");
    }
    reportProgress(`Waiting for YouTube's ${stage} step to become ready.`);
    const next = await enabledExactButton(
      page,
      dialog,
      /^Next$/i,
      signal,
      Math.max(1_000, Math.min(youtubeUploadStepReadyTimeout(), deadline - Date.now())),
    );
    if (!next) {
      const uploadError = await visibleYouTubeUploadError(page);
      throw new Error(uploadError
        ? `YouTube stopped at ${stage}: ${uploadError}`
        : `YouTube's Next button did not become enabled on ${stage} before the upload timeout.`);
    }
    await clickReversibleControl(page, next, signal);
    reportProgress(`YouTube accepted the ${stage} step.`);
    const transitionDeadline = Math.min(deadline, Date.now() + 30_000);
    let transitioned = false;
    while (Date.now() < transitionDeadline) {
      signal.throwIfAborted();
      const nextDialog = await resolveYouTubeUploadRoot(page);
      const nextStage = nextDialog ? await currentYouTubeUploadStage(page, nextDialog) : "Unknown";
      if (nextStage !== "Unknown" && (nextStage === "Visibility" || nextStage !== stage)) {
        transitioned = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!transitioned) {
      throw new Error(`YouTube accepted Next but did not advance beyond ${stage}.`);
    }
  }
  const dialog = await resolveYouTubeUploadRoot(page);
  const stage = dialog ? await currentYouTubeUploadStage(page, dialog) : "Unknown";
  const uploadError = await visibleYouTubeUploadError(page);
  throw new Error(uploadError
    ? `YouTube stopped at ${stage}: ${uploadError}`
    : `YouTube did not reach Visibility; it remained on ${stage}.`);
}

export function youtubeFinalActionLabelMatches(
  visibility: "public" | "unlisted" | "private",
  ...values: Array<string | null | undefined>
) {
  return exactYouTubeButtonLabelMatches(visibility === "public" ? /^Publish$/i : /^Save$/i, ...values);
}

export function youtubeClosedUploadConfirmsFinalAction(
  closedForMs: number,
  pageUrl: string,
  failureText: string | null | undefined,
) {
  if (closedForMs < 8_000 || String(failureText || "").trim()) return false;
  try {
    const url = new URL(pageUrl);
    return url.hostname === "studio.youtube.com"
      && !/\/(?:signin|oops|error)(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
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

async function visibleYouTubeShareConfirmation(page: Page, countBeforeFinalAction: number) {
  const dialogs = page.locator("ytcp-video-share-dialog");
  for (let index = 0, count = Math.min(await dialogs.count().catch(() => 0), 5); index < count; index += 1) {
    const dialog = dialogs.nth(index);
    const text = (await dialog.textContent().catch(() => ""))?.replace(/\s+/g, " ").trim() || "";
    const visibleContent = await firstVisible([
      dialog.locator('tp-yt-paper-dialog, [role="dialog"]'),
      dialog.getByText(/Video published|Video saved|Share link/i),
    ]);
    const urlElement = dialog.locator('a[href*="youtu.be"], a[href*="youtube.com/watch"], input[value*="youtu.be"], input[value*="youtube.com/watch"]').first();
    const url = await urlElement.evaluate(element => {
      if (element instanceof HTMLInputElement) return element.value;
      return element.getAttribute("href") || element.textContent || "";
    }).catch(() => null);
    const newlyAttached = index >= countBeforeFinalAction;
    if (!newlyAttached
      && !await dialog.isVisible().catch(() => false)
      && !visibleContent
      && !url
      && !isYouTubePublishSuccessText(text)) continue;
    return { url };
  }
  return null;
}

function youtubeVideoId(url: string | null | undefined) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const candidate = parsed.hostname === "youtu.be" ? parsed.pathname.slice(1) : parsed.searchParams.get("v") || "";
    return /^[A-Za-z0-9_-]{6,20}$/.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

async function visibleSavedYouTubeRow(page: Page, platformPostUrl: string | null | undefined) {
  const videoId = youtubeVideoId(platformPostUrl);
  if (!videoId || await resolveYouTubeUploadRoot(page)) return false;
  return Boolean(await firstVisible([
    page.locator(`a[href*="${videoId}"]`),
  ]));
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

async function communityImagePreviewPresent(composer: Locator) {
  if (await firstVisible([
    composer.getByText(/Edit preview/i),
    composer.getByRole("button", { name: /Remove image|Delete image/i }),
  ])) return true;

  const images = composer.locator("img");
  for (let index = 0, count = Math.min(await images.count().catch(() => 0), 30); index < count; index += 1) {
    const image = images.nth(index);
    const preview = await image.evaluate(element => {
      const candidate = element as HTMLImageElement;
      const rect = candidate.getBoundingClientRect();
      const source = candidate.currentSrc || candidate.src || "";
      const visible = rect.width >= 90 && rect.height >= 90
        && candidate.naturalWidth >= 40 && candidate.naturalHeight >= 40
        && window.getComputedStyle(candidate).visibility !== "hidden";
      const avatar = /avatar|profile|yt3\.ggpht|s32-|s48-|s88-/i.test(source);
      return visible && !avatar;
    }).catch(() => false);
    if (preview) return true;
  }
  return false;
}

async function waitForCommunityImagePreview(page: Page, composer: Locator, signal: AbortSignal, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (await communityImagePreviewPresent(composer)) return;
    const uploadError = await firstVisible([
      composer.locator('[role="alert"], [role="status"], [aria-live]').filter({ hasText: /failed|error|unsupported|try again/i }),
      page.locator('[role="alert"], [role="status"], [aria-live]').filter({ hasText: /image.*(?:failed|error|unsupported)|(?:failed|unsupported).*image/i }),
    ]);
    const message = (await uploadError?.textContent().catch(() => ""))?.replace(/\s+/g, " ").trim();
    if (message) throw new Error(`YouTube rejected the Community image: ${message}`);
    await page.waitForTimeout(500);
  }
  throw new Error("YouTube's Community image preview did not appear after upload. Nothing was posted.");
}

async function clickCommunityImageControl(page: Page, composer: Locator, signal: AbortSignal) {
  const control = await firstVisible([
    composer.getByRole("button", { name: /^Image$|Add image/i }),
    composer.locator('button, [role="button"], ytd-button-renderer').filter({ hasText: /^Image$/i }),
    composer.getByText(/^Image$/i),
  ]);
  if (control) {
    await clickReversibleControl(page, control, signal);
    return;
  }

  // Some current Community composer builds expose the Image action only as
  // an unlabeled visual slot. This is the same reversible control used by the
  // older publishing flow; the final Post action is never clicked by position.
  const box = await composer.boundingBox().catch(() => null);
  if (!box) throw new Error("YouTube's Community image control was unavailable.");
  await page.mouse.click(box.x + 74, box.y + Math.max(96, Math.min(166, box.height - 92)));
  await page.waitForTimeout(700);
}

async function attachCommunityImage(
  page: Page,
  composer: Locator,
  filePath: string,
  signal: AbortSignal,
) {
  const inputCountBefore = await page.locator('input[type="file"]').count().catch(() => 0);
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null);
  await clickCommunityImageControl(page, composer, signal);
  const chooser = await chooserPromise;
  if (chooser) {
    await setServerLocalFileChooserFile(page, chooser, filePath);
  } else {
    const imageInputs = () => [
      composer.locator('input[type="file"][accept*="image" i]'),
      page.locator('input[type="file"][accept*="image" i]'),
      composer.locator('input[type="file"][accept*=".png" i], input[type="file"][accept*=".jpg" i], input[type="file"][accept*=".jpeg" i]'),
      page.locator('input[type="file"][accept*=".png" i], input[type="file"][accept*=".jpg" i], input[type="file"][accept*=".jpeg" i]'),
    ];
    let input = await waitAttached(page, imageInputs(), signal, 8_000);
    if (!input) {
      const allInputs = page.locator('input[type="file"]');
      const count = await allInputs.count().catch(() => 0);
      if (count > inputCountBefore) input = allInputs.last();
    }
    if (!input) throw new Error("YouTube's Community image input was unavailable. Nothing was posted.");
    await setServerLocalInputFile(page, input, filePath);
  }
  await waitForCommunityImagePreview(page, composer, signal);
}

async function communityComposerReset(
  composer: Locator,
  editor: Locator,
  expectedCaption: string,
  requiredImage: boolean,
) {
  if (!await composer.isVisible().catch(() => false)) return true;
  const currentText = (await editableText(editor)).replace(/\s+/g, " ").trim();
  const expectedText = expectedCaption.replace(/\s+/g, " ").trim();
  if (expectedText && currentText.includes(expectedText)) return false;
  if (requiredImage && await communityImagePreviewPresent(composer)) return false;
  const enabledPost = await firstEnabledVisible([
    composer.getByRole("button", { name: /^Post$/i }),
    composer.locator('button, [role="button"]').filter({ hasText: /^Post$/i }),
  ]);
  return !enabledPost;
}

async function waitForCommunityPostConfirmation(input: {
  page: Page;
  composer: Locator;
  editor: Locator;
  expectedCaption: string;
  requiredImage: boolean;
  signal: AbortSignal;
  getNetworkEvidence: () => YouTubeCommunityPublishEvidence | null;
  getRequestFailure: () => string | null;
}) {
  const { page, composer, editor, expectedCaption, requiredImage, signal, getNetworkEvidence, getRequestFailure } = input;
  const deadline = Date.now() + 120_000;
  let resetAt = 0;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const networkEvidence = getNetworkEvidence();
    if (networkEvidence?.state === "PUBLISHED") return;
    if (networkEvidence?.state === "FAILED") throw new YouTubeCommunityPublishRejectedError(networkEvidence.message);

    const failure = await firstVisible([
      page.locator('[role="alert"], [role="status"], [aria-live]').filter({ hasText: /couldn['’]t (?:create|publish)|failed to (?:create|publish)|post failed|try again/i }),
    ]);
    const failureText = (await failure?.textContent().catch(() => ""))?.replace(/\s+/g, " ").trim();
    if (failureText) throw new YouTubeCommunityPublishRejectedError(`YouTube rejected the Community post: ${failureText}`);

    const notices = page.locator('[role="alert"], [role="status"], [aria-live]');
    for (let index = 0, count = Math.min(await notices.count().catch(() => 0), 20); index < count; index += 1) {
      const notice = notices.nth(index);
      if (!await notice.isVisible().catch(() => false)) continue;
      if (isYouTubeCommunityPublishSuccessText(await notice.textContent().catch(() => ""))) return;
    }

    // Current YouTube keeps ytd-backstage-post-dialog-renderer mounted after a
    // successful post. Its cleared editor, removed attachment preview, and
    // disabled Post control are the UI acknowledgement; require that reset to
    // remain stable so a transient rerender cannot be mistaken for delivery.
    if (await communityComposerReset(composer, editor, expectedCaption, requiredImage)) {
      resetAt ||= Date.now();
      if (Date.now() - resetAt >= 8_000) return;
    } else {
      resetAt = 0;
    }
    await page.waitForTimeout(500);
  }
  const requestFailure = getRequestFailure();
  throw new Error(requestFailure
    ? `YouTube's Community publish request failed: ${requestFailure}`
    : "YouTube did not confirm the Community post after the final Post action.");
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
    await attachCommunityImage(page, composer, files.mediaFilePath(job.media[0].storageKey), signal);
    reportProgress("YouTube rendered the selected Community image preview.");
  }
  const post = await enabledExactButton(page, composer, /^Post$/i, signal, 120_000);
  if (!post) throw new Error("YouTube's exact Community Post button did not become enabled.");
  if (job.media[0]) await waitForCommunityImagePreview(page, composer, signal, 30_000);

  let publishEvidence: YouTubeCommunityPublishEvidence | null = null;
  let publishRequestFailure: string | null = null;
  const responseListener = (response: Response) => {
    if (!isYouTubeCommunityCreateRequest(response.url())) return;
    void response.json().catch(() => null).then(body => {
      publishEvidence = interpretYouTubeCommunityPublishResponse(response.status(), body);
    });
  };
  const requestFailedListener = (request: Request) => {
    if (!isYouTubeCommunityCreateRequest(request.url())) return;
    publishRequestFailure = request.failure()?.errorText || "the browser reported a network failure";
  };
  page.on("response", responseListener);
  page.on("requestfailed", requestFailedListener);
  reportProgress("Final YouTube Community Post authorized. Recording the irreversible action before clicking.");
  try {
    await submitFinalAction(post, /^Post$/i, signal, onFinalActionStarting);
    reportProgress("YouTube Community Post submitted. Verifying platform delivery.");
    await waitForCommunityPostConfirmation({
      page,
      composer,
      editor,
      expectedCaption: job.caption,
      requiredImage: Boolean(job.media[0]),
      signal,
      getNetworkEvidence: () => publishEvidence,
      getRequestFailure: () => publishRequestFailure,
    });
  } finally {
    page.off("response", responseListener);
    page.off("requestfailed", requestFailedListener);
  }
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
  // The visible title proves that Studio accepted the selected video. The
  // upload root is resolved independently because Studio removes this title
  // node when it advances to Video elements.
  const title = await waitVisible(page, [
    page.locator("ytcp-uploads-dialog #title-textarea #textbox"),
    page.locator("#title-textarea #textbox"),
    page.locator('#title-textarea[contenteditable="true"]'),
    page.locator("#title-textarea"),
  ], signal, 120_000);
  if (!title) throw new Error("YouTube Studio accepted the file but did not show its video metadata fields.");
  const detailsDialog = await waitForYouTubeUploadRoot(page, signal);
  if (!detailsDialog) throw new Error("YouTube Studio's Details upload dialog was unavailable.");
  const description = await waitVisible(page, [
    detailsDialog.locator("#description-textarea #textbox"),
    page.locator("#description-textarea #textbox"),
    detailsDialog.locator('#description-textarea[contenteditable="true"]'),
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
  await selectYouTubeRadio(page, detailsDialog, audienceText, audienceNames, "audience classification", signal);

  // Channels can have extra monetization, ad-suitability, or rights screens.
  // Follow the visible Studio state until Visibility instead of assuming that
  // every account has exactly three Next transitions.
  await advanceYouTubeUploadToVisibility(page, signal, reportProgress);

  const visibilityDialog = await waitForYouTubeUploadRoot(page, signal);
  if (!visibilityDialog || await currentYouTubeUploadStage(page, visibilityDialog) !== "Visibility") {
    throw new Error("YouTube Studio did not retain its Visibility step.");
  }
  const visibilityText = new RegExp(`^${options.visibility}$`, "i");
  reportProgress(`Selecting the dashboard visibility choice: ${options.visibility}.`);
  await selectYouTubeRadio(
    page,
    visibilityDialog,
    visibilityText,
    [options.visibility.toUpperCase()],
    `${options.visibility} visibility`,
    signal,
  );

  // Live Studio currently changes #done-button to Publish only after Public
  // is selected; Unlisted and Private use Save. Never accept Save for Public,
  // because that would silently preserve a private draft.
  const finalLabel = options.visibility === "public" ? /^Publish$/i : /^Save$/i;
  const finalAction = await enabledExactButton(page, visibilityDialog, finalLabel, signal, 60_000);
  if (!finalAction) throw new Error("YouTube Studio's exact final Save or Publish button did not become enabled.");
  const finalAriaLabel = await finalAction.getAttribute("aria-label").catch(() => "");
  const finalVisibleText = await finalAction.textContent().catch(() => "");
  if (!youtubeFinalActionLabelMatches(options.visibility, finalAriaLabel, finalVisibleText)) {
    throw new Error(`YouTube Studio did not expose the final ${options.visibility === "public" ? "Publish" : "Save"} action required by the dashboard visibility choice.`);
  }
  let platformPostUrl = await visibilityDialog.locator('a[href*="youtu.be"], a[href*="youtube.com/watch"]').first().getAttribute("href").catch(() => null);
  const shareDialogCountBeforeFinalAction = await page.locator("ytcp-video-share-dialog").count().catch(() => 0);
  reportProgress(`Final YouTube ${options.visibility} action authorized. Recording the irreversible action before clicking.`);
  await submitFinalAction(finalAction, finalLabel, signal, onFinalActionStarting);
  const confirmationDeadline = Date.now() + 120_000;
  let confirmed = false;
  let uploadClosedAt = 0;
  while (Date.now() < confirmationDeadline) {
    signal.throwIfAborted();
    const shareConfirmation = await visibleYouTubeShareConfirmation(page, shareDialogCountBeforeFinalAction);
    if (shareConfirmation) {
      platformPostUrl = shareConfirmation.url || platformPostUrl;
      confirmed = true;
      break;
    }
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
    if (await visibleSavedYouTubeRow(page, platformPostUrl)) {
      confirmed = true;
      break;
    }
    // Current Studio builds do not consistently render a visible success
    // toast or share dialog. After the exact guarded Publish/Save click, a
    // continuously closed upload surface on a healthy Studio page is the
    // browser's acknowledgement. The safety window prevents a transient DOM
    // replacement from being mistaken for delivery, and a visible rejection
    // always wins above. This path never clicks or retries the final action.
    if (await resolveYouTubeUploadRoot(page)) {
      uploadClosedAt = 0;
    } else {
      uploadClosedAt ||= Date.now();
      if (youtubeClosedUploadConfirmsFinalAction(Date.now() - uploadClosedAt, page.url(), failureText)) {
        confirmed = true;
        break;
      }
    }
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
      if (error instanceof YouTubeCommunityPublishRejectedError) {
        return { state: "FAILED" as const, errorCode: "YOUTUBE_COMMUNITY_REJECTED", errorMessage: error.message };
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
