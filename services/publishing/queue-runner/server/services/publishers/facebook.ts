import type { Locator, Page } from "playwright-core";
import type { PlatformUpload } from "../../../shared/schema.js";
import { waitForLoginWithManualFallback, type AccountLogin } from "./manual-login.js";
import fs from "fs";
import { publishingUploadFilePath } from "../../runtime-paths.js";

const FACEBOOK_HOME_URL = "https://www.facebook.com/";
const FACEBOOK_LOGIN_URL = "https://www.facebook.com/login/";

function getLoginHoldMs() {
  return Number(process.env.FACEBOOK_LOGIN_HOLD_MS ?? 15000);
}

function getComposerSettleMs() {
  return Number(process.env.FACEBOOK_COMPOSER_SETTLE_MS ?? 0);
}

function getAudienceActionSettleMs() {
  return Number(process.env.FACEBOOK_AUDIENCE_ACTION_SETTLE_MS ?? 2500);
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
        // Try the next matching element.
      }
    }
  }

  return null;
}

async function waitForAnyVisible(locators: Locator[], timeout = 30000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const locator = await firstVisible(locators);
    if (locator) return locator;
    await pageWait(200);
  }

  return null;
}

function pageWait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dismissCookiePrompt(page: Page) {
  const cookieButtons = [
    page.getByRole("button", { name: /Allow all cookies/i }),
    page.getByRole("button", { name: /Accept all/i }),
    page.getByRole("button", { name: /^Accept$/i }),
    page.getByRole("button", { name: /Only allow essential cookies/i }),
    page.getByRole("button", { name: /Decline optional cookies/i }),
    page.getByRole("button", { name: /^Decline$/i }),
  ];

  for (const button of cookieButtons) {
    if (await clickIfVisible(button)) {
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function blockNotificationPrompt(page: Page) {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send("Browser.setPermission", {
      origin: "https://www.facebook.com",
      permission: { name: "notifications" },
      setting: "denied",
    });
    await client.detach();
  } catch {
    // The visible Block button fallback below covers browsers without this CDP call.
  }

  const blockButton = await firstVisible([
    page.getByRole("button", { name: /^Block$/i }),
    page.getByText(/^Block$/i),
  ]);

  if (blockButton) {
    console.log("Blocking Facebook notification prompt...");
    await blockButton.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    return;
  }

  await page.keyboard.press("Escape").catch(() => undefined);
}

async function isLoggedIn(page: Page) {
  const url = page.url();
  if (/facebook\.com\/login|checkpoint|two_step|recover|captcha/i.test(url)) return false;

  const loggedInSignals = [
    page.getByRole("link", { name: /^Home$/i }),
    page.getByRole("navigation", { name: /Facebook|Primary/i }),
    page.locator('[aria-label="Facebook"]'),
    page.locator('[aria-label="Home"]'),
    page.locator('[aria-label="Create"]'),
    page.locator('[role="feed"]'),
  ];

  return Boolean(await firstVisible(loggedInSignals));
}

function createPostDialog(page: Page) {
  return page.locator('[role="dialog"]').filter({ hasText: /Create post|What's on your mind/i }).last();
}

function reviewAudienceDialog(page: Page) {
  return page.locator('[role="dialog"]').filter({
    hasText: /Review audience|Choose who can see this and future posts and reels/i,
  }).last();
}

function updateSettingsDialog(page: Page) {
  return page.locator('[role="dialog"]').filter({
    hasText: /Update settings|Who can see your future posts and reels/i,
  }).last();
}

async function locatorIsVisible(locator: Locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function waitForFacebookHome(page: Page) {
  const homeReady = await waitForAnyVisible([
    page.getByText(/What's on your mind/i),
    page.locator('[aria-label="Home"]'),
    page.locator('[role="feed"]'),
  ], 60000);

  if (!homeReady) throw new Error("Facebook home page did not become ready.");
}

async function clickWhatsOnYourMind(page: Page) {
  console.log("Clicking Facebook What's on your mind bar...");
  await blockNotificationPrompt(page);
  await waitForFacebookHome(page);

  const composerButton = await firstVisible([
    page.getByRole("button", { name: /What's on your mind/i }),
    page.locator('[role="button"]').filter({ hasText: /What's on your mind/i }),
    page.getByText(/What's on your mind/i),
  ]);

  if (!composerButton) throw new Error("Could not find Facebook What's on your mind bar.");

  await composerButton.scrollIntoViewIfNeeded();
  await composerButton.click({ force: true, timeout: 10000 });

  const composerReady = await waitForAnyVisible([
    createPostDialog(page),
    reviewAudienceDialog(page),
    updateSettingsDialog(page),
  ], 30000);

  if (!composerReady) throw new Error("Facebook post composer did not open.");

  console.log("Waiting briefly for Facebook audience screens...");
  await page.waitForTimeout(getComposerSettleMs());
}

async function audienceReviewIsVisible(page: Page) {
  const dialog = reviewAudienceDialog(page);
  if (!await locatorIsVisible(dialog)) return false;

  return Boolean(await firstVisible([
    dialog.getByRole("button", { name: /^Continue$/i }),
    dialog.locator('[role="button"]').filter({ hasText: /^Continue$/i }),
    dialog.getByText(/^Continue$/i),
  ]));
}

async function updateSettingsIsVisible(page: Page) {
  return locatorIsVisible(updateSettingsDialog(page));
}

async function createPostComposerIsVisible(page: Page) {
  return locatorIsVisible(createPostDialog(page));
}

async function clickVisibleButton(page: Page, label: RegExp, actionName: string, scope?: Locator) {
  const root = scope ?? page;
  const button = await firstVisible([
    root.getByRole("button", { name: label }),
    root.locator('[role="button"]').filter({ hasText: label }),
    root.locator("button").filter({ hasText: label }),
    root.getByText(label),
  ]);

  if (!button) throw new Error(`Could not find Facebook ${actionName} button.`);

  await button.scrollIntoViewIfNeeded().catch(() => undefined);

  try {
    await button.click({ force: true, timeout: 10000 });
    return;
  } catch {
    const box = await button.boundingBox().catch(() => null);
    if (!box) throw new Error(`Could not click Facebook ${actionName} button.`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

async function publicAudienceIsSelected(page: Page) {
  const dialog = updateSettingsDialog(page);
  const selectedPublic = await firstVisible([
    dialog.getByRole("radio", { name: /Public/i }).filter({ has: dialog.locator('[aria-checked="true"]') }),
    dialog.locator('[role="radio"][aria-checked="true"]').filter({ hasText: /Public/i }),
    dialog.locator('[aria-checked="true"]').locator("xpath=ancestor::*[contains(., 'Public')][1]"),
  ]);

  if (selectedPublic) return true;

  const publicText = await firstVisible([dialog.getByText(/^Public$/i)]);
  const publicBox = await publicText?.boundingBox().catch(() => null);
  if (!publicBox) return false;

  const selectedRadio = await firstVisible([
    dialog.locator('[aria-checked="true"]'),
    dialog.locator('[role="radio"][aria-checked="true"]'),
  ]);
  const selectedBox = await selectedRadio?.boundingBox().catch(() => null);

  return Boolean(selectedBox && Math.abs(selectedBox.y - publicBox.y) < 40);
}

async function selectPublicAudience(page: Page) {
  const dialog = updateSettingsDialog(page);
  const publicOption = await firstVisible([
    dialog.getByRole("radio", { name: /Public/i }),
    dialog.locator('[role="radio"]').filter({ hasText: /Public/i }),
    dialog.getByText(/^Public$/i),
  ]);

  if (!publicOption) throw new Error("Could not find Facebook Public audience option.");

  await publicOption.click({ force: true, timeout: 10000 });
  await page.waitForTimeout(500);

  if (await publicAudienceIsSelected(page)) return;

  const publicBox = await publicOption.boundingBox().catch(() => null);
  const dialogBox = await dialog.boundingBox().catch(() => null);

  if (publicBox && dialogBox) {
    console.log("Clicking Facebook Public radio by row position...");
    await page.mouse.click(dialogBox.x + dialogBox.width - 42, publicBox.y + publicBox.height / 2);
    await page.waitForTimeout(500);
  }
}

async function waitForCreatePostComposerReady(page: Page) {
  console.log("Checking Facebook audience screens...");
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    if (await updateSettingsIsVisible(page)) {
      console.log("Update settings appeared. Selecting Public...");
      const dialog = updateSettingsDialog(page);
      await selectPublicAudience(page);

      console.log("Saving Facebook Public audience...");
      await clickVisibleButton(page, /^Save$/i, "audience Save", dialog);
      await page.waitForTimeout(getAudienceActionSettleMs());
      continue;
    }

    if (await audienceReviewIsVisible(page)) {
      console.log("Review audience appeared. Clicking Continue...");
      await clickVisibleButton(page, /^Continue$/i, "Continue", reviewAudienceDialog(page));
      await page.waitForTimeout(getAudienceActionSettleMs());
      continue;
    }

    if (await createPostComposerIsVisible(page)) {
      console.log("Facebook Create post dialog is ready.");
      return;
    }

    await page.waitForTimeout(100);
  }

  throw new Error("Facebook Create post dialog did not become ready.");
}

async function attachFacebookMedia(page: Page, filePath: string) {
  console.log("Uploading Facebook media...");
  const dialog = createPostDialog(page);
  await dialog.waitFor({ state: "visible", timeout: 30000 });

  const deadline = Date.now() + 15000;
  let fileInput: Locator | null = null;

  while (Date.now() < deadline && !fileInput) {
    const dialogInputs = dialog.locator('input[type="file"]');
    if ((await dialogInputs.count()) > 0) {
      fileInput = dialogInputs.last();
      break;
    }

    const pageInputs = page.locator('input[type="file"]');
    if ((await pageInputs.count()) > 0) {
      fileInput = pageInputs.last();
      break;
    }

    await page.waitForTimeout(250);
  }

  if (!fileInput) {
    throw new Error("Could not find Facebook's hidden media input; the native file picker was not opened.");
  }

  await fileInput.setInputFiles(filePath);

  await page.waitForTimeout(300);
}

async function clickFacebookTextArea(page: Page) {
  const dialog = createPostDialog(page);
  await dialog.waitFor({ state: "visible", timeout: 30000 });

  const placeholder = dialog.getByText(/What's on your mind/i).first();
  const editor = await firstVisible([
    dialog.locator('[contenteditable="true"][role="textbox"]'),
    dialog.locator('[role="textbox"]'),
    dialog.locator('[contenteditable="true"]'),
  ]);
  const placeholderBox = await placeholder.boundingBox().catch(() => null);

  if (placeholderBox) {
    await page.mouse.click(placeholderBox.x + 24, placeholderBox.y + Math.max(18, placeholderBox.height / 2));
    return;
  }

  if (editor) {
    await editor.scrollIntoViewIfNeeded();
    await editor.click({ force: true, timeout: 10000 });
    return;
  }

  const dialogBox = await dialog.boundingBox().catch(() => null);
  if (!dialogBox) throw new Error("Could not find Facebook caption area.");

  await page.mouse.click(dialogBox.x + 40, dialogBox.y + 160);
}

async function typeFacebookCaption(page: Page, caption: string) {
  const text = caption.trim();
  if (!text) return;

  console.log("Entering Facebook caption...");
  await clickFacebookTextArea(page);
  await page.keyboard.insertText(text);
  console.log("Facebook caption entered.");
}

async function waitForFacebookSubmissionStart(page: Page, timeout = 3500) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const postingProgress = await firstVisible([
      page.getByText(/^Posting$/i),
      page.getByText(/Your post is being processed/i),
    ]);

    if (postingProgress || !await createPostComposerIsVisible(page)) return true;
    await page.waitForTimeout(150);
  }

  return false;
}

async function clickFacebookPostWhenReady(page: Page) {
  const dialog = createPostDialog(page);
  await dialog.waitFor({ state: "visible", timeout: 30000 });
  const deadline = Date.now() + 120000;

  while (Date.now() < deadline) {
    const postButton = await firstVisible([
      dialog.locator('[role="button"][aria-label="Post"]'),
      page.locator('[role="button"][aria-label="Post"]'),
      dialog.getByRole("button", { name: /^Post$/i }),
      dialog.locator('[role="button"]').filter({ hasText: /^Post$/i }),
    ]);

    if (!postButton || await postButton.getAttribute("aria-disabled") === "true") {
      await page.waitForTimeout(500);
      continue;
    }

    console.log("Clicking the Facebook Post button...");
    await postButton.click({ force: true, timeout: 10000 });

    if (await waitForFacebookSubmissionStart(page, 2000)) {
      console.log("Facebook accepted the Post click.");
      return;
    }

    console.log("Facebook did not accept the click yet; clicking Post again...");
    await page.waitForTimeout(500);
  }

  throw new Error("Facebook Post button did not become ready or accept the click within 120 seconds.");
}

async function waitForFacebookPostComplete(page: Page) {
  console.log("Post clicked. Waiting 15 seconds before closing Facebook window...");
  const deadline = Date.now() + 15000;
  let sawPostingProgress = false;

  while (Date.now() < deadline) {
    if (!sawPostingProgress) {
      const postingProgress = await firstVisible([
        page.getByText(/^Posting$/i),
        page.locator('[role="dialog"]').filter({ hasText: /^Posting$/i }),
      ]);

      if (postingProgress) {
        sawPostingProgress = true;
        console.log("Facebook Posting progress appeared; submission was accepted.");
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) await page.waitForTimeout(Math.min(250, remainingMs));
  }

  if (await createPostComposerIsVisible(page)) {
    throw new Error("Facebook Create post dialog is still open 15 seconds after clicking Post.");
  }

  console.log("Facebook post wait complete.");
}

async function getLoginError(page: Page) {
  const errorLocator = await firstVisible([
    page.locator("#error_box"),
    page.locator('[role="alert"]'),
    page.getByText(/incorrect/i),
    page.getByText(/The password/i),
    page.getByText(/Find your account/i),
    page.getByText(/temporarily blocked/i),
  ]);

  const text = (await errorLocator?.textContent())?.replace(/\s+/g, " ").trim();
  return text || null;
}

async function isManualVerificationVisible(page: Page, url: string) {
  if (/checkpoint|two_step|captcha|confirmemail|login_approval/i.test(url)) return true;

  const manualPrompt = await firstVisible([
    page.getByText(/I'm not a robot/i),
    page.getByText(/reCAPTCHA/i),
    page.getByText(/Enter the code/i),
    page.getByText(/Check your notifications/i),
    page.getByText(/two-factor authentication/i),
    page.getByText(/authentication app/i),
    page.getByText(/Confirm it's you/i),
  ]);

  return Boolean(manualPrompt);
}

function facebookEmailFieldLocators(page: Page) {
  return [
    page.locator("input#email"),
    page.locator('input[name="email"]'),
    page.locator('input[autocomplete="username"]'),
    page.locator('input[type="email"]'),
    page.locator('input[type="text"]'),
  ];
}

function facebookPasswordFieldLocators(page: Page) {
  return [
    page.locator("input#pass"),
    page.locator('input[name="pass"]'),
    page.locator('input[autocomplete="current-password"]'),
    page.locator('input[type="password"]'),
  ];
}

async function loginFormIsVisible(page: Page) {
  const emailField = await firstVisible(facebookEmailFieldLocators(page));
  const passwordField = await firstVisible(facebookPasswordFieldLocators(page));
  return Boolean(emailField && passwordField);
}

async function waitForLoginResult(page: Page, allowManualLoginFromStart = false, ignoreLoginErrors = false) {
  await waitForLoginWithManualFallback({
    page,
    platform: "Facebook",
    normalTimeoutMs: 90000,
    pollMs: 500,
    isLoggedIn: () => isLoggedIn(page),
    isManualVerificationVisible: (url) => isManualVerificationVisible(page, url),
    isLoginFormVisible: () => loginFormIsVisible(page),
    getLoginError: () => getLoginError(page),
    allowManualLoginFromStart,
    ignoreLoginErrors,
  });
}

export async function loginToFacebook(page: Page, _upload?: PlatformUpload, holdAfterLogin = true, accountLogin?: AccountLogin) {
  const savedSessionOnly = Boolean(accountLogin?.useSavedSessionOnly);
  const manualLoginOnly = !savedSessionOnly;

  console.log("Navigating to Facebook home page...");
  await page.goto(FACEBOOK_HOME_URL, { timeout: 60000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await dismissCookiePrompt(page);

  if (await isLoggedIn(page)) {
    console.log("Facebook session already active.");
  } else if (savedSessionOnly) {
    throw new Error("Facebook saved browser session is not active. Open this account's Login action and complete login before the scheduled publish time.");
  } else {
    console.log("Complete the full Facebook login manually in the visible browser; Companion will save the session after the account opens.");
    await page.goto(FACEBOOK_LOGIN_URL, { timeout: 60000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
    await dismissCookiePrompt(page);
    await waitForLoginResult(page, true, Boolean(accountLogin?.ignoreLoginErrors));
  }

  if (!/facebook\.com\/?$|facebook\.com\/home/i.test(page.url())) {
    await page.goto(FACEBOOK_HOME_URL, { timeout: 60000 });
    await waitForLoginResult(page, manualLoginOnly, manualLoginOnly && Boolean(accountLogin?.ignoreLoginErrors));
  }

  await blockNotificationPrompt(page);

  if (holdAfterLogin) {
    const holdTime = getLoginHoldMs();
    console.log(`Facebook ready. Holding for ${holdTime / 1000} seconds...`);
    await page.waitForTimeout(holdTime);
  } else {
    console.log("Facebook ready.");
  }

  return { success: true };
}

export async function postToFacebook(page: Page, upload: PlatformUpload, accountLogin?: AccountLogin) {
  const isTextOnly = upload.postFormat === "text" || upload.mimeType === "text/plain" || !upload.fileName;
  const filePath = isTextOnly ? "" : publishingUploadFilePath(upload.fileName);
  if (!isTextOnly && !fs.existsSync(filePath)) throw new Error(`Facebook upload file not found: ${filePath}`);

  if (!upload.caption?.trim()) {
    throw new Error("Facebook caption is required.");
  }

  await loginToFacebook(page, upload, false, accountLogin);
  await clickWhatsOnYourMind(page);
  await waitForCreatePostComposerReady(page);
  await typeFacebookCaption(page, upload.caption.trim());
  if (!isTextOnly) await attachFacebookMedia(page, filePath);
  await clickFacebookPostWhenReady(page);
  await waitForFacebookPostComplete(page);

  return { success: true };
}
