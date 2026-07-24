import type { Locator, Page } from "playwright-core";
import type { PlatformUpload } from "../../../shared/schema.js";
import { waitForLoginWithManualFallback, type AccountLogin } from "./manual-login.js";
import path from "path";
import fs from "fs";
import { publishingUploadFilePath } from "../../runtime-paths.js";

const YES_MADE_FOR_KIDS_TEXT = /Yes.*made for kids/i;
const PUBLIC_VISIBILITY_TEXT = /Public/i;
const YOUTUBE_HOME_URL = "https://www.youtube.com/";
const YOUTUBE_UPLOAD_URL = "https://www.youtube.com/upload";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function imageMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
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
        if (await candidate.isVisible()) return candidate;
      } catch {
        // Try the next matching element.
      }
    }
  }

  return null;
}

async function waitForVisible(locators: Locator[], timeout = 30000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const locator = await firstVisible(locators);
    if (locator) return locator;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return null;
}

async function dismissChromeSignInPrompt(page: Page) {
  console.log("Checking for Chrome sign-in popup...");

  const dismissers = [
    page.getByText("Use Chrome without an account", { exact: true }),
    page.getByRole("button", { name: /Use Chrome without an account/i }),
    page.getByRole("button", { name: /Continue as/i }),
    page.getByText(/Continue as/i),
    page.getByRole("button", { name: /Not now/i }),
  ];

  for (const dismisser of dismissers) {
    if (await clickIfVisible(dismisser)) {
      await page.waitForTimeout(750);
      console.log("Closed Chrome sign-in popup.");
      return;
    }
  }

  // The Chrome "Make Chrome your own" prompt is browser UI, not normal page
  // DOM. Escape closes it when Chrome gives that bubble focus.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    } catch {
      // Ignore; this is only a best-effort cleanup.
    }
  }
}

async function fillEditable(page: Page, locator: Locator, text: string) {
  await locator.click({ force: true });
  await page.waitForTimeout(300);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(text);
}

async function scrollUploadDialogDown(page: Page) {
  await page.evaluate(() => {
    const isElementVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };

    const collectScrollableElements = (root: Document | ShadowRoot | Element): HTMLElement[] => {
      const elements: HTMLElement[] = [];
      const rootElement = root instanceof HTMLElement ? root : null;
      const candidates = [
        ...(rootElement ? [rootElement] : []),
        ...Array.from(root.querySelectorAll<HTMLElement>("*")),
      ];

      for (const element of candidates) {
        if (element.shadowRoot) {
          elements.push(...collectScrollableElements(element.shadowRoot));
        }

        const style = window.getComputedStyle(element);
        const canScroll = element.scrollHeight > element.clientHeight + 40;
        const overflowAllowsScroll = /auto|scroll|overlay/i.test(style.overflowY);

        if (canScroll && (overflowAllowsScroll || element.id === "scrollable-content") && isElementVisible(element)) {
          elements.push(element);
        }
      }

      return elements;
    };

    const dialog =
      document.querySelector("ytcp-uploads-dialog") ??
      document.querySelector("tp-yt-paper-dialog") ??
      document.body;
    const scrollable = collectScrollableElements(dialog)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];

    if (scrollable) {
      scrollable.scrollTop = Math.min(scrollable.scrollTop + 900, scrollable.scrollHeight);
      return;
    }

    window.scrollBy(0, 900);
  });

  await page.waitForTimeout(700);
}

async function scrollUploadDialogToTop(page: Page) {
  const dialog = page.locator("ytcp-uploads-dialog").first();
  const box = await dialog.boundingBox();

  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -2000);
  }

  try {
    await page.keyboard.press("Home");
  } catch {
    // The mouse wheel above is enough when the dialog does not have keyboard focus.
  }

  await page.waitForTimeout(700);
}

async function clickPublicVisibilityByMouse(page: Page) {
  const publicLabel = page.locator("ytcp-uploads-dialog").getByText(/^Public$/i).first();

  try {
    await publicLabel.scrollIntoViewIfNeeded({ timeout: 5000 });
    await publicLabel.click({ force: true, timeout: 3000 });
    await page.waitForTimeout(1000);
    return true;
  } catch {
    // Try a direct click on the radio circle next to the label.
  }

  const labelBox = await publicLabel.boundingBox();
  if (!labelBox) return false;

  await page.mouse.click(Math.max(labelBox.x - 22, 1), labelBox.y + labelBox.height / 2);
  await page.waitForTimeout(1000);
  return true;
}

