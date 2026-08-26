import type { Locator, Page } from "playwright-core";
import type { ClaimedPublishingJob, ServerPublishingExecutor } from "./executor.ts";
import { detectServerBrowserExecutable, isAuthenticatedLinkedInUrl, launchStandardXChrome } from "./login-browser.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import { setServerLocalInputFile } from "./local-file-input.ts";

export const LINKEDIN_COMPOSER_EDITOR_SELECTORS = [
  '[role="dialog"] [contenteditable="true"]',
  '[role="dialog"] [role="textbox"]',
  '[role="dialog"] textarea',
  '.share-creation-state__text-editor [contenteditable="true"]',
  '.ql-editor[contenteditable="true"]',
  '.tiptap.ProseMirror[contenteditable="true"]',
  '.ProseMirror[contenteditable="true"][role="textbox"]',
] as const;

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

function linkedInComposerEditors(page: Page) {
  return LINKEDIN_COMPOSER_EDITOR_SELECTORS.map(selector => page.locator(selector));
}

async function waitForLinkedInComposer(page: Page, signal: AbortSignal, timeout: number) {
  return waitVisible(page, linkedInComposerEditors(page), signal, timeout);
}

async function activateLinkedInComposerControl(control: Locator) {
  await control.evaluate(element => {
    const label = `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`.replace(/\s+/g, " ").trim();
    if (!/start a post/i.test(label)) throw new Error("The LinkedIn control was no longer Start a post.");
    (element as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
    (element as HTMLElement).focus();
    (element as HTMLElement).click();
  });
}

async function enterLinkedInPostText(page: Page, editor: Locator, text: string) {
  const expected = text.replace(/\s+/g, " ").trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await editor.evaluate(element => {
      (element as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
      (element as HTMLElement).click();
      (element as HTMLElement).focus();
    });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    if (text) await page.keyboard.insertText(text);
    const entered = await editor.evaluate(element => {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value;
      return (element as HTMLElement).innerText || element.textContent || "";
    }).catch(() => "");
    const normalized = entered.replace(/\s+/g, " ").trim();
    if (normalized === expected || normalized.includes(expected)) return;
    await page.waitForTimeout(500);
  }
  throw new Error("LinkedIn's post text was not retained by its current editor.");
}

async function openLinkedInComposer(page: Page, signal: AbortSignal) {
  if (/linkedin\.com\/sharing\/compose/i.test(page.url())) {
    const existing = await waitForLinkedInComposer(page, signal, 2_000);
    if (existing) return existing;
  }

  const controls = [
    page.getByRole("button", { name: /Start a post/i }),
    page.locator('button[class*="share-box-feed-entry__trigger"]'),
    page.locator('[data-view-name*="start-post" i]'),
    page.locator('[data-control-name*="sharebox" i]'),
    page.locator('button').filter({ hasText: /Start a post/i }),
    page.locator('[role="button"]').filter({ hasText: /Start a post/i }),
    page.locator('[aria-label*="Start a post" i]'),
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal.throwIfAborted();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" })).catch(() => undefined);
    if (!await waitVisible(page, controls, signal, attempt ? 8_000 : 15_000)) continue;
    for (const control of controls) {
      for (let index = 0, count = Math.min(await control.count().catch(() => 0), 12); index < count; index += 1) {
        const candidate = control.nth(index);
        if (!await candidate.isVisible().catch(() => false)) continue;
        await activateLinkedInComposerControl(candidate).catch(() => undefined);
        const editor = await waitForLinkedInComposer(page, signal, 4_000);
        if (editor) return editor;
      }
    }
  }

  throw new Error("LinkedIn's Start a post control did not open its current post editor.");
}

async function activateExactLinkedInPost(post: Locator) {
  await post.evaluate(element => {
    const label = `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`.replace(/\s+/g, " ").trim();
    if (!/^post(?:\s+post)?$/i.test(label) || element.getAttribute("aria-disabled") === "true") {
      throw new Error("The final LinkedIn control was no longer an enabled exact Post action.");
    }
    (element as HTMLElement).click();
  });
}

async function waitForLinkedInPublishConfirmation(page: Page, editor: Locator, dialog: Locator, signal: AbortSignal) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (await dialog.count() && !await dialog.isVisible().catch(() => false)) return;
    if (!await editor.isVisible().catch(() => false)) return;
    if (!/linkedin\.com\/sharing\/compose/i.test(page.url()) && await firstVisible([
      page.getByText(/Post successful|Your post has been shared|View post/i),
      page.locator('[role="alert"]').filter({ hasText: /posted|shared/i }),
    ])) return;
    await page.waitForTimeout(750);
  }
  throw new Error("LinkedIn did not show a publish confirmation or close its composer.");
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
      const editor = await openLinkedInComposer(page, signal);
      await enterLinkedInPostText(page, editor, job.caption);
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
      await activateExactLinkedInPost(post);
      await waitForLinkedInPublishConfirmation(page, editor, dialog, signal);
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
