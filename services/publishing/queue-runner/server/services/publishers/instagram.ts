import type { Locator, Page } from "playwright-core";
import type { PlatformUpload } from "../../../shared/schema.js";
import { waitForLoginWithManualFallback, type AccountLogin } from "./manual-login.js";
import fs from "fs";
import { publishingUploadFilePath } from "../../runtime-paths.js";

const INSTAGRAM_HOME_URL = "https://www.instagram.com/";
const INSTAGRAM_LOGIN_URL = "https://www.instagram.com/accounts/login/";

function getLoginHoldMs() {
  return Number(process.env.INSTAGRAM_LOGIN_HOLD_MS ?? 15000);
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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return null;
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
      await page.waitForTimeout(300);
      return;
    }
  }
}

async function isLoggedIn(page: Page) {
  const url = page.url();
  if (/instagram\.com\/accounts\/login/i.test(url)) return false;
  if (/instagram\.com\/accounts\/(onetap|emailsignup)/i.test(url)) return false;

  const loggedInSignals = [
    page.getByRole("link", { name: /^Home$/i }),
    page.getByRole("link", { name: /Profile/i }),
    page.locator('a[href="/"]'),
    page.locator('svg[aria-label="Home"]'),
    page.locator('svg[aria-label="New post"]'),
  ];

  return Boolean(await firstVisible(loggedInSignals));
}

async function getLoginError(page: Page) {
  const errorLocator = await firstVisible([
    page.locator("#slfErrorAlert"),
    page.locator('[role="alert"]'),
    page.getByText(/incorrect/i),
    page.getByText(/There was a problem logging you in/i),
    page.getByText(/Please wait a few minutes/i),
  ]);

  const text = (await errorLocator?.textContent())?.replace(/\s+/g, " ").trim();
  return text || null;
}

async function clickLoginInterstitialLink(page: Page) {
  const usernameInput = await firstVisible([
    page.locator('input[name="username"]'),
    page.locator('input[autocomplete="username"]'),
    page.locator('input[type="text"]'),
  ]);

  if (usernameInput) return;

  const interstitialTextVisible = await page
    .getByText(/Get the full experience with the tablet app/i)
    .first()
    .isVisible()
    .catch(() => false);

  const loginLink = await firstVisible([
    page.getByRole("link", { name: /^Log in$/i }),
    page.locator('a[href*="/accounts/login"]').filter({ hasText: /^Log in$/i }),
    page.getByText(/^Log in$/i),
  ]);

  if (!loginLink) return;

  console.log("Clicking Instagram blue Log in link...");
  await loginLink.scrollIntoViewIfNeeded();
  await loginLink.click({ force: true, timeout: 10000 });

  if (interstitialTextVisible) {
    await page.waitForTimeout(600);
  }

  const loginField = await firstVisible([
    page.locator('input[name="username"]'),
    page.locator('input[autocomplete="username"]'),
    page.locator('input[type="text"]'),
  ]);

  if (!loginField) {
    await page.locator('input[name="username"], input[autocomplete="username"], input[type="text"]').first().waitFor({
      state: "visible",
      timeout: 15000,
    });
  }
}

async function loginFormIsVisible(page: Page) {
  const usernameField = await firstVisible([
    page.getByLabel(/Phone number, username, or email/i),
    page.locator('input[name="username"]'),
    page.locator('input[autocomplete="username"]'),
    page.locator('input[type="text"]'),
  ]);
  const passwordField = await firstVisible([
    page.getByLabel(/^Password$/i),
    page.locator('input[name="password"]'),
    page.locator('input[autocomplete="current-password"]'),
    page.locator('input[type="password"]'),
  ]);
  return Boolean(usernameField && passwordField);
}

async function isManualVerificationVisible(page: Page, url: string) {
  if (/challenge|two_factor|checkpoint|captcha|suspended|disabled/i.test(url)) return true;

  const signal = await firstVisible([
    page.getByText(/Confirm your account/i),
    page.getByText(/Enter security code/i),
    page.getByText(/Check your email/i),
    page.getByText(/Verify your account/i),
    page.getByText(/two-factor authentication/i),
    page.locator('iframe[title*="captcha" i]'),
    page.locator('iframe[src*="captcha" i]'),
  ]);

  return Boolean(signal);
}