async function publicVisibilityIsSelected(page: Page) {
  const selectedPublic = page.locator(
    'ytcp-uploads-dialog tp-yt-paper-radio-button[name="PUBLIC"][aria-checked="true"], ' +
      'ytcp-uploads-dialog tp-yt-paper-radio-button[name="PUBLIC"][checked], ' +
      'ytcp-uploads-dialog [role="radio"][aria-label*="Public"][aria-checked="true"]',
  );

  return (await selectedPublic.count()) > 0;
}

async function waitForPublishButton(page: Page, timeout = 7000) {
  try {
    await page.locator("ytcp-uploads-dialog ytcp-button").filter({ hasText: /^Publish$/i }).last().waitFor({
      state: "visible",
      timeout,
    });
    return true;
  } catch {
    return false;
  }
}

async function selectMadeForKids(page: Page) {
  console.log("Scrolling to the Made for Kids audience radio...");

  const radioLocators = [
    page.getByRole("radio", { name: YES_MADE_FOR_KIDS_TEXT }).first(),
    page.locator("tp-yt-paper-radio-button").filter({ hasText: YES_MADE_FOR_KIDS_TEXT }).first(),
    page.getByText(YES_MADE_FOR_KIDS_TEXT).first(),
  ];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    for (const radio of radioLocators) {
      try {
        await radio.scrollIntoViewIfNeeded({ timeout: 2500 });
        await radio.click({ force: true, timeout: 2500 });
        console.log("Selected 'Yes, it's made for kids'.");
        return;
      } catch {
        // Try the next selector/scroll position.
      }
    }

    await scrollUploadDialogDown(page);
  }

  throw new Error("Could not find or click the 'Yes, it's made for kids' radio button.");
}

async function waitForVideoPreview(page: Page) {
  console.log("Waiting for uploaded video preview/link...");

  try {
    await page.getByText(/Video link/i).first().waitFor({ state: "visible", timeout: 120000 });
    console.log("Video link label is visible.");
    return;
  } catch {
    // Fall back to the actual YouTube link if the label text changes.
  }

  try {
    await page.locator('a[href*="youtu.be"], a[href*="youtube.com/watch"]').first().waitFor({
      state: "visible",
      timeout: 30000,
    });
    console.log("Video link is visible.");
    return;
  } catch {
    throw new Error("Uploaded video preview/link did not appear.");
  }
}

async function waitForUploadDialogText(page: Page, text: RegExp, screenName: string) {
  await page.locator("ytcp-uploads-dialog").getByText(text).first().waitFor({
    state: "visible",
    timeout: 60000,
  });
  console.log(`${screenName} page is visible.`);
}

async function clickDialogButtonWhenReady(page: Page, labels: string[], actionName: string) {
  const labelMatcher = new RegExp(labels.map(escapeRegExp).join("|"), "i");
  const button = page.locator("ytcp-uploads-dialog ytcp-button").filter({ hasText: labelMatcher }).last();

  await button.waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction((buttonLabels: string[]) => {
    const normalizedLabels = buttonLabels.map((label) => label.toLowerCase());
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("ytcp-uploads-dialog ytcp-button, ytcp-button"));

    return buttons.some((candidate) => {
      const label = candidate.textContent?.trim().toLowerCase();
      if (!label || !normalizedLabels.includes(label)) return false;

      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      const ariaDisabled = candidate.getAttribute("aria-disabled") === "true";
      const disabled = candidate.hasAttribute("disabled");

      return (
        !ariaDisabled &&
        !disabled &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    });
  }, labels, { timeout: 60000 });

  console.log(`Clicking ${actionName}...`);
  await button.click({ timeout: 30000 });
  await page.waitForTimeout(1800);
}

async function clickNextWhenReady(page: Page) {
  await clickDialogButtonWhenReady(page, ["Next"], "Next");
}

