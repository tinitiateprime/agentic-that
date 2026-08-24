import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import type { ClaimedPublishingJob, PublishingPreviewExecutor } from "./executor.ts";
import { detectServerBrowserExecutable } from "./login-browser.ts";
import type { AutomationFileStore } from "./profile-store.ts";

const INSTAGRAM_HOME_URL = "https://www.instagram.com/";

export class InstagramPreviewLoginRequiredError extends Error {}

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
  const label = [
    await locator.getAttribute("aria-label").catch(() => null),
    await locator.getAttribute("title").catch(() => null),
    await locator.textContent().catch(() => null),
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
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

export class PlaywrightInstagramPreviewExecutor implements PublishingPreviewExecutor {
  readonly platform = "instagram" as const;

  constructor(
    private readonly files: AutomationFileStore,
    private readonly configuredExecutablePath: string,
  ) {}

  async prepare(job: ClaimedPublishingJob, signal: AbortSignal) {
    if (job.platform !== "instagram") throw new Error("The preview executor supports only Instagram.");
    if (job.media.length !== 1 || !["image/jpeg", "image/png"].includes(job.media[0]!.mimeType.toLowerCase())) {
      throw new Error("The Instagram preview currently requires exactly one JPEG or PNG image.");
    }
    const executablePath = detectServerBrowserExecutable(this.configuredExecutablePath);
    if (!executablePath) throw new Error("Google Chrome or Microsoft Edge is required for Instagram previews.");
    const context = await chromium.launchPersistentContext(this.files.profileDirectory(job.accountId), {
      executablePath,
      headless: true,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: false,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-mode",
        "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection",
      ],
    });
    try {
      signal.throwIfAborted();
      const page = context.pages()[0] || await context.newPage();
      await page.goto(INSTAGRAM_HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await dismissPrompts(page);
      await verifyAuthenticated(page, context, signal);
      await openPostComposer(page, signal);
      await uploadOneImage(page, this.files.mediaFilePath(job.media[0]!.storageKey), signal);
      await advanceToShareScreen(page, signal);
      await fillCaptionAndConfirmShareIsVisible(page, job.caption, signal);
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
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}
