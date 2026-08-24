import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import type { ClaimedPublishingJob, PublishingPreviewExecutor } from "./executor.ts";
import { detectServerBrowserExecutable } from "./login-browser.ts";
import type { AutomationFileStore } from "./profile-store.ts";

const INSTAGRAM_HOME_URL = "https://www.instagram.com/";

export class InstagramPreviewPreparationError extends Error {
  constructor(message: string, readonly diagnosticScreenshot?: Buffer) {
    super(message);
  }
}

export class InstagramPreviewLoginRequiredError extends InstagramPreviewPreparationError {}

async function firstVisible(locators: Locator[]) {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 8); index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function waitForVisible(page: Page, locators: Locator[], signal: AbortSignal, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const locator = await firstVisible(locators);
    if (locator) return locator;
    await page.waitForTimeout(200);
  }
  return null;
}

async function safePreviewClick(locator: Locator, timeout: number) {
  const attributes = await Promise.all([
    locator.getAttribute("aria-label", { timeout: 750 }).catch(() => null),
    locator.getAttribute("title", { timeout: 750 }).catch(() => null),
    locator.textContent({ timeout: 750 }).catch(() => null),
  ]);
  const label = attributes.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (/\bshare\b/i.test(label)) {
    throw new Error("The preview safety guard refused Instagram's Share control.");
  }
  await locator.click({ force: true, timeout });
}

async function clickIfVisible(locator: Locator, timeout = 1_500) {
  try {
    await safePreviewClick(locator.first(), timeout);
    return true;
  } catch {
    return false;
  }
}

async function dismissPrompts(page: Page) {
  const choices = [
    page.getByRole("button", { name: /^Not now$/i }),
    page.getByRole("button", { name: /Only allow essential cookies/i }),
    page.getByRole("button", { name: /Decline optional cookies/i }),
    page.getByRole("button", { name: /^Decline$/i }),
    page.getByRole("button", { name: /Accept all/i }),
  ];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const choice of choices) {
      if (await clickIfVisible(choice)) {
        await page.waitForTimeout(250);
        break;
      }
    }
  }
}

async function verifyAuthenticated(page: Page, context: BrowserContext, signal: AbortSignal) {
  const cookies = await context.cookies(INSTAGRAM_HOME_URL);
  const sessionCookie = cookies.some(cookie => cookie.name === "sessionid" && Boolean(cookie.value));
  const authenticatedSignal = await waitForVisible(page, [
    page.getByRole("link", { name: /^Home$/i }),
    page.getByRole("link", { name: /Profile/i }),
    page.locator('svg[aria-label="Home"]'),
    page.locator('svg[aria-label="New post"]'),
    page.locator('svg[aria-label="Create"]'),
  ], signal, 15_000);
  if (!sessionCookie || !authenticatedSignal || /\/accounts\/(login|onetap|challenge)/i.test(page.url())) {
    throw new InstagramPreviewLoginRequiredError("The saved Instagram session needs to be connected again.");
  }
}

async function composerReady(page: Page, signal: AbortSignal, timeoutMs: number) {
  return waitForVisible(page, [
    page.getByText(/Create new post/i),
    page.getByRole("button", { name: /Select from computer/i }),
    page.locator('[role="dialog"] input[type="file"]'),
  ], signal, timeoutMs);
}

async function openPostComposer(page: Page, signal: AbortSignal) {
  const create = await firstVisible([
    page.getByRole("link", { name: /Create|New post/i }),
    page.getByRole("button", { name: /Create|New post/i }),
    page.locator('svg[aria-label="New post"]'),
    page.locator('svg[aria-label="Create"]'),
    page.locator('a[href*="/create"]'),
  ]);
  if (!create) throw new Error("Instagram's Create control was not available.");
  await safePreviewClick(create, 10_000);
  if (await composerReady(page, signal, 2_500)) return;

  const post = await waitForVisible(page, [
    page.getByRole("menuitem", { name: /^Post$/i }),
    page.getByRole("button", { name: /^Post$/i }),
    page.getByRole("link", { name: /^Post$/i }),
    page.locator('[role="menu"] [role="button"]').filter({ hasText: /^Post$/i }),
    page.getByText(/^Post$/i),
  ], signal, 15_000);
  if (!post) throw new Error("Instagram's Post composer option was not available.");
  await safePreviewClick(post, 10_000);
  if (!await composerReady(page, signal, 20_000)) {
    throw new Error("Instagram's post composer did not open.");
  }
}

