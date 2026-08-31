import { type Locator, type Page } from "playwright-core";
import type { ClaimedPublishingJob, ServerPublishingExecutor } from "./executor.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import { detectServerBrowserExecutable, launchStandardXChrome } from "./login-browser.ts";
import { setServerLocalInputFile } from "./local-file-input.ts";

async function firstVisible(locators: Locator[]) {
  for (const locator of locators) for (let index = 0, count = Math.min(await locator.count().catch(() => 0), 8); index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function firstEnabledVisible(locators: Locator[]) {
  for (const locator of locators) for (let index = 0, count = Math.min(await locator.count().catch(() => 0), 8); index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) return candidate;
  }
  return null;
}

async function waitVisible(page: Page, locators: Locator[], signal: AbortSignal, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const result = await firstVisible(locators);
    if (result) return result;
    await page.waitForTimeout(250);
  }
  return null;
}

async function waitForPostReady(page: Page, composer: Locator, signal: AbortSignal, requireMedia: boolean) {
  const deadline = Date.now() + Number(process.env.X_UPLOAD_TIMEOUT_MS ?? 300_000);
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const post = await firstEnabledVisible([
      composer.locator('[data-testid="tweetButton"]'),
      composer.locator('[data-testid="tweetButtonInline"]'),
      composer.getByRole("button", { name: /^Post$/i }),
      page.locator('[role="dialog"] [data-testid="tweetButton"]'),
      page.locator('[role="dialog"] [data-testid="tweetButtonInline"]'),
      page.locator('[data-testid="tweetButton"]'),
      page.locator('[data-testid="tweetButtonInline"]'),
    ]);
    const mediaReady = !requireMedia || Boolean(await firstVisible([
      page.locator('[role="dialog"] [data-testid="attachments"]'),
      page.locator('[role="dialog"] [data-testid="media"]'),
      page.locator('[role="dialog"] [data-testid^="removeMedia"]'),
      page.locator('[role="dialog"] button[aria-label*="Remove media" i]'),
      composer.locator('[data-testid="attachments"]'),
      composer.locator('[data-testid="media"]'),
      composer.locator('[data-testid^="removeMedia"]'),
    ]));
    if (post && mediaReady) return post;

    const uploadError = await firstVisible([
      page.locator('[data-testid="toast"]').filter({ hasText: /failed|error|try again|unsupported/i }),
      page.locator('[role="alert"]').filter({ hasText: /failed|error|try again|unsupported/i }),
    ]);
    const errorText = (await uploadError?.textContent())?.replace(/\s+/g, " ").trim();
    if (errorText) throw new Error(`X media upload error: ${errorText}`);
    await page.waitForTimeout(1_000);
  }
  throw new Error(requireMedia
    ? "X's Post button did not become enabled while the media was uploading."
    : "X's exact Post button did not become enabled.");
}

export class PlaywrightXPublishingExecutor implements ServerPublishingExecutor {
  readonly platform = "x" as const;
  constructor(private readonly files: AutomationFileStore, private readonly configuredExecutablePath: string) {}

  async publish(job: ClaimedPublishingJob, signal: AbortSignal, onFinalActionStarting: () => Promise<void>, reportProgress: (message: string) => void = () => undefined) {
    if (job.platform !== "x") throw new Error("The X executor received a different platform.");
    if (job.executionMode !== "LIVE" || job.validationStage !== "LOCAL") throw new Error("The X executor refuses jobs outside the authorized live stage.");
    if (job.media.length > 1) throw new Error("X server publishing currently supports at most one media file.");
    const executablePath = detectServerBrowserExecutable(this.configuredExecutablePath);
    if (!executablePath) throw new Error("Google Chrome or Microsoft Edge is required for X publishing.");
    const browserSession = await launchStandardXChrome(
      executablePath,
      this.files.profileDirectory(job.accountId),
      "https://x.com/home",
      false,
    );
    const { context } = browserSession;
    let page: Page | null = null;
    let finalActionAttempted = false;
    try {
      page = browserSession.page;
      await Promise.all(context.pages()
        .filter(candidate => candidate !== page)
        .map(candidate => candidate.close().catch(() => undefined)));
      reportProgress("Opening X with the saved server session.");
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
      const cookies = await context.cookies(["https://x.com", "https://twitter.com"]);
      if (/\/i\/flow\/login|\/login|account\/access/i.test(page.url()) || !cookies.some(cookie => cookie.name === "auth_token")) {
        return { state: "LOGIN_REQUIRED" as const, errorCode: "X_LOGIN_REQUIRED", errorMessage: "Reconnect the X account." };
      }
      const opener = await waitVisible(page, [page.locator('[data-testid="SideNav_NewTweet_Button"]'), page.locator('a[href="/compose/post"]')], signal, 20_000);
      if (!opener) throw new Error("X's Post composer control was not available.");
      await opener.click({ timeout: 10_000 });
      // X keeps an inline Home composer visible while its modal opens. Waiting
      // for a global textarea can fill the background composer and leave an
      // empty modal blocking its enabled Post button.
      const editor = await waitVisible(page, [
        page.locator('[role="dialog"] [data-testid="tweetTextarea_0"]'),
        page.locator('[role="dialog"] [contenteditable="true"][role="textbox"]'),
      ], signal, 20_000);
      if (!editor) throw new Error("X's modal post text editor was not available.");
      const composer = editor.locator("xpath=ancestor::*[@role='dialog'][1]");
      if (!await composer.count()) throw new Error("X's owning post dialog was not available.");
      await editor.fill(job.caption);
      if (job.media[0]) {
        const input = composer.locator('input[type="file"]').last();
        const fallback = page.locator('input[type="file"]').last();
        const target = await input.count() ? input : fallback;
        if (!await target.count()) throw new Error("X's media input was not available.");
        reportProgress("Uploading media to X's composer.");
        await setServerLocalInputFile(page, target, this.files.mediaFilePath(job.media[0].storageKey));
        const preview = await waitVisible(page, [composer.locator('[data-testid="attachments"]'), composer.locator('[data-testid="media"]'), composer.locator('[data-testid^="removeMedia"]')], signal, 300_000);
        if (!preview) throw new Error("X did not confirm the attached media preview.");
      }
      reportProgress(job.media[0] ? "Waiting for X to finish processing the media." : "Waiting for X's Post action to become ready.");
      const post = await waitForPostReady(page, composer, signal, Boolean(job.media[0]));
      const label = `${await post.getAttribute("aria-label").catch(() => "") || ""} ${await post.textContent().catch(() => "") || ""}`.trim();
      if (!/^post(?:\s+post)?$/i.test(label)) throw new Error("The final X control did not pass the exact Post-label guard.");
      reportProgress("Final X Post authorized. Recording the irreversible action before clicking.");
      await onFinalActionStarting();
      signal.throwIfAborted();
      finalActionAttempted = true;
      await post.click({ timeout: 10_000 });
      await composer.waitFor({ state: "hidden", timeout: 90_000 });
      return { state: "PUBLISHED" as const };
    } catch (error) {
      if (page && !page.isClosed()) {
        const screenshot = await page.screenshot({ type: "jpeg", quality: 75, animations: "disabled" }).catch(() => null);
        if (screenshot) await this.files.storePublishingPreview(job.id, screenshot, job.workspaceId).catch(() => undefined);
      }
      if (finalActionAttempted) return { state: "UNCERTAIN" as const, errorCode: "X_RESULT_UNCERTAIN", errorMessage: error instanceof Error ? error.message : "X confirmation was unavailable." };
      throw error;
    } finally {
      await browserSession.close().catch(() => undefined);
    }
  }
}
