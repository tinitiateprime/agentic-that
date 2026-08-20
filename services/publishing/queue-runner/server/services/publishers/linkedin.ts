import type { Locator, Page } from "playwright-core";
import type { PlatformUpload } from "../../../shared/schema.js";
import { waitForLoginWithManualFallback, waitForSavedSessionVerification, type AccountLogin } from "./manual-login.js";
import fs from "fs";
import { publishingUploadFilePath } from "../../runtime-paths.js";

const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";
const LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login/";

function getLoginHoldMs() {
  return Number(process.env.LINKEDIN_LOGIN_HOLD_MS ?? 15000);
}

function getPostHoldMs() {
  return Number(process.env.LINKEDIN_POST_HOLD_MS ?? 1000);
}

async function clickIfVisible(locator: Locator, timeout = 1500) {
  try {
    const candidate = locator.first();
    if (!await candidate.isVisible()) return false;
    await candidate.evaluate((element: HTMLElement) => {
      element.scrollIntoView({ block: "center", inline: "center" });
      element.focus();
      element.click();
    }).catch(() => candidate.click({ force: true, timeout }));
    return true;
  } catch {
    return false;
  }
}

async function firstVisible(locators: Locator[]) {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);

    for (let index = 0; index < Math.min(count, 8); index += 1) {
      const candidate = locator.nth(index);

      try {
        if (await candidate.isVisible()) {
          return candidate;
        }
      } catch {
        // Try the next candidate.
      }
    }
  }

  return null;
}

type ViewportTarget = {
  locator: Locator;
  point: { x: number; y: number };
};

export function visibleIntersectionPoint(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
) {
  if (box.width <= 0 || box.height <= 0) return null;
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(viewport.width, box.x + box.width);
  const bottom = Math.min(viewport.height, box.y + box.height);
  if (right - left < 4 || bottom - top < 4) return null;
  return { x: left + (right - left) / 2, y: top + (bottom - top) / 2 };
}

async function firstInViewport(page: Page, locators: Locator[]): Promise<ViewportTarget | null> {
  const viewport = page.viewportSize() ?? await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 12); index += 1) {
      const candidate = locator.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const box = await candidate.boundingBox().catch(() => null);
      const point = box ? visibleIntersectionPoint(box, viewport) : null;
      if (point) return { locator: candidate, point };
    }
  }
  return null;
}

async function waitForLinkedInComposer(page: Page, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // Publishing browser views can be positioned outside the desktop while
    // still having a valid rendered editor. Require a visible editor in the
    // active dialog, but do not require desktop viewport intersection.
    const editor = await firstVisible([
      page.locator('[role="dialog"] [contenteditable="true"]'),
      page.locator('[role="dialog"] [role="textbox"]'),
      page.locator('[role="dialog"] textarea'),
      page.locator('.share-creation-state__text-editor [contenteditable="true"]'),
      page.locator('.ql-editor[contenteditable="true"]'),
    ]);
    if (editor) return editor;
    await page.waitForTimeout(250);
  }
  return null;
}

