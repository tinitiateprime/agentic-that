import type { Locator } from "playwright-core";

// Opening a composer must use a browser input event when possible. Some
// providers ignore HTMLElement.click(); compact views can also leave their
// exact composer control outside the viewport even after scrolling.
export async function activateComposerControl(control: Locator) {
  await control.scrollIntoViewIfNeeded().catch(() => undefined);
  try {
    await control.click({ timeout: 5000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/outside of the viewport/i.test(message)) throw error;
    await control.evaluate((element) => {
      const target = element.closest<HTMLElement>('[role="menuitem"], [role="link"], [role="button"], a, button')
        ?? element as HTMLElement;
      target.focus();
      target.click();
    });
  }
}