async function dismissPostLoginPrompts(page: Page) {
  const notNowButtons = [
    page.getByRole("button", { name: /^Not now$/i }),
    page.getByRole("button", { name: /^Not Now$/i }),
    page.getByText(/^Not now$/i),
    page.getByText(/^Not Now$/i),
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const button of notNowButtons) {
      if (await clickIfVisible(button, 1200)) {
        await page.waitForTimeout(400);
        break;
      }
    }
  }
}

async function clickCreateButton(page: Page) {
  console.log("Clicking Instagram create button...");

  const createButton = await firstVisible([
    page.getByRole("link", { name: /Create|New post/i }),
    page.getByRole("button", { name: /Create|New post/i }),
    page.locator('svg[aria-label="New post"]'),
    page.locator('svg[aria-label="Create"]'),
    page.locator('a[href*="/create"]'),
  ]);

  if (!createButton) {
    throw new Error("Could not find Instagram + create button.");
  }

  await createButton.scrollIntoViewIfNeeded();
  await createButton.click({ force: true, timeout: 10000 });
  await page.waitForTimeout(350);

  if (await waitForInstagramComposerReady(page, 2500)) {
    console.log("Instagram post composer opened directly.");
    return;
  }

  console.log("Instagram Create menu opened; choosing Post...");
  const postOption = await waitForAnyVisible([
    page.getByRole("menuitem", { name: /^Post$/i }),
    page.getByRole("link", { name: /^Post$/i }),
    page.getByRole("button", { name: /^Post$/i }),
    page.locator('[role="menu"] [role="button"]').filter({ hasText: /^Post$/i }),
    page.locator('[role="dialog"] [role="button"]').filter({ hasText: /^Post$/i }),
    page.locator('div[role="button"]').filter({ hasText: /^Post$/i }),
    page.getByText(/^Post$/i),
  ], 15000);

  if (!postOption) {
    throw new Error("Instagram Create menu opened, but the Post option was not available.");
  }

  await postOption.scrollIntoViewIfNeeded().catch(() => undefined);
  await postOption.click({ force: true, timeout: 10000 });

  if (!await waitForInstagramComposerReady(page, 20000)) {
    throw new Error("Instagram Post was selected, but the Create new post composer did not open.");
  }

  console.log("Instagram Post selected and composer ready.");
}

async function waitForInstagramComposerReady(page: Page, timeout: number) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const composerSignal = await firstVisible([
      page.getByText(/Create new post/i),
      page.getByRole("button", { name: /Select from computer/i }),
      page.getByText(/Select from computer/i),
    ]);
    if (composerSignal) return true;

    const composerFileInputs = page.locator('[role="dialog"] input[type="file"]');
    if ((await composerFileInputs.count().catch(() => 0)) > 0) return true;

    await page.waitForTimeout(200);
  }

  return false;
}

async function dismissNativeFileDialogFallback(page: Page) {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(200);
}

async function uploadInstagramMedia(page: Page, filePath: string) {
  console.log("Uploading Instagram media...");

  const dialogFileInput = page.locator('[role="dialog"] input[type="file"]').last();
  const fileInput = (await dialogFileInput.count()) > 0
    ? dialogFileInput
    : page.locator('input[type="file"]').last();
  if ((await fileInput.count()) > 0) {
    await fileInput.setInputFiles(filePath);
  } else {
    const selectButton = await firstVisible([
      page.getByRole("button", { name: /Select from computer/i }),
      page.getByText(/Select from computer/i),
    ]);

    if (!selectButton) {
      throw new Error("Could not find Instagram Select from computer button.");
    }

    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10000 }).catch(() => null);
    await selectButton.click({ force: true, timeout: 10000 });

    const fileChooser = await fileChooserPromise;
    if (fileChooser) {
      await fileChooser.setFiles(filePath);
    } else {
      await dismissNativeFileDialogFallback(page);
      await page.locator('input[type="file"]').last().setInputFiles(filePath);
    }
  }

  await page.waitForTimeout(500);
}