async function selectPublicVisibility(page: Page) {
  await waitForUploadDialogText(page, /Choose when to publish/i, "Visibility");
  await scrollUploadDialogToTop(page);
  console.log("Selecting Public visibility...");

  const publicLocators = [
    page.locator('ytcp-uploads-dialog tp-yt-paper-radio-button[name="PUBLIC"]').first(),
    page.locator('tp-yt-paper-radio-button[name="PUBLIC"]').first(),
    page.locator('ytcp-uploads-dialog tp-yt-paper-radio-button[aria-label*="Public"]').first(),
    page.locator("ytcp-uploads-dialog").getByRole("radio", { name: PUBLIC_VISIBILITY_TEXT }).first(),
    page.locator("ytcp-uploads-dialog tp-yt-paper-radio-button").filter({ hasText: /^Public$/i }).first(),
    page.locator("ytcp-uploads-dialog").getByText(/^Public$/i).first(),
  ];

  for (const publicRadio of publicLocators) {
    try {
      await publicRadio.scrollIntoViewIfNeeded({ timeout: 2500 });
      await publicRadio.click({ force: true, timeout: 2500 });
      await page.waitForTimeout(750);
      if (await waitForPublishButton(page)) {
        console.log("Selected Public visibility.");
        return;
      }
    } catch {
      // Try the next selector; YouTube changes this markup regularly.
    }
  }

  if (await clickPublicVisibilityByMouse(page)) {
    if ((await publicVisibilityIsSelected(page)) || (await waitForPublishButton(page))) {
      console.log("Selected Public visibility with mouse fallback.");
      return;
    }

    throw new Error("Clicked Public visibility, but the Publish button did not appear.");
  }

  throw new Error("Could not find or click the Public visibility radio button.");
}

async function waitForPublishComplete(page: Page) {
  console.log("Waiting for YouTube publish confirmation...");

  const publishSignals = [
    page.getByText(/Video processing/i).first(),
    page.getByText(/public on YouTube/i).first(),
    page.getByText(/Video published/i).first(),
    page.getByText(/Your video has been published/i).first(),
  ];

  try {
    await Promise.any(publishSignals.map((signal) => signal.waitFor({ state: "visible", timeout: 120000 })));
  } catch {
    throw new Error("YouTube publish confirmation did not appear.");
  }

  console.log("YouTube publish confirmation is visible. Closing confirmation dialog...");

  const closeButtons = [
    page.getByRole("button", { name: /^Close$/i }).last(),
    page.locator('button:has-text("Close")').last(),
    page.locator('ytcp-button:has-text("Close")').last(),
    page.locator("ytcp-uploads-dialog").getByRole("button", { name: /Close/i }).last(),
    page.locator('ytcp-uploads-dialog ytcp-button:has-text("Close")').last(),
    page.locator("ytcp-uploads-dialog #close-button").last(),
  ];

  for (const closeButton of closeButtons) {
    if (await clickIfVisible(closeButton, 3000)) {
      await page.waitForTimeout(1500);
      console.log("Closed YouTube publish confirmation dialog.");
      console.log("Publish flow completed.");
      return;
    }
  }

  throw new Error("Publish confirmation appeared, but the Close button could not be clicked.");
}

