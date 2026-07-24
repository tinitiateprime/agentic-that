import type { Locator, Page } from "playwright-core";
import type { PlatformUpload } from "../../../shared/schema.js";
import { waitForLoginWithManualFallback, type AccountLogin } from "./manual-login.js";
import fs from "fs";
import { publishingUploadFilePath } from "../../runtime-paths.js";

const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";
const LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login/";

function getLoginHoldMs() {
  return Number(process.env.LINKEDIN_LOGIN_HOLD_MS ?? 15000);
}

async function clickIfVisible(locator: Locator, timeout = 1500) {
  try {
    await locator.first().click({ timeout });
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

  const startPostButton = await firstVisible([
    page.getByRole("button", { name: /Start a post/i }),
    page.locator("button").filter({ hasText: /Start a post/i }),
    page.getByText(/Start a post/i),
  ]);

  if (!startPostButton) {
    throw new Error("Could not find LinkedIn Start a post button.");
  }

  await startPostButton.scrollIntoViewIfNeeded();
  await startPostButton.click({ force: true, timeout: 10000 });

  try {
    await page.getByText(/What do you want to talk about/i).first().waitFor({ state: "visible", timeout: 8000 });
  } catch {
    const startPostBox = await startPostButton.boundingBox().catch(() => null);
    if (!startPostBox) throw new Error("LinkedIn post composer did not open.");

    await page.mouse.click(startPostBox.x + startPostBox.width / 2, startPostBox.y + startPostBox.height / 2);
    await page.getByText(/What do you want to talk about/i).first().waitFor({ state: "visible", timeout: 8000 });
  }

  await page.waitForTimeout(1000);
}

async function typeLinkedInPostText(page: Page, text: string) {
  console.log("Entering LinkedIn post text...");
  const textPreview = text.replace(/\s+/g, " ").trim().slice(0, 30);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const placeholder = page.getByText(/What do you want to talk about/i).first();
    const editor = await firstVisible([
      page.locator('[role="dialog"] [contenteditable="true"][data-placeholder*="What" i]'),
      page.locator('[role="dialog"] .ql-editor[contenteditable="true"]'),
      page.locator('[role="dialog"] [contenteditable="true"]'),
      page.locator('[role="dialog"] [role="textbox"]'),
      page.locator(".share-creation-state__text-editor [contenteditable='true']"),
      page.locator(".ql-editor[contenteditable='true']"),
    ]);

    const placeholderBox = await placeholder.boundingBox().catch(() => null);

    if (placeholderBox) {
      console.log("Clicking LinkedIn empty post text area...");
      await page.mouse.click(placeholderBox.x + 24, placeholderBox.y + Math.max(12, placeholderBox.height / 2));
    } else if (editor) {
      console.log("Clicking LinkedIn post text editor...");
      await editor.scrollIntoViewIfNeeded();
      const editorBox = await editor.boundingBox().catch(() => null);
      if (editorBox) {
        await page.mouse.click(editorBox.x + 24, editorBox.y + Math.min(40, Math.max(16, editorBox.height / 2)));
      } else {
        await editor.click({ force: true, timeout: 10000 });
      }
    } else {
      const dialog = page.locator('[role="dialog"]').last();
      const dialogBox = await dialog.boundingBox().catch(() => null);
      if (!dialogBox) throw new Error("Could not find LinkedIn post text box.");

      console.log("Clicking LinkedIn post text area by dialog position...");
      await page.mouse.click(dialogBox.x + 40, dialogBox.y + 150);
    }

    await page.waitForTimeout(500);

    const focusedEditor = await firstVisible([
      page.locator('[role="dialog"] [contenteditable="true"][data-placeholder*="What" i]'),
      page.locator('[role="dialog"] .ql-editor[contenteditable="true"]'),
      page.locator('[role="dialog"] [contenteditable="true"]'),
      page.locator('[role="dialog"] [role="textbox"]'),
    ]);

    if (focusedEditor) {
      await focusedEditor.focus();
      await focusedEditor.pressSequentially(text, { delay: 25 });
    } else {
      await page.keyboard.type(text, { delay: 25 });
    }

    await page.waitForTimeout(1000);

    const textAppeared = await page
      .locator('[role="dialog"]')
      .getByText(textPreview, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);

    if (!textPreview || textAppeared) {
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

async function clickPostWhenReady(page: Page) {
  const postButton = page.getByRole("button", { name: /^Post$/i }).last();
  await postButton.waitFor({ state: "visible", timeout: 60000 });

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      if (await postButton.isEnabled()) {
        console.log("Clicking LinkedIn Post button...");
        await postButton.click({ force: true, timeout: 10000 });
        return;
      }
    } catch {
      // Try again until LinkedIn enables the button.
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

async function waitForLoginResult(page: Page, allowManualLoginFromStart = false, ignoreLoginErrors = false) {
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
    throw new Error("LinkedIn saved browser session is not active. Open this account's Login action and complete login before the scheduled publish time.");
  } else {
    console.log("Complete the full LinkedIn login manually in the visible browser; Companion will save the session after the account opens.");
    await waitForLoginResult(page, true, Boolean(accountLogin?.ignoreLoginErrors));
  }

  await page.goto(LINKEDIN_FEED_URL, { timeout: 60000 });
  await waitForLoginResult(page, manualLoginOnly, manualLoginOnly && Boolean(accountLogin?.ignoreLoginErrors));

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
  await clickPostWhenReady(page);
  await waitForPostComplete(page);

  const holdTime = getLoginHoldMs();
  if (holdTime > 0) {
    console.log(`LinkedIn post complete. Holding for ${holdTime / 1000} seconds...`);
    await page.waitForTimeout(holdTime);
  }

  return { success: true };
}
