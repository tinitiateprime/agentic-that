import { chromium, type Locator, type Page } from "playwright-core";
import type { ServerPublishingExecutor, ClaimedPublishingJob } from "./executor.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import { detectServerBrowserExecutable } from "./login-browser.ts";

async function firstVisible(locators: Locator[]) {
  for (const locator of locators) {
    const count = Math.min(await locator.count().catch(() => 0), 8);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function firstEnabledVisible(locators: Locator[]) {
  for (const locator of locators) {
    const count = Math.min(await locator.count().catch(() => 0), 12);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function waitForVisible(page: Page, locators: Locator[], signal: AbortSignal, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const visible = await firstVisible(locators);
    if (visible) return visible;
    await page.waitForTimeout(250);
  }
  return null;
}

async function waitForFacebookPost(page: Page, dialog: Locator, signal: AbortSignal, requireMedia: boolean) {
  const deadline = Date.now() + Number(process.env.FACEBOOK_UPLOAD_TIMEOUT_MS ?? (requireMedia ? 300_000 : 60_000));
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const post = await firstEnabledVisible([
      dialog.getByRole("button", { name: /^Post$/i }),
      dialog.locator('[role="button"][aria-label="Post"]'),
      dialog.locator('button[aria-label="Post"]'),
      dialog.locator('[role="button"]').filter({ hasText: /^\s*Post\s*$/i }),
      page.locator('[role="dialog"] [role="button"][aria-label="Post"]'),
      page.locator('[role="dialog"] button[aria-label="Post"]'),
    ]);
    if (post) return post;

    const uploadError = await firstVisible([
      dialog.locator('[role="alert"]').filter({ hasText: /failed|error|unsupported|too large|try again/i }),
      page.locator('[role="alert"]').filter({ hasText: /failed|error|unsupported|too large|try again/i }),
    ]);
    const errorText = (await uploadError?.textContent())?.replace(/\s+/g, " ").trim();
    if (errorText) throw new Error(`Facebook media upload error: ${errorText}`);
    await page.waitForTimeout(750);
  }
  throw new Error(requireMedia
    ? "Facebook's Post button did not become enabled while the media was processing."
    : "Facebook's exact Post button was not available.");
}

export class PlaywrightFacebookPublishingExecutor implements ServerPublishingExecutor {
  readonly platform = "facebook" as const;

  constructor(private readonly files: AutomationFileStore, private readonly configuredExecutablePath: string) {}

  async publish(job: ClaimedPublishingJob, signal: AbortSignal, onFinalActionStarting: () => Promise<void>, reportProgress: (message: string) => void = () => undefined) {
    if (job.platform !== "facebook") throw new Error("The Facebook executor received a different platform.");
    if (job.executionMode !== "LIVE" || job.validationStage !== "LOCAL") throw new Error("The Facebook executor refuses jobs outside the authorized live stage.");
    if (job.media.length > 1) throw new Error("Facebook server publishing currently supports at most one media file.");
    const executablePath = detectServerBrowserExecutable(this.configuredExecutablePath);
    if (!executablePath) throw new Error("Google Chrome or Microsoft Edge is required for Facebook publishing.");
    const context = await chromium.launchPersistentContext(this.files.profileDirectory(job.accountId), {
      executablePath,
      headless: true,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: false,
      args: ["--no-first-run", "--no-default-browser-check", "--disable-background-mode", "--password-store=basic"],
    });
    let finalActionAttempted = false;
    let activePage: Page | null = null;
    try {
      const page = context.pages()[0] || await context.newPage();
      activePage = page;
      reportProgress("Opening Facebook with the saved server session.");
      await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (/login|checkpoint|recover|captcha/i.test(page.url())) return { state: "LOGIN_REQUIRED" as const, errorCode: "FACEBOOK_LOGIN_REQUIRED", errorMessage: "Reconnect the Facebook account." };
      const opener = await waitForVisible(page, [
        page.getByText(/What's on your mind/i),
        page.getByRole("button", { name: /Create post/i }),
      ], signal, 30_000);
      if (!opener) throw new Error("Facebook's Create post control was not available.");
      await opener.click({ timeout: 10_000 });
      const editor = await waitForVisible(page, [
        page.locator('[role="dialog"] [contenteditable="true"][role="textbox"]'),
        page.locator('[role="dialog"] [contenteditable="true"][data-lexical-editor="true"]'),
        page.locator('[role="dialog"] [contenteditable="true"]'),
        page.locator('[role="dialog"] textarea'),
      ], signal, 20_000);
      if (!editor) throw new Error("Facebook's post text editor was not available.");
      const dialog = editor.locator('xpath=ancestor::*[@role="dialog"][1]');
      if (!await dialog.count()) throw new Error("Facebook's owning post composer was not available.");
      if (job.caption) await editor.fill(job.caption);
      if (job.media[0]) {
        const input = dialog.locator('input[type="file"]').last();
        if (!await input.count()) throw new Error("Facebook's media input was not available.");
        reportProgress("Uploading media to Facebook's composer.");
        await input.setInputFiles(this.files.mediaFilePath(job.media[0].storageKey));
        await page.waitForTimeout(2_000);
      }
      const post = await waitForFacebookPost(page, dialog, signal, Boolean(job.media[0]));
      const label = `${await post.getAttribute("aria-label").catch(() => "") || ""} ${await post.textContent().catch(() => "") || ""}`.trim();
      if (!/^post(?:\s+post)?$/i.test(label)) throw new Error("The final Facebook control did not pass the exact Post-label guard.");
      reportProgress("Final Facebook Post authorized. Recording the irreversible action before clicking.");
      await onFinalActionStarting();
      signal.throwIfAborted();
      finalActionAttempted = true;
      await post.click({ timeout: 10_000 });
      await dialog.waitFor({ state: "hidden", timeout: 120_000 });
      return { state: "PUBLISHED" as const };
    } catch (error) {
      if (activePage && !activePage.isClosed()) {
        const screenshot = await activePage.screenshot({ type: "jpeg", quality: 75, animations: "disabled" }).catch(() => null);
        if (screenshot) await this.files.storePublishingPreview(job.id, screenshot).catch(() => undefined);
      }
      if (finalActionAttempted) return { state: "UNCERTAIN" as const, errorCode: "FACEBOOK_RESULT_UNCERTAIN", errorMessage: error instanceof Error ? error.message : "Facebook confirmation was unavailable." };
      throw error;
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}