async function openYouTubeCreateMenu(page: Page) {
  console.log("Opening YouTube Create menu...");
  await page.goto(YOUTUBE_HOME_URL, { timeout: 60000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);
  await dismissChromeSignInPrompt(page);

  const createButton = await waitForVisible([
    page.locator('button[aria-label*="Create"], button[title*="Create"]').first(),
    page.locator("yt-button-shape button").filter({ hasText: /^Create$/i }).first(),
    page.getByRole("button", { name: /^Create$/i }).first(),
    page.getByText(/^Create$/i).first(),
  ], 30000);

  if (!createButton) throw new Error("Could not find the YouTube Create button.");
  await createButton.click({ timeout: 10000 });
  await page.waitForTimeout(700);
}

async function clickCreateCommunityPost(page: Page) {
  console.log("Choosing Create post...");

  const createPost = await waitForVisible([
    page.getByRole("menuitem", { name: /Create post/i }).first(),
    page.locator("ytd-compact-link-renderer").filter({ hasText: /Create post/i }).first(),
    page.locator('[role="menuitem"]').filter({ hasText: /Create post/i }).first(),
    page.getByText(/^Create post$/i).first(),
  ], 20000);

  if (!createPost) throw new Error("Could not find Create post in the YouTube Create menu. Make sure Community posts are enabled for this channel.");
  await createPost.click({ timeout: 10000 });
  await page.waitForTimeout(1500);

  const composerReady = await waitForVisible([
    page.getByText(/Visibility:\s*Public/i).first(),
    page.getByText(/^Image$/i).first(),
    page.locator('[role="dialog"]').filter({ hasText: /Image poll|Text poll|Quiz|Video/i }).first(),
    page.locator("ytd-backstage-post-dialog-renderer").first(),
  ], 30000);

  if (!composerReady) throw new Error("YouTube Community post composer did not open.");
}

async function getCommunityComposer(page: Page) {
  const composer = await waitForVisible([
    page.locator("ytd-backstage-post-dialog-renderer").filter({ hasText: /Image poll|Text poll|Quiz|Video|Visibility|Post/i }).last(),
    page.locator('[role="dialog"]').filter({ hasText: /Image poll|Text poll|Quiz|Video|Visibility|Post/i }).last(),
    page.locator("tp-yt-paper-dialog").filter({ hasText: /Image poll|Text poll|Quiz|Video|Visibility|Post/i }).last(),
    page.locator("ytd-backstage-post-dialog-renderer").filter({ hasText: /^Image$/i }).last(),
  ], 30000);

  if (!composer) throw new Error("YouTube Community post composer is not visible.");
  return composer;
}

async function waitForCommunityImagePreview(page: Page, timeout = 60000) {
  const composer = await getCommunityComposer(page);

  const previewActions = await waitForVisible([
    composer.getByText(/Edit preview/i).first(),
    composer.getByText(/^Delete$/i).first(),
  ], Math.min(timeout, 15000));

  if (previewActions) {
    console.log("YouTube Community image preview action is visible.");
    return;
  }

  try {
    await page.waitForFunction(() => {
      const roots = Array.from(document.querySelectorAll<HTMLElement>(
        "ytd-backstage-post-dialog-renderer, [role='dialog'], tp-yt-paper-dialog",
      )).filter((root) => {
        const text = root.textContent ?? "";
        const rect = root.getBoundingClientRect();
        const style = window.getComputedStyle(root);
        return /Image poll|Text poll|Quiz|Video|Visibility/i.test(text)
          && rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden";
      });

      return roots.some((root) => Array.from(root.querySelectorAll<HTMLImageElement>("img")).some((image) => {
        const rect = image.getBoundingClientRect();
        const src = image.currentSrc || image.src || "";
        const looksLikePostImage = rect.width >= 90 && rect.height >= 90 && image.naturalWidth >= 40 && image.naturalHeight >= 40;
        const looksLikeAvatar = /avatar|profile|yt3\.ggpht|s32-|s48-|s88-/i.test(src);
        return looksLikePostImage && !looksLikeAvatar;
      }));
    }, undefined, { timeout });
    console.log("YouTube Community image preview is visible.");
    return;
  } catch {
    throw new Error("YouTube Community image preview did not appear after upload.");
  }
}

async function clickCommunityBlankTextSpace(page: Page) {
  const composer = await getCommunityComposer(page);
  const box = await composer.boundingBox();
  if (!box) throw new Error("YouTube Community composer position was not available.");

  console.log("Clicking blank YouTube Community text area...");
  const textX = box.x + Math.min(120, box.width * 0.16);
  const textY = box.y + Math.max(78, Math.min(110, box.height * 0.38));
  await page.mouse.click(textX, textY);
  await page.waitForTimeout(600);
}

async function fillCommunityPostDescription(page: Page, description: string) {
  console.log("Filling YouTube Community post description...");

  await clickCommunityBlankTextSpace(page);
  const composer = await getCommunityComposer(page);
  const editor = await waitForVisible([
    composer.locator('[contenteditable="true"]').first(),
    composer.locator("#contenteditable-root").first(),
    composer.locator("[id*='contenteditable']").first(),
    composer.getByRole("textbox").first(),
    composer.locator("textarea").first(),
  ], 5000);

  if (editor) {
    await fillEditable(page, editor, description);
  } else {
    console.log("Typing description into active Community caret.");
    await page.keyboard.insertText(description);
  }
  await page.waitForTimeout(800);
}

async function clickVisibleCommunityImageControl(page: Page) {
  const target = await page.evaluate(() => {
    const isVisible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden";
    };

    const roots = Array.from(document.querySelectorAll<HTMLElement>(
      "ytd-backstage-post-dialog-renderer, [role='dialog'], tp-yt-paper-dialog",
    )).filter((root) => {
      const text = root.textContent ?? "";
      return /Image|Image poll|Text poll|Quiz|Video|Post|Visibility/i.test(text) && isVisible(root);
    });

    const candidates = roots.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>("*")))
      .filter((element) => element.textContent?.trim() === "Image" && isVisible(element))
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

    const label = candidates[0];
    if (!label) return null;

    const clickable =
      label.closest<HTMLElement>("button, [role='button'], ytd-button-renderer, tp-yt-paper-button, ytd-backstage-image-upload-renderer, ytd-backstage-attachment-upload-renderer")
      ?? label.parentElement
      ?? label;
    const rect = clickable.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();

    return {
      x: rect.width > 10 ? rect.left + rect.width / 2 : labelRect.left + labelRect.width / 2,
      y: rect.height > 10 ? rect.top + rect.height / 2 : labelRect.top + labelRect.height / 2,
    };
  });

  if (!target) return false;

  console.log("Clicking visible YouTube Image control by mouse fallback...");
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(700);
  return true;
}

