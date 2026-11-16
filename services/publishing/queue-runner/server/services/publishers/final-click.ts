import type { Locator, Page } from "playwright-core";

const BLOCKED_CLICK = /intercepts pointer events|Timeout \d+ms exceeded|element is not stable|outside of the viewport/i;

/**
 * Suggestion lists (#hashtags, @mentions, people) open over the composer and
 * their invisible backdrop catches clicks meant for the Post button. Escape
 * closes only the list, so it is pressed only while one is showing.
 */
export async function closeSuggestionLists(page: Page) {
  const lists = page.locator('[role="listbox"], [data-testid="typeaheadDropdown"]');
  const count = await lists.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    if (await lists.nth(index).isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(350);
      return true;
    }
  }
  return false;
}

/**
 * The final Post / Share / Publish click. A normal click first; if something
 * on the page covers the button, close suggestion lists and click again; and
 * only then click the button directly (which a covering layer can't catch).
 * A covered click never lands, so the post is submitted once.
 */
export async function clickFinalAction(page: Page, button: Locator, label: string) {
  try {
    await button.click({ timeout: 4000 });
    return "click" as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!BLOCKED_CLICK.test(message)) throw error;
    console.log(`Something covered the ${label} button; clearing it and trying again.`);
  }
  await closeSuggestionLists(page);
  await button.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  try {
    await button.click({ timeout: 3000 });
    return "click" as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!BLOCKED_CLICK.test(message)) throw error;
  }
  console.log(`Clicking the ${label} button directly.`);
  await button.evaluate((element) => (element as HTMLElement).click());
  return "direct" as const;
}
