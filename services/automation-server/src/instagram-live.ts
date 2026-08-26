import { chromium, type Locator, type Page, type Request, type Response } from "playwright-core";
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

type InstagramPublishEvidence = {
  state: "PUBLISHED";
  platformPostId?: string;
  platformPostUrl?: string;
} | {
  state: "FAILED";
  message: string;
};

function recordValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export function interpretInstagramPublishResponse(statusCode: number, body: unknown): InstagramPublishEvidence | null {
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const media = payload.media && typeof payload.media === "object"
    ? payload.media as Record<string, unknown>
    : {};
  const status = recordValue(payload.status)?.toLowerCase();
  const platformPostId = recordValue(media.pk) || recordValue(media.id) || recordValue(payload.media_id);
  const shortcode = recordValue(media.code) || recordValue(media.shortcode);
  const productType = recordValue(media.product_type)?.toLowerCase();

  if (statusCode >= 200 && statusCode < 300 && (status === "ok" || platformPostId || shortcode)) {
    return {
      state: "PUBLISHED",
      ...(platformPostId ? { platformPostId } : {}),
      ...(shortcode ? { platformPostUrl: `https://www.instagram.com/${productType === "clips" ? "reel" : "p"}/${encodeURIComponent(shortcode)}/` } : {}),
    };
  }
  if (statusCode >= 400 || status === "fail" || status === "error") {
    const message = [payload.message, payload.error_title, payload.error_body]
      .map(recordValue)
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      state: "FAILED",
      message: (message || `Instagram rejected the publish request with HTTP ${statusCode}.`).slice(0, 700),
    };
  }
  return null;
}

function isInstagramPublishRequest(url: string) {
  try {
    return /\/api\/v1\/media\/configure(?:_sidecar)?\/?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

async function responseEvidence(response: Response) {
  const body = await response.json().catch(() => null);
  return interpretInstagramPublishResponse(response.status(), body);
}

async function waitForEnabledShare(page: Page, share: Locator, signal: AbortSignal) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const enabled = await share.isEnabled().catch(() => false);
    const ariaDisabled = await share.getAttribute("aria-disabled").catch(() => null);
    if (enabled && ariaDisabled !== "true") return;
    await page.waitForTimeout(250);
  }
  throw new Error("Instagram's Share button did not become enabled. Nothing was submitted.");
}

async function waitForPublishedConfirmation(
  page: Page,
  signal: AbortSignal,
  getNetworkEvidence: () => InstagramPublishEvidence | null,
  getRequestFailure: () => string | null,
) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const networkEvidence = getNetworkEvidence();
    if (networkEvidence?.state === "PUBLISHED") return networkEvidence;
    if (networkEvidence?.state === "FAILED") throw new Error(networkEvidence.message);
    const platformError = await firstVisible([
      page.getByText(/Your post could not be shared/i),
      page.getByText(/Couldn't create (?:post|thread)/i),
      page.getByText(/Something went wrong\. Please try again/i),
      page.getByText(/Try again later/i),
    ]);
    if (platformError) {
      const message = (await platformError.textContent().catch(() => null))?.replace(/\s+/g, " ").trim();
      throw new Error((message || "Instagram showed an error after Share was submitted.").slice(0, 700));
    }
    const confirmation = await firstVisible([
      page.getByText(/^Post shared$/i),
      page.getByText(/^Reel shared$/i),
      page.getByText(/Your post has been shared/i),
      page.getByText(/Your reel has been shared/i),
    ]);
    if (confirmation) return { state: "PUBLISHED" as const };
    await page.waitForTimeout(500);
  }
  const requestFailure = getRequestFailure();
  throw new Error(requestFailure
    ? `Instagram's publish request failed: ${requestFailure}`
    : "Instagram did not confirm the published post within four minutes.");
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
    if (job.media.length < 1 || job.media.length > 10 || job.media.some(media => !["image/jpeg", "image/png", "video/mp4", "video/quicktime"].includes(media.mimeType.toLowerCase()))) {
      throw new Error("Live Instagram publishing requires between 1 and 10 JPEG, PNG, MP4, or MOV files.");
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
        "--password-store=basic",
      ],
    });
    let deadlineExpired = false;
    let finalActionAttempted = false;
    let activePage: Page | null = null;
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
      activePage = page;
      page.setDefaultTimeout(10_000);
      await prepareInstagramFinalComposer({
        page,
        context,
        job,
        mediaPaths: job.media.map(media => this.files.mediaFilePath(media.storageKey)),
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
      await share.scrollIntoViewIfNeeded();
      await waitForEnabledShare(page, share, signal);

      let publishEvidence: InstagramPublishEvidence | null = null;
      let publishRequestFailure: string | null = null;
      const responseListener = (response: Response) => {
        if (!isInstagramPublishRequest(response.url())) return;
        void responseEvidence(response).then(evidence => {
          if (evidence) publishEvidence = evidence;
        }).catch(() => undefined);
      };
      const requestFailedListener = (request: Request) => {
        if (!isInstagramPublishRequest(request.url())) return;
        publishRequestFailure = request.failure()?.errorText || "the browser reported a network failure";
      };
      page.on("response", responseListener);
      page.on("requestfailed", requestFailedListener);

      reportProgress("Final Share authorized. Recording the irreversible action before clicking.");
      await onFinalActionStarting();
      signal.throwIfAborted();
      finalActionAttempted = true;
      await share.click({ timeout: 10_000 });
      reportProgress("Instagram Share submitted. Waiting for the platform confirmation.");
      stage = "waiting for Instagram's published confirmation";
      try {
        return await waitForPublishedConfirmation(
          page,
          signal,
          () => publishEvidence,
          () => publishRequestFailure,
        );
      } finally {
        page.off("response", responseListener);
        page.off("requestfailed", requestFailedListener);
      }
    } catch (error) {
      if (signal.aborted || error instanceof InstagramPreviewLoginRequiredError) throw error;
      if (finalActionAttempted && activePage) {
        const screenshot = await activePage.screenshot({ type: "jpeg", quality: 75 }).catch(() => null);
        if (screenshot) await this.files.storePublishingPreview(job.id, screenshot).catch(() => undefined);
      }
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