async function setCommunityImageInputFiles(page: Page, composer: Locator, imagePath: string, previousInputCount: number) {
  const imageInputSelector = 'input[type="file"][accept*="image"], input[type="file"][accept*=".png"], input[type="file"][accept*=".jpg"], input[type="file"][accept*=".jpeg"], input[type="file"]';
  await page.waitForFunction((count) => document.querySelectorAll('input[type="file"]').length > count, previousInputCount, { timeout: 4000 }).catch(() => undefined);

  const composerInputs = composer.locator(imageInputSelector);
  const pageInputs = page.locator(imageInputSelector);
  const composerCount = await composerInputs.count().catch(() => 0);
  const pageCount = await pageInputs.count().catch(() => 0);
  console.log(`YouTube Community file inputs available: composer=${composerCount}, page=${pageCount}`);

  if (composerCount > 0) {
    await composerInputs.last().setInputFiles(imagePath);
    return true;
  }

  if (pageCount > 0) {
    await pageInputs.last().setInputFiles(imagePath);
    return true;
  }

  return false;
}

async function dropCommunityImageOnComposer(page: Page, imagePath: string) {
  console.log("Dropping image file directly onto YouTube Community composer...");
  const payload = {
    base64: fs.readFileSync(imagePath).toString("base64"),
    mime: imageMimeType(imagePath),
    name: path.basename(imagePath),
  };

  const dispatched = await page.evaluate(({ base64, mime, name }) => {
    const binary = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const file = new File([binary], name, { type: mime });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const roots = Array.from(document.querySelectorAll<HTMLElement>(
      "ytd-backstage-post-dialog-renderer, [role='dialog'], tp-yt-paper-dialog",
    )).filter((root) => {
      const rect = root.getBoundingClientRect();
      const style = window.getComputedStyle(root);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });

    const target =
      roots[0]?.querySelector<HTMLElement>('[contenteditable="true"], [role="textbox"], textarea')
      ?? roots[0]
      ?? document.activeElement;

    if (!(target instanceof HTMLElement)) return false;

    for (const eventName of ["dragenter", "dragover", "drop"]) {
      const event = new DragEvent(eventName, {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      target.dispatchEvent(event);
    }

    return true;
  }, payload).catch(() => false);

  if (!dispatched) return false;

  await page.waitForTimeout(3000);
  try {
    await waitForCommunityImagePreview(page, 10000);
    return true;
  } catch {
    return false;
  }
}

async function attachCommunityPostImage(page: Page, imagePath: string) {
  console.log(`Adding image to YouTube Community post: ${imagePath} (${imageMimeType(imagePath)})`);

  const composer = await getCommunityComposer(page);

  const fileInputCountBefore = await page.locator('input[type="file"]').count().catch(() => 0);
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 12000 }).catch(() => null);
  const box = await composer.boundingBox();
  if (!box) throw new Error("YouTube Community composer position was not available.");

  console.log("Opening YouTube Community image uploader, then setting uploaded file path...");
  const imageSlotX = box.x + 74;
  const imageSlotY = box.y + Math.max(96, Math.min(166, box.height - 92));
  await page.mouse.click(imageSlotX, imageSlotY);
  await page.waitForTimeout(700);

  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    console.log("Uploading YouTube Community image through native file chooser handle...");
    await fileChooser.setFiles(imagePath);
  } else {
    if (!await setCommunityImageInputFiles(page, composer, imagePath, fileInputCountBefore)) {
      const retryChooserPromise = page.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null);
      await clickVisibleCommunityImageControl(page);
      const retryChooser = await retryChooserPromise;

      if (retryChooser) {
        console.log("Uploading YouTube Community image through retry file chooser handle...");
        await retryChooser.setFiles(imagePath);
      } else if (!await setCommunityImageInputFiles(page, composer, imagePath, fileInputCountBefore)) {
        if (!await dropCommunityImageOnComposer(page, imagePath)) {
          throw new Error("YouTube Community image could not be attached by file input, file chooser, or drag/drop.");
        }
        return;
      }
    }
  }

  await page.waitForTimeout(2500);
  try {
    await waitForCommunityImagePreview(page, 20000);
  } catch {
    if (!await dropCommunityImageOnComposer(page, imagePath)) {
      throw new Error("YouTube Community image preview did not appear after upload.");
    }
  }
}