async function dismissCookiePrompt(page: Page) {
  const cookieButtons = [
    page.getByRole("button", { name: /Accept cookies/i }),
    page.getByRole("button", { name: /Accept/i }),
    page.getByRole("button", { name: /Agree/i }),
    page.getByRole("button", { name: /Reject optional cookies/i }),
  ];

  for (const button of cookieButtons) {
    if (await clickIfVisible(button)) {
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function isLoggedIn(page: Page) {
  if (/linkedin\.com\/feed\/?/i.test(page.url())) return true;

  const loggedInSignals = [
    page.locator("#global-nav"),
    page.locator(".global-nav"),
    page.locator("[data-test-global-nav-link='feed']"),
    page.getByRole("navigation", { name: /Primary|Global/i }),
  ];

  return Boolean(await firstVisible(loggedInSignals));
}

async function getLoginError(page: Page) {
  const errorLocator = await firstVisible([
    page.locator("#error-for-username"),
    page.locator("#error-for-password"),
    page.locator(".form__label--error"),
    page.locator(".alert-content"),
    page.locator('[role="alert"]'),
  ]);

  const text = (await errorLocator?.textContent())?.replace(/\s+/g, " ").trim();
  return text || null;
}

async function clickStartPost(page: Page) {
  console.log("Opening LinkedIn post composer...");

  const controls = () => [
    page.getByRole("button", { name: /Start a post/i }),
    page.locator('button[class*="share-box-feed-entry__trigger"]'),
    page.locator('[data-view-name*="start-post" i]'),
    page.locator('[data-control-name*="sharebox" i]'),
    page.locator("button").filter({ hasText: /Start a post/i }),
    page.locator('[role="button"]').filter({ hasText: /Start a post/i }),
    page.locator('[aria-label*="Start a post" i]'),
  ];
  const activate = async (control: Locator) => {
    await control.evaluate((element: HTMLElement) => {
      element.scrollIntoView({ block: "center", inline: "center" });
      element.focus();
      element.click();
    });
  };

  const openingDeadline = Date.now() + 45000;
  for (let attempt = 1; attempt <= 3 && Date.now() < openingDeadline; attempt += 1) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" })).catch(() => undefined);
    await page.waitForTimeout(attempt === 1 ? 750 : 1500);

    const onScreen = await firstInViewport(page, controls());
    if (onScreen) {
      await activate(onScreen.locator).catch(() => undefined);
      if (await waitForLinkedInComposer(page, 5000)) {
        await page.waitForTimeout(750);
        console.log("LinkedIn post composer opened.");
        return;
      }
    }

    // LinkedIn can retain a functional share control in a rendered duplicate
    // that sits outside the browser viewport. A DOM click avoids Playwright's
    // viewport actionability failure while still targeting the exact control.
    for (const locator of controls()) {
      if (Date.now() >= openingDeadline) break;
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < Math.min(count, 12); index += 1) {
        if (Date.now() >= openingDeadline) break;
        const candidate = locator.nth(index);
        if (!await candidate.isVisible().catch(() => false)) continue;
        await activate(candidate).catch(() => undefined);
        if (await waitForLinkedInComposer(page, 3000)) {
          await page.waitForTimeout(750);
          console.log("LinkedIn post composer opened.");
          return;
        }
      }
    }
  }

  throw new Error("LinkedIn Start a post control did not open the post editor after three verified attempts.");
}

async function typeLinkedInPostText(page: Page, text: string) {
  console.log("Entering LinkedIn post text...");
  const expectedText = text.replace(/\s+/g, " ").trim();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const editor = await firstVisible([
      page.locator('[role="dialog"] [contenteditable="true"][data-placeholder*="What" i]'),
      page.locator('[role="dialog"] .ql-editor[contenteditable="true"]'),
      page.locator('[role="dialog"] [contenteditable="true"]'),
      page.locator('[role="dialog"] [role="textbox"]'),
      page.locator('[role="dialog"] textarea'),
      page.locator(".share-creation-state__text-editor [contenteditable='true']"),
      page.locator(".ql-editor[contenteditable='true']"),
    ]);
    if (!editor) throw new Error("Could not find LinkedIn's empty post text area.");

    console.log("Clicking LinkedIn empty post text area...");
    await editor.evaluate((element: HTMLElement) => {
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      element.focus();
    });
    await page.waitForTimeout(300);

    const focused = await editor.evaluate(element => (
      document.activeElement === element || Boolean(element.contains(document.activeElement))
    )).catch(() => false);
    if (!focused) {
      await editor.focus();
      await page.waitForTimeout(200);
    }

    // Set the requested caption exactly so a retained LinkedIn draft cannot
    // duplicate text during a safe retry.
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(text);
    await page.waitForTimeout(750);

    const enteredText = await editor.evaluate((element: HTMLElement | HTMLTextAreaElement) => (
      "value" in element ? element.value : element.innerText || element.textContent || ""
    )).catch(() => "");
    const normalizedEnteredText = enteredText.replace(/\s+/g, " ").trim();
    if (normalizedEnteredText === expectedText || normalizedEnteredText.includes(expectedText)) {
      console.log("LinkedIn post text entered.");
      return;
    }
  }

  throw new Error("LinkedIn post text was not entered into the composer.");
}