async function uploadOneImage(page: Page, mediaPath: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const dialogInput = page.locator('[role="dialog"] input[type="file"]').last();
  const input = (await dialogInput.count()) > 0 ? dialogInput : page.locator('input[type="file"]').last();
  if ((await input.count()) < 1) throw new Error("Instagram's media input was not available.");
  await input.setInputFiles(mediaPath);
  const crop = await waitForVisible(page, [page.getByText(/^Crop$/i)], signal, 60_000);
  if (!crop) throw new Error("Instagram did not accept the preview image.");
  await clickIfVisible(page.getByRole("button", { name: /^OK$/i }), 2_500);
}

async function findCropToggleByPosition(page: Page) {
  const cropDialog = page.getByText(/^Crop$/i).first().locator("xpath=ancestor::*[@role='dialog'][1]");
  const dialogBox = await cropDialog.boundingBox().catch(() => null);
  if (!dialogBox) return null;

  const controls = cropDialog.locator('button, [role="button"]');
  const count = await controls.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 30); index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible().catch(() => false)) continue;
    const box = await control.boundingBox().catch(() => null);
    if (!box) continue;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const nearBottomLeft = centerX <= dialogBox.x + 100 && centerY >= dialogBox.y + dialogBox.height - 100;
    if (nearBottomLeft) return control;
  }
  return null;
}

async function selectOriginalAspect(page: Page, signal: AbortSignal) {
  const cropScreen = await waitForVisible(page, [page.getByText(/^Crop$/i)], signal, 10_000);
  if (!cropScreen) throw new Error("Instagram's crop screen was not available.");

  const cropToggle = await firstVisible([
    page.getByRole("button", { name: /Select crop|Crop|Original/i }),
    page.locator('svg[aria-label*="Select crop" i]'),
    page.locator('svg[aria-label*="Crop" i]'),
  ]) || await findCropToggleByPosition(page);
  if (!cropToggle) throw new Error("Instagram's crop selector was not available.");
  await safePreviewClick(cropToggle, 10_000);

  const originalOption = await waitForVisible(page, [
    page.getByText(/^Original$/i),
    page.getByRole("button", { name: /^Original$/i }),
    page.locator('[role="button"]').filter({ hasText: /^Original$/i }),
  ], signal, 10_000);
  if (!originalOption) throw new Error("Instagram's Original crop option was not available.");
  await safePreviewClick(originalOption, 10_000);
  await page.waitForTimeout(250);
}

async function advanceToShareScreen(page: Page, signal: AbortSignal) {
  const cropNext = await waitForVisible(page, [
    page.getByRole("button", { name: /^Next$/i }),
    page.getByText(/^Next$/i),
  ], signal, 10_000);
  if (!cropNext) throw new Error("Instagram's crop Next control was not available.");
  await safePreviewClick(cropNext, 10_000);

  const editReady = await waitForVisible(page, [
    page.getByText(/^Edit$/i),
    page.getByText(/^Edit video$/i),
    page.getByText(/^Filters$/i),
    page.getByText(/^Adjustments$/i),
  ], signal, 60_000);
  if (!editReady) throw new Error("Instagram's edit screen did not appear.");
  const editNext = await firstVisible([
    page.getByRole("button", { name: /^Next$/i }),
    page.getByText(/^Next$/i),
  ]);
  if (!editNext) throw new Error("Instagram's edit Next control was not available.");
  await safePreviewClick(editNext, 10_000);

  const shareScreen = await waitForVisible(page, [
    page.getByRole("button", { name: /^Share$/i }),
    page.getByText(/^Share$/i),
    page.getByPlaceholder(/Write a caption/i),
    page.locator('textarea[aria-label*="caption" i]'),
    page.locator('[contenteditable="true"][aria-label*="caption" i]'),
  ], signal, 60_000);
  if (!shareScreen) throw new Error("Instagram's final composer screen did not appear.");
}

async function fillCaptionAndConfirmShareIsVisible(page: Page, caption: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (caption.trim()) {
    const editor = await firstVisible([
      page.getByRole("textbox", { name: /caption/i }),
      page.getByPlaceholder(/Write a caption/i),
      page.locator('textarea[aria-label*="caption" i]'),
      page.locator('[contenteditable="true"][aria-label*="caption" i]'),
    ]);
    if (!editor) throw new Error("Instagram's caption field was not available.");
    await editor.fill(caption);
  }
  const share = await firstVisible([
    page.getByRole("button", { name: /^Share$/i }),
    page.getByText(/^Share$/i),
  ]);
  if (!share) throw new Error("Instagram's Share control was not visible for the preview.");
  // Safety boundary: visibility is the terminal step. This module never clicks Share.
}