async function clickCommunityPostWhenReady(page: Page, requireImagePreview = true) {
  console.log("Clicking YouTube Community Post button...");
  if (requireImagePreview) await waitForCommunityImagePreview(page, 30000);
  const composer = await getCommunityComposer(page);

  await page.waitForFunction(() => {
    const roots = Array.from(document.querySelectorAll<HTMLElement>(
      "ytd-backstage-post-dialog-renderer, [role='dialog'], tp-yt-paper-dialog",
    )).filter((root) => {
      const text = root.textContent ?? "";
      const rect = root.getBoundingClientRect();
      const style = window.getComputedStyle(root);
      return /Image poll|Text poll|Quiz|Video|Visibility|Post/i.test(text)
        && rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden";
    });

    return roots.some((root) => Array.from(root.querySelectorAll<HTMLElement>(
      "button, yt-button-shape button, ytd-button-renderer, tp-yt-paper-button, [role='button']",
    )).some((candidate) => {
        const text = candidate.textContent?.replace(/\s+/g, " ").trim();
        if (text !== "Post") return false;
        const rect = candidate.getBoundingClientRect();
        const style = window.getComputedStyle(candidate);
        const disabledAncestor = candidate.closest("[disabled], [aria-disabled='true']");
        return (
          !candidate.hasAttribute("disabled") &&
          candidate.getAttribute("aria-disabled") !== "true" &&
          !disabledAncestor &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      }));
  }, undefined, { timeout: 60000 });

  const postButtons = [
    composer.getByRole("button", { name: /^Post$/i }).last(),
    composer.locator("button").filter({ hasText: /^Post$/i }).last(),
    composer.locator("yt-button-shape button").filter({ hasText: /^Post$/i }).last(),
    composer.locator("ytd-button-renderer").filter({ hasText: /^Post$/i }).last(),
    composer.getByText(/^Post$/i).last(),
  ];

  for (const postButton of postButtons) {
    if (await clickIfVisible(postButton, 4000)) return;
  }

  const box = await composer.boundingBox();
  if (!box) throw new Error("YouTube Community Post button was ready but could not be clicked.");

  console.log("Clicking black Community Post button by mouse fallback...");
  await page.mouse.click(box.x + box.width - 86, box.y + box.height - 28);
}

async function waitForCommunityPostComplete(page: Page) {
  console.log("Post clicked. Waiting 5 seconds before closing YouTube Community flow...");
  await page.waitForTimeout(5000);

  const closeButtons = [
    page.getByRole("button", { name: /^Close$/i }).last(),
    page.getByRole("button", { name: /Dismiss/i }).last(),
    page.locator('button:has-text("Close")').last(),
    page.locator('yt-button-shape button:has-text("Close")').last(),
  ];

  for (const closeButton of closeButtons) {
    if (await clickIfVisible(closeButton, 1000)) {
      await page.waitForTimeout(500);
      console.log("Closed YouTube Community confirmation.");
      return;
    }
  }

  console.log("YouTube Community post wait completed.");
}

function isGoogleSignInUrl(url: string) {
  return /accounts\.google\.com|signin/i.test(url);
}

async function isYouTubeLoggedIn(page: Page) {
  if (isGoogleSignInUrl(page.url())) return false;

  const loggedInSignals = [
    page.locator('input[type="file"]'),
    page.locator("ytcp-uploads-dialog"),
    page.getByText(/Upload videos/i),
    page.locator("button#avatar-btn"),
    page.locator("ytd-topbar-menu-button-renderer button#avatar-btn"),
    page.locator('a[href*="/feed/you"]'),
    page.locator("ytcp-button#create-icon"),
    page.getByRole("button", { name: /Create/i }),
  ];

  return Boolean(await firstVisible(loggedInSignals));
}

async function googleLoginFormIsVisible(page: Page) {
  return Boolean(await firstVisible([
    page.locator("#identifierId"),
    page.locator('input[type="email"]'),
    page.locator('input[type="password"]'),
  ]));
}

async function isGoogleManualVerificationVisible(page: Page, url: string) {
  if (/challenge|captcha|verification|two.?step|2fa|signin\/v2\/challenge/i.test(url)) return true;

  const signal = await firstVisible([
    page.getByText(/verify it's you/i),
    page.getByText(/2-Step Verification/i),
    page.getByText(/Enter a verification code/i),
    page.getByText(/Check your phone/i),
    page.getByText(/Confirm it's you/i),
    page.locator('iframe[title*="captcha" i]'),
    page.locator('iframe[src*="captcha" i]'),
  ])

  return Boolean(signal);
}

async function getGoogleLoginError(page: Page) {
  if (!isGoogleSignInUrl(page.url())) return null;

  const errorPattern =
    /wrong password|couldn['’]t sign you in|couldn['’]t find your google account|enter a valid email|that password is incorrect|try again later|too many failed attempts|suspicious activity|account has been disabled/i;
  const locators = [
    page.locator('[aria-live="assertive"]'),
    page.locator('[role="alert"]'),
    page.getByText(errorPattern),
  ];

  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);

    for (let index = 0; index < Math.min(count, 8); index += 1) {
      const candidate = locator.nth(index);

      try {
        if (!await candidate.isVisible()) continue;
        const text = (await candidate.textContent())?.replace(/\s+/g, " ").trim();
        if (text && errorPattern.test(text)) return text;
      } catch {
        // Try the next matching element.
      }
    }
  }

  return null;
}

async function waitForYouTubeLoginResult(page: Page, allowManualLoginFromStart = false, ignoreLoginErrors = false) {
  await waitForLoginWithManualFallback({
    page,
    platform: "YouTube",
    normalTimeoutMs: 120000,
    pollMs: 500,
    isLoggedIn: () => isYouTubeLoggedIn(page),
    isManualVerificationVisible: (url) => isGoogleManualVerificationVisible(page, url),
    isLoginFormVisible: () => googleLoginFormIsVisible(page),
    getLoginError: () => getGoogleLoginError(page),
    beforeCheck: () => dismissChromeSignInPrompt(page),
    allowManualLoginFromStart,
    ignoreLoginErrors,
  });
}

export async function loginToYouTube(page: Page, accountLogin?: AccountLogin) {
  const savedSessionOnly = Boolean(accountLogin?.useSavedSessionOnly);
  const manualLoginOnly = !savedSessionOnly;

  console.log("Navigating to YouTube upload page...");
  await page.goto(YOUTUBE_UPLOAD_URL, { timeout: 60000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);
  await dismissChromeSignInPrompt(page);

  if (await isYouTubeLoggedIn(page)) {
    console.log("YouTube session already active.");
  } else if (savedSessionOnly) {
    throw new Error("YouTube saved browser session is not active. Open this account's Login action and complete login before the scheduled publish time.");
  } else {
    console.log("Complete the full YouTube login manually in the visible browser; Companion will save the session after the account opens.");
    await waitForYouTubeLoginResult(page, true, Boolean(accountLogin?.ignoreLoginErrors));
  }

  if (!await isYouTubeLoggedIn(page)) {
    await page.goto(YOUTUBE_UPLOAD_URL, { timeout: 60000 });
    await waitForYouTubeLoginResult(page, true, manualLoginOnly && Boolean(accountLogin?.ignoreLoginErrors));
  }

  await dismissChromeSignInPrompt(page);
  console.log("YouTube ready.");
  return { success: true };
}

async function postCommunityImageToYouTube(page: Page, upload: PlatformUpload, imagePath: string, accountLogin?: AccountLogin) {
  await loginToYouTube(page, accountLogin);
  await openYouTubeCreateMenu(page);
  await clickCreateCommunityPost(page);
  await fillCommunityPostDescription(page, upload.caption);
  await attachCommunityPostImage(page, imagePath);
  await waitForCommunityImagePreview(page, 30000);
  await clickCommunityPostWhenReady(page);
  await waitForCommunityPostComplete(page);
  console.log("Step completed: YouTube Community image post published.");
  return { success: true };
}

async function postCommunityTextToYouTube(page: Page, upload: PlatformUpload, accountLogin?: AccountLogin) {
  await loginToYouTube(page, accountLogin);
  await openYouTubeCreateMenu(page);
  await clickCreateCommunityPost(page);
  await fillCommunityPostDescription(page, upload.caption);
  await clickCommunityPostWhenReady(page, false);
  await waitForCommunityPostComplete(page);
  console.log("Step completed: YouTube Community text post published.");
  return { success: true };
}

async function postVideoToYouTube(page: Page, upload: PlatformUpload, videoPath: string, accountLogin?: AccountLogin) {
  await loginToYouTube(page, accountLogin);

  console.log("Uploading file...");
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(videoPath);

  console.log("Waiting for title field...");
  await page.waitForSelector("#title-textarea", { timeout: 60000 });
  await page.waitForTimeout(2000);

  console.log("Filling metadata...");
  const videoTitle = upload.title || upload.caption;

  await fillEditable(page, page.locator("#title-textarea"), videoTitle);
  await fillEditable(page, page.locator("#description-textarea"), upload.caption);
  await page.waitForTimeout(1000);

  await selectMadeForKids(page);
  await waitForVideoPreview(page);

  console.log("Moving to Video elements...");
  await clickNextWhenReady(page);

  await waitForUploadDialogText(page, /Use cards and an end screen/i, "Video elements");
  await clickNextWhenReady(page);

  await waitForUploadDialogText(page, /check your video for issues/i, "Checks");
  await clickNextWhenReady(page);

  await selectPublicVisibility(page);
  await clickDialogButtonWhenReady(page, ["Publish"], "Publish");
  await waitForPublishComplete(page);

  console.log("Step completed: video published.");
  return { success: true };
}

export async function postToYouTube(page: Page, upload: PlatformUpload, accountLogin?: AccountLogin) {
  const isTextOnly = upload.postFormat === "text" || upload.mimeType === "text/plain" || !upload.fileName;
  if (isTextOnly) return postCommunityTextToYouTube(page, upload, accountLogin);

  const filePath = publishingUploadFilePath(upload.fileName);
  if (!fs.existsSync(filePath)) throw new Error(`YouTube upload file not found: ${filePath}`);

  if (upload.mimeType.startsWith("image/")) {
    return postCommunityImageToYouTube(page, upload, filePath, accountLogin);
  }

  return postVideoToYouTube(page, upload, filePath, accountLogin);
}
