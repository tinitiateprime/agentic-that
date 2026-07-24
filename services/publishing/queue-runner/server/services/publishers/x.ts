import type { Locator, Page } from "playwright-core";
import type { PlatformUpload } from "../../../shared/schema.js";
import { waitForLoginWithManualFallback, type AccountLogin } from "./manual-login.js";
import fs from "fs";
import { publishingUploadFilePath } from "../../runtime-paths.js";

const X_HOME_URL = "https://x.com/home";
const X_LOGIN_URL = "https://x.com/i/flow/login";

function getLoginHoldMs() {
  return Number(process.env.X_LOGIN_HOLD_MS ?? 15000);
}

function getPostHoldMs() {
  return Number(process.env.X_POST_HOLD_MS ?? 15000);
}

async function firstVisible(locators: Locator[]) {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);

    for (let index = 0; index < Math.min(count, 8); index += 1) {
      const candidate = locator.nth(index);

      try {
        if (await candidate.isVisible()) return candidate;
      } catch {
        // Try the next candidate.
      }
    }
  }

  return null;
}

async function waitForVisible(locators: Locator[], timeout = 30000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const visible = await firstVisible(locators);
    if (visible) return visible;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

async function clickIfVisible(locator: Locator, timeout = 1500) {
  try {
    await locator.first().click({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function dismissCookiePrompt(page: Page) {
  const buttons = [
    page.getByRole("button", { name: /Accept all cookies/i }),
    page.getByRole("button", { name: /Refuse non-essential cookies/i }),
    page.getByRole("button", { name: /^Accept$/i }),
  ];

  for (const button of buttons) {
    if (await clickIfVisible(button)) {
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function isLoggedIn(page: Page) {
  if (/\/i\/flow\/login|\/login(?:\?|$)|account\/access/i.test(page.url())) return false;

  const signals = [
    page.locator('[data-testid="SideNav_AccountSwitcher_Button"]'),
    page.locator('[data-testid="AppTabBar_Home_Link"]'),
    page.locator('[data-testid="SideNav_NewTweet_Button"]'),
    page.locator('a[href="/compose/post"]'),
    page.locator('a[href="/home"][role="link"]'),
  ];

  return Boolean(await firstVisible(signals));
}

function identifierFields(page: Page) {
  return [
    page.locator('input[name="username_or_email"]'),
    page.locator('input[autocomplete^="username"]'),
    page.locator('input[name="text"]'),
    page.locator('[data-testid="ocfEnterTextTextInput"]'),
  ];
}

function passwordFields(page: Page) {
  return [
    page.locator('input[name="password"]'),
    page.locator('input[autocomplete="current-password"]'),
    page.locator('input[type="password"]'),
  ];
}

async function loginFormIsVisible(page: Page) {
  return Boolean(await firstVisible([...identifierFields(page), ...passwordFields(page)]));
}

async function isManualVerificationVisible(page: Page, url: string) {
  if (/account\/access|challenge|captcha|verification|two_factor|arkose/i.test(url)) return true;

  const signal = await firstVisible([
    page.getByText(/Authenticate your account/i),
    page.getByText(/Verify your identity/i),
    page.getByText(/Enter your verification code/i),
    page.getByText(/Check your email/i),
    page.getByText(/two-factor authentication/i),
    page.getByText(/unusual login activity/i),
    page.locator('iframe[src*="arkoselabs" i]'),
    page.locator('iframe[title*="captcha" i]'),
  ]);

  return Boolean(signal);
}

async function getLoginError(page: Page) {
  const candidates = [
    page.locator('[data-testid="toast"]'),
    page.locator('[role="alert"]'),
    page.getByText(/Wrong password/i),
    page.getByText(/Could not log you in/i),
    page.getByText(/temporarily limited your login/i),
    page.getByText(/We cannot currently register this phone number/i),
    page.getByText(/Try again later/i),
  ];

  for (const locator of candidates) {
    const visible = await firstVisible([locator]);
    const text = (await visible?.textContent())?.replace(/\s+/g, " ").trim();

    if (
      text &&
      /wrong|incorrect|could not log|temporarily limited|try again later|cannot currently|suspended|locked/i.test(text)
    ) {
      return text;
    }
  }

  return null;
}

async function openPostComposer(page: Page) {
  console.log("Opening X post composer...");
  const composeButton = await waitForVisible([
    page.locator('[data-testid="SideNav_NewTweet_Button"]'),
    page.locator('a[href="/compose/post"]'),
    page.getByRole("link", { name: /^Post$/i }),
    page.getByRole("button", { name: /^Post$/i }),
  ], 15000);

  if (!composeButton) throw new Error("Could not find the X Post button.");

  await composeButton.scrollIntoViewIfNeeded().catch(() => undefined);
  await composeButton.click({ force: true, timeout: 10000 });

  const editor = await waitForVisible([
    page.locator('[role="dialog"] [data-testid="tweetTextarea_0"]'),
    page.locator('[data-testid="tweetTextarea_0"]'),
    page.getByRole("textbox", { name: /Post text|What's happening/i }),
  ], 15000);

  if (!editor) throw new Error("X post composer did not open.");
  console.log("X post composer opened.");
}

async function getPostComposer(page: Page) {
  return waitForVisible([
    page.locator('[role="dialog"]').filter({ has: page.locator('[data-testid="tweetTextarea_0"]') }),
    page.locator('[role="dialog"]').filter({ has: page.getByRole("textbox", { name: /Post text|What's happening/i }) }),
  ], 15000);
}

async function attachXMedia(page: Page, filePath: string) {
  console.log("Uploading X media...");
  const composer = await getPostComposer(page);
  if (!composer) throw new Error("Could not find the X post composer for media upload.");

  const inputs = composer.locator('input[type="file"]');
  let fileInput = inputs.last();

  if ((await inputs.count()) === 0) {
    const pageInputs = page.locator('input[type="file"][data-testid="fileInput"], input[type="file"]');
    if ((await pageInputs.count()) === 0) throw new Error("Could not find the X media upload input.");
    fileInput = pageInputs.last();
  }

  await fileInput.setInputFiles(filePath);
  console.log("X media selected; waiting for it to become ready...");
}

async function fillXCaption(page: Page, caption: string) {
  console.log("Entering X caption...");
  const composer = await getPostComposer(page);
  if (!composer) throw new Error("Could not find the X post composer for caption entry.");

  const editor = await firstVisible([
    composer.locator('[data-testid="tweetTextarea_0"]'),
    composer.getByRole("textbox", { name: /Post text|What's happening/i }),
    composer.locator('[contenteditable="true"][role="textbox"]'),
  ]);

  if (!editor) throw new Error("Could not find the X What's happening field.");

  await editor.scrollIntoViewIfNeeded().catch(() => undefined);
  await editor.click({ force: true, timeout: 10000 });
  await editor.fill(caption);

  const enteredText = (await editor.innerText().catch(() => "")).trim();
  if (!enteredText) throw new Error("The X caption was not entered into the composer.");
  console.log("X caption entered.");
}

async function clickXPostWhenReady(page: Page) {
  const composer = await getPostComposer(page);
  if (!composer) throw new Error("Could not find the X post composer before publishing.");

  const deadline = Date.now() + Number(process.env.X_UPLOAD_TIMEOUT_MS ?? 300000);

  while (Date.now() < deadline) {
    const postButton = await firstVisible([
      composer.locator('[data-testid="tweetButton"]'),
      composer.getByRole("button", { name: /^Post$/i }),
    ]);

    if (postButton && await postButton.isEnabled().catch(() => false)) {
      console.log("Clicking X Post button...");
      await postButton.click({ force: true, timeout: 10000 });
      return composer;
    }

    const error = await firstVisible([
      page.locator('[data-testid="toast"]').filter({ hasText: /failed|error|try again|unsupported/i }),
      page.locator('[role="alert"]').filter({ hasText: /failed|error|try again|unsupported/i }),
    ]);
    const errorText = (await error?.textContent())?.replace(/\s+/g, " ").trim();
    if (errorText) throw new Error(`X media upload error: ${errorText}`);

    await page.waitForTimeout(1000);
  }

  throw new Error("X Post button did not become enabled while the media was uploading.");
}

async function waitForXPostComplete(page: Page, composer: Locator) {
  console.log("Waiting for X to confirm the post...");
  const deadline = Date.now() + 90000;

  while (Date.now() < deadline) {
    const success = await firstVisible([
      page.locator('[data-testid="toast"]').filter({ hasText: /post was sent|posted|view/i }),
      page.getByText(/Your post was sent/i),
      page.getByText(/^View$/i),
    ]);

    if (success || !await composer.isVisible().catch(() => false)) {
      console.log("X post published.");
      return;
    }

    const error = await firstVisible([
      page.locator('[data-testid="toast"]').filter({ hasText: /failed|error|try again|not sent/i }),
      page.locator('[role="alert"]').filter({ hasText: /failed|error|try again|not sent/i }),
    ]);
    const errorText = (await error?.textContent())?.replace(/\s+/g, " ").trim();
    if (errorText) throw new Error(`X post error: ${errorText}`);

    await page.waitForTimeout(500);
  }

  throw new Error("X did not confirm the post within 90 seconds.");
}

async function waitForLoginResult(page: Page, allowManualLoginFromStart: boolean, ignoreLoginErrors = false) {
  await waitForLoginWithManualFallback({
    page,
    platform: "X",
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

export async function loginToX(page: Page, _upload?: PlatformUpload, holdAfterLogin = true, accountLogin?: AccountLogin) {
  const savedSessionOnly = Boolean(accountLogin?.useSavedSessionOnly);
  const manualLoginOnly = !savedSessionOnly;

  console.log("Navigating to X...");
  await page.goto(X_HOME_URL, { timeout: 60000, waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await dismissCookiePrompt(page);

  if (await isLoggedIn(page)) {
    console.log("X session already active.");
  } else if (savedSessionOnly) {
    throw new Error("X saved browser session is not active. Open this account's Login action and complete login before the scheduled publish time.");
  } else {
    await page.goto(X_LOGIN_URL, { timeout: 60000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await dismissCookiePrompt(page);

    console.log("Complete the full X login manually in the visible browser; Companion will save the session after the account opens.");
    await waitForLoginResult(page, true, Boolean(accountLogin?.ignoreLoginErrors));
  }

  if (!/x\.com\/home/i.test(page.url())) {
    await page.goto(X_HOME_URL, { timeout: 60000, waitUntil: "domcontentloaded" });
    await waitForLoginResult(page, manualLoginOnly, Boolean(accountLogin?.ignoreLoginErrors));
  }

  if (holdAfterLogin) {
    const holdTime = getLoginHoldMs();
    console.log(`X login ready. Holding for ${holdTime / 1000} seconds...`);
    await page.waitForTimeout(holdTime);
  } else {
    console.log("X login ready.");
  }

  return { success: true };
}

export async function postToX(page: Page, upload: PlatformUpload, accountLogin?: AccountLogin) {
  const isTextOnly = upload.postFormat === "text" || upload.mimeType === "text/plain" || !upload.fileName;
  const filePath = isTextOnly ? "" : publishingUploadFilePath(upload.fileName);
  if (!isTextOnly && !fs.existsSync(filePath)) throw new Error(`X upload file not found: ${filePath}`);

  const caption = upload.caption?.trim();
  if (!caption) throw new Error("X caption is required.");

  await loginToX(page, upload, false, accountLogin);
  await openPostComposer(page);
  if (!isTextOnly) await attachXMedia(page, filePath);
  await fillXCaption(page, caption);
  const composer = await clickXPostWhenReady(page);
  await waitForXPostComplete(page, composer);

  const holdTime = getPostHoldMs();
  console.log(`X post complete. Holding for ${holdTime / 1000} seconds...`);
  await page.waitForTimeout(holdTime);

  return { success: true };
}