async function dismissInstagramReelsInfo(page: Page) {
  const okButtons = [
    page.getByRole("button", { name: /^OK$/i }),
    page.getByText(/^OK$/i),
  ];

  for (const okButton of okButtons) {
    if (await clickIfVisible(okButton, 2500)) {
      console.log("Closed Instagram reels info popup.");
      await page.waitForTimeout(400);
      return;
    }
  }
}

async function waitForInstagramCropScreen(page: Page) {
  await page.getByText(/^Crop$/i).first().waitFor({ state: "visible", timeout: 60000 });
  await dismissInstagramReelsInfo(page);
  await page.getByText(/^Crop$/i).first().waitFor({ state: "visible", timeout: 60000 });
}

async function selectOriginalAspectAndClickNext(page: Page) {
  console.log("Selecting Instagram Original crop option...");

  await waitForInstagramCropScreen(page);

  const cropToggle = await firstVisible([
    page.getByRole("button", { name: /Select crop|Crop|Original/i }),
    page.locator('svg[aria-label*="Select crop" i]'),
    page.locator('svg[aria-label*="Crop" i]'),
  ]);

  if (!cropToggle) {
    const cropDialog = page.getByText(/^Crop$/i).locator("xpath=ancestor::*[@role='dialog'][1]");
    const dialogBox = await cropDialog.boundingBox().catch(() => null);
    if (!dialogBox) throw new Error("Could not find Instagram crop button.");

    await page.mouse.click(dialogBox.x + 42, dialogBox.y + dialogBox.height - 42);
  } else {
    await cropToggle.click({ force: true, timeout: 10000 });
  }

  await page.waitForTimeout(250);

  const originalOption = await firstVisible([
    page.getByText(/^Original$/i),
    page.getByRole("button", { name: /^Original$/i }),
    page.locator('[role="button"]').filter({ hasText: /^Original$/i }),
  ]);

  if (!originalOption) {
    throw new Error("Could not find Instagram Original crop option.");
  }

  await originalOption.click({ force: true, timeout: 10000 });
  await page.waitForTimeout(250);

  console.log("Clicking Instagram crop Next button...");
  const nextButton = await firstVisible([
    page.getByRole("button", { name: /^Next$/i }),
    page.getByText(/^Next$/i),
  ]);

  if (!nextButton) throw new Error("Could not find Instagram Next button.");

  await nextButton.click({ force: true, timeout: 10000 });
  await page.waitForTimeout(350);
}

async function clickInstagramEditNext(page: Page) {
  console.log("Clicking Instagram edit Next button...");

  const editReady = await waitForAnyVisible([
    page.getByText(/^Edit$/i),
    page.getByText(/^New post$/i),
    page.getByText(/^Create new post$/i),
    page.getByRole("button", { name: /^Next$/i }),
    page.getByText(/^Next$/i),
  ], 60000);

  if (!editReady) throw new Error("Instagram edit screen did not appear.");

  const nextButton = await firstVisible([
    page.getByRole("button", { name: /^Next$/i }),
    page.getByText(/^Next$/i),
  ]);

  if (!nextButton) throw new Error("Could not find Instagram edit Next button.");

  await nextButton.scrollIntoViewIfNeeded();
  await nextButton.click({ force: true, timeout: 10000 });

  const shareReady = await waitForAnyVisible([
    page.getByRole("button", { name: /^Share$/i }),
    page.getByText(/^Share$/i),
    page.getByText(/^New reel$/i),
    page.getByText(/^Create new post$/i),
  ], 60000);

  if (!shareReady) throw new Error("Instagram share screen did not appear.");
}