export async function prepareInstagramFinalComposer(input: {
  page: Page;
  context: BrowserContext;
  job: ClaimedPublishingJob;
  mediaPath: string;
  signal: AbortSignal;
  reportProgress: (message: string) => void;
  setStage: (stage: string) => void;
}) {
  const { page, context, job, mediaPath, signal, reportProgress, setStage } = input;
  reportProgress("Opening Instagram with the saved server session.");
  await page.goto(INSTAGRAM_HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissPrompts(page);
  await verifyAuthenticated(page, context, signal);
  setStage("opening Instagram's post composer");
  reportProgress("Saved Instagram session verified. Opening the post composer.");
  await openPostComposer(page, signal);
  setStage("uploading the test image");
  reportProgress("Uploading the test image into Instagram's composer.");
  await uploadOneImage(page, mediaPath, signal);
  setStage("selecting Instagram's Original crop option");
  reportProgress("Image accepted. Selecting Original to preserve its aspect ratio.");
  await selectOriginalAspect(page, signal);
  setStage("advancing through Instagram's crop and edit screens");
  reportProgress("Original crop selected. Advancing through crop and edit screens.");
  await advanceToShareScreen(page, signal);
  setStage("filling Instagram's final composer");
  reportProgress("Final composer reached. Adding the caption.");
  await fillCaptionAndConfirmShareIsVisible(page, job.caption, signal);
}

export class PlaywrightInstagramPreviewExecutor implements PublishingPreviewExecutor {
  readonly platform = "instagram" as const;

  constructor(
    private readonly files: AutomationFileStore,
    private readonly configuredExecutablePath: string,
  ) {}

  async prepare(
    job: ClaimedPublishingJob,
    signal: AbortSignal,
    reportProgress: (message: string) => void = () => undefined,
  ) {
    if (job.platform !== "instagram") throw new Error("The preview executor supports only Instagram.");
    if (job.executionMode !== "DRY_RUN" || job.validationStage !== "INSTAGRAM_PREVIEW") {
      throw new Error("The preview executor refuses jobs outside the isolated preview stage.");
    }
    if (job.media.length !== 1 || !["image/jpeg", "image/png"].includes(job.media[0]!.mimeType.toLowerCase())) {
      throw new Error("The Instagram preview currently requires exactly one JPEG or PNG image.");
    }
    const executablePath = detectServerBrowserExecutable(this.configuredExecutablePath);
    if (!executablePath) throw new Error("Google Chrome or Microsoft Edge is required for Instagram previews.");
    reportProgress("Launching the isolated Instagram browser profile.");
    const context = await chromium.launchPersistentContext(this.files.profileDirectory(job.accountId), {
      executablePath,
      headless: true,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: false,
      timeout: 30_000,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-mode",
        "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection",
      ],
    });
    let deadlineExpired = false;
    let stage = "opening the saved Instagram session";
    let page: Page | null = null;
    const deadline = setTimeout(() => {
      deadlineExpired = true;
      reportProgress("Closing a preview that exceeded the 150-second browser limit.");
      void context.close({ reason: "Instagram preview browser deadline exceeded." }).catch(() => undefined);
    }, 150_000);
    deadline.unref();
    try {
      signal.throwIfAborted();
      page = context.pages()[0] || await context.newPage();
      page.setDefaultTimeout(10_000);
      await prepareInstagramFinalComposer({
        page,
        context,
        job,
        mediaPath: this.files.mediaFilePath(job.media[0]!.storageKey),
        signal,
        reportProgress,
        setStage: value => { stage = value; },
      });
      stage = "capturing the final composer screenshot";
      reportProgress("Capturing the private final-composer screenshot.");
      const screenshot = await page.screenshot({
        type: "jpeg",
        quality: 82,
        animations: "disabled",
        timeout: 10_000,
      });
      return {
        screenshot,
        checks: [
          "The saved Instagram session opened successfully.",
          "Instagram accepted the test image and caption.",
          "The final composer was visible and closed without clicking Share.",
        ],
      };
    } catch (error) {
      if (signal.aborted) throw error;
      const diagnosticScreenshot = page && !page.isClosed()
        ? await page.screenshot({ type: "jpeg", quality: 72, animations: "disabled", timeout: 5_000 }).catch(() => undefined)
        : undefined;
      if (deadlineExpired) {
        throw new InstagramPreviewPreparationError(
          `Instagram did not finish ${stage} within the 150-second preview limit.`,
          diagnosticScreenshot,
        );
      }
      const message = error instanceof Error ? error.message : "Unknown Instagram preview error.";
      if (error instanceof InstagramPreviewLoginRequiredError) {
        throw new InstagramPreviewLoginRequiredError(message, diagnosticScreenshot);
      }
      throw new InstagramPreviewPreparationError(`Preview stopped while ${stage}: ${message}`, diagnosticScreenshot);
    } finally {
      clearTimeout(deadline);
      reportProgress("Closing the private Instagram browser before Share.");
      await Promise.race([
        context.close({ reason: "Instagram private preview finished before Share." }).catch(() => undefined),
        new Promise<void>(resolve => setTimeout(resolve, 5_000)),
      ]);
    }
  }
}