async function attachLinkedInMedia(page: Page, filePath: string) {
  console.log("Attaching LinkedIn media...");
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor({ state: "visible", timeout: 15000 });

  const existingFileInputs = dialog.locator('input[type="file"]');
  if ((await existingFileInputs.count()) > 0) {
    await existingFileInputs.last().setInputFiles(filePath);
  } else {
    const mediaButton = await firstVisible([
      dialog.getByRole("button", { name: /Add media/i }),
      dialog.getByRole("button", { name: /Media/i }),
      dialog.getByRole("button", { name: /Photo/i }),
      dialog.getByRole("button", { name: /Video/i }),
      dialog.locator('button[aria-label*="Add media" i]'),
      dialog.locator('button[aria-label*="Media" i]'),
      page.locator('[role="dialog"] button[aria-label*="Add media" i]'),
      page.locator('[role="dialog"] button[aria-label*="Photo" i]'),
      page.locator('[role="dialog"] button[aria-label*="Video" i]'),
    ]);

    if (!mediaButton) {
      throw new Error("Could not find LinkedIn media upload button.");
    }

    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10000 }).catch(() => null);
    await mediaButton.click({ force: true, timeout: 10000 });

    const fileChooser = await fileChooserPromise;
    if (fileChooser) {
      await fileChooser.setFiles(filePath);
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(500);
      await dialog.locator('input[type="file"]').last().setInputFiles(filePath);
    }
  }

  await page.waitForTimeout(3000);

  const doneButtons = [
    page.getByRole("button", { name: /^Done$/i }),
    page.getByRole("button", { name: /^Next$/i }),
  ];

  for (const doneButton of doneButtons) {
    if (await clickIfVisible(doneButton, 2500)) {
      await page.waitForTimeout(1500);
      break;
    }
  }

  console.log("LinkedIn media attached.");
}

async function clickPostWhenReady(page: Page, onSubmitted?: () => Promise<void> | void) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const postButton = await firstVisible([
      page.locator('[role="dialog"] button').filter({ hasText: /^Post$/i }),
      page.locator('[role="dialog"] [role="button"]').filter({ hasText: /^Post$/i }),
      page.getByRole("button", { name: /^Post$/i }),
    ]);
    if (postButton && await postButton.isEnabled().catch(() => false)) {
      console.log("Clicking LinkedIn Post button...");
      await postButton.evaluate((element: HTMLElement) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        element.focus();
        element.click();
      }).catch(() => postButton.click({ force: true, timeout: 10000 }));
      await onSubmitted?.();
      return;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error("LinkedIn Post button did not become enabled.");
}

async function waitForPostComplete(page: Page) {
  console.log("Waiting for LinkedIn post to finish...");

  const dialog = page.locator('[role="dialog"]').filter({ hasText: /What do you want to talk about|Post/i }).first();

  try {
    await dialog.waitFor({ state: "hidden", timeout: 90000 });
  } catch {
    const successToast = await firstVisible([
      page.getByText(/Post successful/i),
      page.getByText(/Your post has been shared/i),
      page.getByText(/View post/i),
    ]);

    if (!successToast) {
      throw new Error("LinkedIn post did not finish within 90 seconds.");
    }
  }

  await page.waitForTimeout(2000);
  console.log("LinkedIn post published.");
}

async function loginFormIsVisible(page: Page) {
  const emailField = await firstVisible([
    page.getByLabel(/Email or phone/i),
    page.getByRole("textbox", { name: /Email or phone/i }),
    page.locator("input#username"),
    page.locator('input[name="session_key"]'),
    page.locator('input[autocomplete="username"]'),
    page.locator('input[type="email"]'),
    page.locator('input[type="text"]'),
  ]);
  const passwordField = await firstVisible([
    page.getByLabel(/^Password$/i),
    page.locator("input#password"),
    page.locator('input[name="session_password"]'),
    page.locator('input[autocomplete="current-password"]'),
    page.locator('input[type="password"]'),
  ]);
  return Boolean(emailField && passwordField);
}