async function cancelDiscardPromptIfVisible(page: Page) {
  const discardPrompt = await firstVisible([
    page.getByText(/^Discard post\?$/i),
    page.getByText(/If you leave, your edits won't be saved/i),
  ]);

  if (!discardPrompt) return false;

  const cancelButton = await firstVisible([
    page.getByRole("button", { name: /^Cancel$/i }),
    page.getByText(/^Cancel$/i),
  ]);

  if (!cancelButton) return false;

  console.log("Canceling Instagram discard prompt and continuing to wait...");
  await cancelButton.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(400);
  return true;
}

async function clickDoneAfterInstagramShared(page: Page) {
  const deadline = Date.now() + 300000;

  while (Date.now() < deadline) {
    await cancelDiscardPromptIfVisible(page);

    const sharedScreen = await firstVisible([
      page.getByText(/^Reel shared$/i),
      page.getByText(/^Post shared$/i),
      page.getByText(/Your reel has been shared/i),
      page.getByText(/Your post has been shared/i),
    ]);
    const doneButton = await firstVisible([
      page.getByRole("button", { name: /^Done$/i }),
      page.getByText(/^Done$/i),
      page.locator('[role="button"]').filter({ hasText: /^Done$/i }),
    ]);

    if (sharedScreen && doneButton) {
      console.log("Instagram reported the reel as shared. Clicking Done...");
      await doneButton.click({ force: true, timeout: 10000 });
      await page.waitForTimeout(1000);
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error("Instagram shared confirmation did not appear within 300 seconds.");
}

async function clickInstagramCaptionArea(page: Page) {
  const captionEditor = await firstVisible([
    page.getByRole("textbox", { name: /caption/i }),
    page.locator('textarea[aria-label*="caption" i]'),
    page.locator('textarea[placeholder*="caption" i]'),
    page.locator('[role="textbox"][aria-label*="caption" i]'),
    page.locator('[contenteditable="true"][aria-label*="caption" i]'),
    page.locator('[role="textbox"]').last(),
    page.locator('[contenteditable="true"]').last(),
    page.locator("textarea").last(),
  ]);

  if (captionEditor) {
    await captionEditor.scrollIntoViewIfNeeded();
    await captionEditor.click({ force: true, timeout: 10000 });
    return;
  }

  const characterCounter = await firstVisible([
    page.getByText(/0\s*\/\s*2,?200/i),
    page.getByText(/\d+\s*\/\s*2,?200/i),
  ]);
  const counterBox = await characterCounter?.boundingBox().catch(() => null);

  if (counterBox) {
    await page.mouse.click(Math.max(counterBox.x - 230, 20), Math.max(counterBox.y - 80, 20));
    return;
  }

  const shareButton = await firstVisible([
    page.getByRole("button", { name: /^Share$/i }),
    page.getByText(/^Share$/i),
  ]);
  const shareBox = await shareButton?.boundingBox().catch(() => null);

  if (shareBox) {
    await page.mouse.click(Math.max(shareBox.x - 300, 20), shareBox.y + 160);
    return;
  }

  throw new Error("Could not find Instagram caption area.");
}

async function fillInstagramCaption(page: Page, caption: string) {
  const text = caption.trim();
  if (!text) return;

  console.log("Entering Instagram caption...");

  const shareScreenReady = await waitForAnyVisible([
    page.getByText(/^New reel$/i),
    page.getByText(/^Create new post$/i),
    page.getByRole("button", { name: /^Share$/i }),
    page.getByText(/^Share$/i),
  ], 60000);

  if (!shareScreenReady) throw new Error("Instagram share screen did not appear before caption entry.");

  await clickInstagramCaptionArea(page);
  await page.waitForTimeout(100);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(250);

  const preview = text.replace(/\s+/g, " ").trim().slice(0, 30);
  const captionAppeared = !preview || await page.getByText(preview, { exact: false }).first().isVisible().catch(() => false);

  if (!captionAppeared) {
    await clickInstagramCaptionArea(page);
    await page.keyboard.insertText(text);
    await page.waitForTimeout(250);
  }

  const retryAppeared = !preview || await page.getByText(preview, { exact: false }).first().isVisible().catch(() => false);
  if (!retryAppeared) throw new Error("Instagram caption was not entered into the composer.");

  console.log("Instagram caption entered.");
}

async function clickInstagramShareAndWait(page: Page) {
  console.log("Clicking Instagram Share button...");

  const shareButton = await firstVisible([
    page.getByRole("button", { name: /^Share$/i }),
    page.getByText(/^Share$/i),
  ]);

  if (!shareButton) throw new Error("Could not find Instagram Share button.");

  await shareButton.scrollIntoViewIfNeeded();
  await shareButton.click({ force: true, timeout: 10000 });
  await page.waitForTimeout(300);

  await clickDoneAfterInstagramShared(page);
}

async function waitForLoginResult(page: Page, allowManualLoginFromStart = false, ignoreLoginErrors = false) {
  await waitForLoginWithManualFallback({
    page,
    platform: "Instagram",
    normalTimeoutMs: 90000,
    pollMs: 500,
    isLoggedIn: () => isLoggedIn(page),
    isManualVerificationVisible: (url) => isManualVerificationVisible(page, url),
    isLoginFormVisible: () => loginFormIsVisible(page),
    getLoginError: () => getLoginError(page),
    beforeCheck: () => dismissPostLoginPrompts(page),
    allowManualLoginFromStart,
    ignoreLoginErrors,
  });
}

export async function loginToInstagram(page: Page, _upload?: PlatformUpload, holdAfterLogin = true, accountLogin?: AccountLogin) {
  const savedSessionOnly = Boolean(accountLogin?.useSavedSessionOnly);
  const manualLoginOnly = !savedSessionOnly;

  console.log(`Navigating to Instagram ${savedSessionOnly ? "home" : "login"} page...`);
  await page.goto(savedSessionOnly ? INSTAGRAM_HOME_URL : INSTAGRAM_LOGIN_URL, { timeout: 60000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await dismissCookiePrompt(page);

  if (await isLoggedIn(page)) {
    console.log("Instagram session already active.");
  } else if (savedSessionOnly) {
    throw new Error("Instagram saved browser session is not active. Open this account's Login action and complete login before the scheduled publish time.");
  } else {
    console.log("Complete the full Instagram login manually in the visible browser; Companion will save the session after the account opens.");
    await clickLoginInterstitialLink(page);
    await waitForLoginResult(page, true, Boolean(accountLogin?.ignoreLoginErrors));
  }

  await page.goto(INSTAGRAM_HOME_URL, { timeout: 60000 });
  await waitForLoginResult(page, manualLoginOnly, manualLoginOnly && Boolean(accountLogin?.ignoreLoginErrors));

  if (holdAfterLogin) {
    const holdTime = getLoginHoldMs();
    console.log(`Instagram ready. Holding for ${holdTime / 1000} seconds...`);
    await page.waitForTimeout(holdTime);
  } else {
    console.log("Instagram ready.");
  }

  return { success: true };
}

export async function postToInstagram(page: Page, upload: PlatformUpload, accountLogin?: AccountLogin) {
  if (upload.postFormat === "text" || upload.mimeType === "text/plain" || !upload.fileName) {
    throw new Error("Instagram does not support text-only feed posts.");
  }
  const filePath = publishingUploadFilePath(upload.fileName);
  if (!fs.existsSync(filePath)) throw new Error(`Instagram upload file not found: ${filePath}`);

  await loginToInstagram(page, upload, false, accountLogin);
  await clickCreateButton(page);
  await uploadInstagramMedia(page, filePath);
  await dismissInstagramReelsInfo(page);
  await selectOriginalAspectAndClickNext(page);
  await clickInstagramEditNext(page);
  await fillInstagramCaption(page, upload.caption);
  await clickInstagramShareAndWait(page);

  const holdTime = Number(process.env.INSTAGRAM_POST_HOLD_MS ?? 1000);
  console.log(`Instagram post completed. Holding for ${holdTime / 1000} seconds...`);
  await page.waitForTimeout(holdTime);

  return { success: true };
}
