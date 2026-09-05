import type { Locator, Page } from "playwright-core";
import type { YouTubeOptions } from "../../../shared/schema.js";

export function youtubeFinalAction(visibility: YouTubeOptions["visibility"]) {
  return visibility === "public" ? "Publish" : "Save";
}

async function checked(radio: Locator) {
  return radio.evaluate((element: HTMLElement) => {
    const aria = element.getAttribute("aria-checked");
    if (aria !== null) return aria === "true";
    return element instanceof HTMLInputElement ? element.checked : element.hasAttribute("checked");
  }).catch(() => false);
}

export async function selectYouTubeOption(page: Page, kind: "audience" | "visibility", options: YouTubeOptions) {
  const audience = options.audience === "made_for_kids";
  const name = kind === "audience"
    ? audience ? "VIDEO_MADE_FOR_KIDS_MFK" : "VIDEO_MADE_FOR_KIDS_NOT_MFK"
    : options.visibility.toUpperCase();
  const label = kind === "audience"
    ? audience ? /^Yes.*made for kids/i : /^No.*not made for kids/i
    : new RegExp(`^${options.visibility}(?:\\s|$)`, "i");
  const dialog = page.locator("ytcp-uploads-dialog");
  const choices = [
    dialog.locator(`tp-yt-paper-radio-button[name="${name}"], input[type="radio"][name="${name}"], [role="radio"][name="${name}"]`),
    dialog.getByRole("radio", { name: label }),
    dialog.locator("tp-yt-paper-radio-button").filter({ hasText: label }),
  ];
  for (const locator of choices) {
    const radio = locator.first();
    try {
      await radio.waitFor({ state: "visible", timeout: 3000 });
      await radio.scrollIntoViewIfNeeded({ timeout: 3000 });
      if (!await checked(radio)) await radio.click({ timeout: 5000 });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (await checked(radio)) return;
        await page.waitForTimeout(200);
      }
    } catch { /* Try the next supported Studio radio control. */ }
  }
  throw new Error(`YouTube did not confirm the selected ${kind}: ${options[kind]}. No final action was taken.`);
}