async function isManualVerificationVisible(page: Page, url: string) {
  if (/checkpoint|challenge|captcha|verification/i.test(url)) return true;

  const signal = await firstVisible([
    page.getByText(/security verification/i),
    page.getByText(/verify your identity/i),
    page.getByText(/verification code/i),
    page.getByText(/two-step verification/i),
    page.locator('iframe[title*="captcha" i]'),
    page.locator('iframe[src*="captcha" i]'),
  ]);

  return Boolean(signal);
}

async function waitForLoginResult(page: Page, allowManualLoginFromStart = false, ignoreLoginErrors = false, embeddedLogin = false) {
  await waitForLoginWithManualFallback({
    page,
    platform: "LinkedIn",
    normalTimeoutMs: 90000,
    pollMs: 500,
    isLoggedIn: () => isLoggedIn(page),
    isManualVerificationVisible: (url) => isManualVerificationVisible(page, url),
    isLoginFormVisible: () => loginFormIsVisible(page),
    getLoginError: () => getLoginError(page),
    beforeCheck: () => dismissCookiePrompt(page),
    allowManualLoginFromStart,
    ignoreLoginErrors,
    embeddedLogin,
  });
}

export async function loginToLinkedIn(page: Page, _upload?: PlatformUpload, accountLogin?: AccountLogin) {
  const savedSessionOnly = Boolean(accountLogin?.useSavedSessionOnly);
  const manualLoginOnly = !savedSessionOnly;

  console.log(`Navigating to LinkedIn ${savedSessionOnly ? "feed" : "login"} page...`);
  await page.goto(savedSessionOnly ? LINKEDIN_FEED_URL : LINKEDIN_LOGIN_URL, { timeout: 60000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);
  await dismissCookiePrompt(page);

  if (await isLoggedIn(page)) {
    console.log("LinkedIn session already active.");
  } else if (savedSessionOnly) {
    await waitForSavedSessionVerification({
      page,
      platform: "LinkedIn",
      isLoggedIn: () => isLoggedIn(page),
      beforeCheck: () => dismissCookiePrompt(page),
    });
  } else {
    console.log("Complete the full LinkedIn login manually in the visible browser; Companion will save the session after the account opens.");
    await waitForLoginResult(page, true, Boolean(accountLogin?.ignoreLoginErrors), Boolean(accountLogin?.embeddedLogin));
  }

  await page.goto(LINKEDIN_FEED_URL, { timeout: 60000 });
  await waitForLoginResult(page, manualLoginOnly, manualLoginOnly && Boolean(accountLogin?.ignoreLoginErrors), Boolean(accountLogin?.embeddedLogin));

  console.log("LinkedIn ready.");
  return { success: true };
}

export async function postToLinkedIn(page: Page, upload: PlatformUpload, accountLogin?: AccountLogin) {
  const isTextOnly = upload.postFormat === "text" || upload.mimeType === "text/plain" || !upload.fileName;
  const filePath = isTextOnly ? "" : publishingUploadFilePath(upload.fileName);
  if (!isTextOnly && !fs.existsSync(filePath)) throw new Error(`LinkedIn upload file not found: ${filePath}`);

  if (!upload.caption?.trim()) {
    throw new Error("LinkedIn post text is required.");
  }

  await loginToLinkedIn(page, upload, accountLogin);
  await clickStartPost(page);
  if (!isTextOnly) await attachLinkedInMedia(page, filePath);
  await typeLinkedInPostText(page, upload.caption.trim());
  await clickPostWhenReady(page, accountLogin?.onFinalActionSubmitted);
  await waitForPostComplete(page);

  const holdTime = getPostHoldMs();
  if (holdTime > 0) {
    console.log(`LinkedIn post complete. Holding for ${holdTime / 1000} seconds...`);
    await page.waitForTimeout(holdTime);
  }

  return { success: true };
}
