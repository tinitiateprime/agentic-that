import { chromium, type Locator, type Page } from "playwright-core";
import type { ClaimedPublishingJob, ServerPublishingExecutor } from "./executor.ts";
import {
  InstagramPreviewLoginRequiredError,
  prepareInstagramFinalComposer,
} from "./instagram-preview.ts";
import { detectServerBrowserExecutable } from "./login-browser.ts";
import type { AutomationFileStore } from "./profile-store.ts";

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

async function waitForPublishedConfirmation(page: Page, signal: AbortSignal) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const confirmation = await firstVisible([
      page.getByText(/^Post shared$/i),
      page.getByText(/^Reel shared$/i),
      page.getByText(/Your post has been shared/i),
      page.getByText(/Your reel has been shared/i),
    ]);
    if (confirmation) return;
    await page.waitForTimeout(500);
  }
  throw new Error("Instagram did not show a published confirmation within four minutes.");
}

export class PlaywrightInstagramPublishingExecutor implements ServerPublishingExecutor {
  readonly platform = "instagram" as const;

  constructor(
    private readonly files: AutomationFileStore,
    private readonly configuredExecutablePath: string,
  ) {}

  async publish(
    job: ClaimedPublishingJob,
    signal: AbortSignal,
    onFinalActionStarting: () => Promise<void>,
    reportProgress: (message: string) => void = () => undefined,
  ) {
    if (job.platform !== "instagram") throw new Error("The live executor supports only Instagram.");
    if (job.executionMode !== "LIVE" || job.validationStage !== "LOCAL") {
      throw new Error("The live executor refuses jobs outside the authorized live stage.");
    }
    if (job.media.length !== 1 || !["image/jpeg", "image/png"].includes(job.media[0]!.mimeType.toLowerCase())) {
      throw new Error("Initial live Instagram publishing requires exactly one JPEG or PNG image.");
    }
    const executablePath = detectServerBrowserExecutable(this.configuredExecutablePath);
    if (!executablePath) throw new Error("Google Chrome or Microsoft Edge is required for Instagram publishing.");
    reportProgress("Launching the isolated Instagram browser for authorized publishing.");
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
    const deadline = setTimeout(() => {
      deadlineExpired = true;
      reportProgress("Closing a live publishing browser that exceeded its five-minute limit.");
      void context.close({ reason: "Instagram live publishing deadline exceeded." }).catch(() => undefined);
    }, 300_000);
    deadline.unref();
    try {
      signal.throwIfAborted();
      const page = context.pages()[0] || await context.newPage();
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

      stage = "submitting Instagram's final Share action";
      const share = await firstVisible([page.getByRole("button", { name: /^Share$/i })]);
      if (!share) throw new Error("Instagram's exact Share button was not available.");
      const shareLabel = [
        await share.getAttribute("aria-label", { timeout: 1_000 }).catch(() => null),
        await share.textContent({ timeout: 1_000 }).catch(() => null),
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (!/^share(?:\s+share)?$/i.test(shareLabel)) {
        throw new Error("The final Instagram control did not pass the exact Share-label guard.");
      }

      reportProgress("Final Share authorized. Recording the irreversible action before clicking.");
      await onFinalActionStarting();
      signal.throwIfAborted();
      await share.click({ force: true, timeout: 10_000 });
      reportProgress("Instagram Share submitted. Waiting for the platform confirmation.");
      stage = "waiting for Instagram's published confirmation";
      await waitForPublishedConfirmation(page, signal);
      return { state: "PUBLISHED" as const };
    } catch (error) {
      if (signal.aborted || error instanceof InstagramPreviewLoginRequiredError) throw error;
      if (deadlineExpired) throw new Error(`Instagram did not finish ${stage} within five minutes.`);
      throw error;
    } finally {
      clearTimeout(deadline);
      await Promise.race([
        context.close({ reason: "Instagram live publishing browser finished." }).catch(() => undefined),
        new Promise<void>(resolve => setTimeout(resolve, 5_000)),
      ]);
    }
  }
}
