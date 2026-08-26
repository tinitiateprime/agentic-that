import type { Locator, Page } from "playwright-core";
import type { ClaimedPublishingJob, ServerPublishingExecutor } from "./executor.ts";
import { detectServerBrowserExecutable, isAuthenticatedLinkedInUrl, launchStandardXChrome } from "./login-browser.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import { setServerLocalInputFile } from "./local-file-input.ts";

async function firstVisible(locators: Locator[]) {
  for (const locator of locators) for (let index = 0, count = Math.min(await locator.count().catch(() => 0), 10); index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) return item;
  }
  return null;
}

async function waitVisible(page: Page, locators: Locator[], signal: AbortSignal, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const item = await firstVisible(locators);
    if (item) return item;
    await page.waitForTimeout(500);
  }
  return null;
}

export class PlaywrightLinkedInPublishingExecutor implements ServerPublishingExecutor {
  readonly platform = "linkedin" as const;
  constructor(private readonly files: AutomationFileStore, private readonly configuredExecutablePath: string) {}

  async publish(job: ClaimedPublishingJob, signal: AbortSignal, onFinalActionStarting: () => Promise<void>, reportProgress: (message: string) => void = () => undefined) {
    if (job.platform !== "linkedin") throw new Error("The LinkedIn executor received a different platform.");
    if (job.executionMode !== "LIVE" || job.validationStage !== "LOCAL") throw new Error("The LinkedIn executor refuses jobs outside the authorized live stage.");
    const executablePath = detectServerBrowserExecutable(this.configuredExecutablePath);
    if (!executablePath) throw new Error("Google Chrome or Microsoft Edge is required for LinkedIn publishing.");
    const browser = await launchStandardXChrome(executablePath, this.files.profileDirectory(job.accountId), "https://www.linkedin.com/feed/", false);
    let finalActionAttempted = false;
    try {
      const { page, context } = browser;
      await Promise.all(context.pages().filter(candidate => candidate !== page).map(candidate => candidate.close().catch(() => undefined)));
      reportProgress("Opening LinkedIn with the saved server session.");
      await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (!isAuthenticatedLinkedInUrl(page.url())) {
        return { state: "LOGIN_REQUIRED" as const, errorCode: "LINKEDIN_LOGIN_REQUIRED", errorMessage: "Reconnect the LinkedIn account." };
      }
      const opener = await waitVisible(page, [
        page.getByRole("button", { name: /Start a post/i }),
        page.locator('button[class*="share-box-feed-entry__trigger"]'),
        page.locator('[aria-label*="Start a post" i]'),
      ], signal, 45_000);
      if (!opener) throw new Error("LinkedIn's Start a post control was unavailable.");
      await opener.click({ timeout: 10_000 });
      const editor = await waitVisible(page, [
        page.locator('[role="dialog"] .tiptap[contenteditable="true"]'),
        page.locator('[role="dialog"] [contenteditable="true"][role="textbox"]'),
        page.locator('.share-creation-state__text-editor .tiptap[contenteditable="true"]'),
      ], signal, 30_000);
      if (!editor) throw new Error("LinkedIn's post editor was unavailable.");
      await editor.fill(job.caption);
      const dialog = editor.locator("xpath=ancestor::*[@role='dialog'][1]");
      const root = await dialog.count() ? dialog : page.locator("body");
      if (job.media[0]) {
        reportProgress("Uploading media to LinkedIn's composer.");
        let input = root.locator('input[type="file"]').last();
        if (!await input.count()) {
          const button = await firstVisible([root.getByRole("button", { name: /Add media|Media|Photo|Video/i }), root.locator('button[aria-label*="media" i]')]);
          if (!button) throw new Error("LinkedIn's media control was unavailable.");
          await button.click({ timeout: 10_000 });
          input = page.locator('input[type="file"]').last();
        }
        if (!await input.count()) throw new Error("LinkedIn's media input was unavailable.");
        await setServerLocalInputFile(page, input, this.files.mediaFilePath(job.media[0].storageKey));
        const next = await waitVisible(page, [page.getByRole("button", { name: /^Done$|^Next$/i })], signal, 120_000);
        if (next) await next.click({ timeout: 10_000 });
      }
      const deadline = Date.now() + 120_000;
      let post: Locator | null = null;
      while (Date.now() < deadline) {
        post = await firstVisible([root.getByRole("button", { name: /^Post$/i }), page.locator('[role="dialog"] button').filter({ hasText: /^Post$/i })]);
        if (post && await post.isEnabled().catch(() => false)) break;
        await page.waitForTimeout(1_000);
      }
      if (!post || !await post.isEnabled().catch(() => false)) throw new Error("LinkedIn's exact Post button did not become enabled.");
      reportProgress("Final LinkedIn Post authorized. Recording the irreversible action before clicking.");
      await onFinalActionStarting();
      signal.throwIfAborted();
      finalActionAttempted = true;
      await post.click({ timeout: 10_000 });
      if (await dialog.count()) await dialog.waitFor({ state: "hidden", timeout: 90_000 });
      return { state: "PUBLISHED" as const };
    } catch (error) {
      if (!browser.page.isClosed()) {
        const screenshot = await browser.page.screenshot({ type: "jpeg", quality: 75, animations: "disabled" }).catch(() => null);
        if (screenshot) await this.files.storePublishingPreview(job.id, screenshot).catch(() => undefined);
      }
      if (finalActionAttempted) return { state: "UNCERTAIN" as const, errorCode: "LINKEDIN_RESULT_UNCERTAIN", errorMessage: error instanceof Error ? error.message : "LinkedIn confirmation was unavailable." };
      throw error;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
}
