// CAPTCHAs and "verify it's you" screens are for the person, never for automation.
// When one appears the account's window is shown to the user, and posting waits
// until they have finished it.

import type { Page } from "playwright-core";
import type { PublishingBrowserSession } from "../../engines/types.js";

const HUMAN_CHECK_URL = /\/(?:checkpoint|challenge)(?:[/?#]|$)|\/signin\/(?:v\d+\/)?challenge|\/two_factor|\/auth_platform\/|\/captcha|\/account\/access/i;
export const HUMAN_CHECK_TEXT = /(?:verify|confirm|prove)[^.?!\n]{0,24}\b(?:human|humanity|not a robot|it(?:'|’)s you)\b|security (?:check|verification)|are you (?:a )?(?:human|robot)|i(?:'|’)m not a robot|(?:enter|type)[^.?!\n]{0,24}\b(?:security|confirmation|verification|login) code|two[- ](?:factor|step) (?:authentication|verification)|\bcaptcha\b/i;
const CHALLENGE_FRAMES = 'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="arkoselabs" i], iframe[src*="funcaptcha" i], iframe[src*="challenges.cloudflare.com" i], iframe[title*="captcha" i]';

const CHECK_EVERY_MS = 3000;
const CLEAR_FOR_MS = 4000;

export function isHumanCheckUrl(url: string) {
  return HUMAN_CHECK_URL.test(url);
}

/** What the page is asking the person to do, or null. Reads the page and never touches it. */
export async function humanCheckOnPage(page: Page) {
  if (page.isClosed()) return null;
  if (isHumanCheckUrl(page.url())) return "verification page";
  return page.evaluate<string | null>(pageCheckScript()).catch(() => null);
}

/** Runs inside the page, so it is plain text that no build step can rewrite. */
function pageCheckScript() {
  return `(() => {
    const onScreen = (element, minWidth, minHeight) => {
      const box = element.getBoundingClientRect();
      return box.width >= minWidth && box.height >= minHeight && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
    };
    // A real challenge is a sizeable box; the small reCAPTCHA badge on normal pages is not.
    const frame = [...document.querySelectorAll(${JSON.stringify(CHALLENGE_FRAMES)})].find((element) => !/size=invisible/i.test(element.src) && onScreen(element, 280, 60));
    if (frame) return "CAPTCHA";
    const text = new RegExp(${JSON.stringify(HUMAN_CHECK_TEXT.source)}, "i");
    const clean = (element) => (element.textContent || "").replace(/\\s+/g, " ").trim();
    const heading = [...document.querySelectorAll('h1, h2, h3, [role="heading"]')].find((element) => {
      const value = clean(element);
      return value.length > 0 && value.length <= 160 && onScreen(element, 1, 1) && text.test(value);
    });
    return heading ? clean(heading) : null;
  })()`;
}

export function humanCheckTimeoutMs() {
  const configured = Number(process.env.HUMAN_CHECK_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 5_000 ? configured : 10 * 60_000;
}

export type HumanCheckOutcome = "none" | "cleared" | "timed_out";

/**
 * Watches one account's page while it posts. settle() is called when a posting
 * step fails: if a verification is the reason, it waits for the person to finish.
 */
export function createHumanCheckGuard({ page, app, session, signal, onNotice }: {
  page: Page;
  app: string;
  session: Pick<PublishingBrowserSession, "update" | "showForHuman" | "hideAfterHuman">;
  signal?: AbortSignal;
  onNotice?: (notice: string | null) => void;
}) {
  let showing = false;
  let settling = false;
  let checking = false;
  let clearSince: number | null = null;

  const show = async (reason: string) => {
    if (showing) return;
    showing = true;
    const notice = `Needs you: complete the ${app} verification in its window. Posting continues after that.`;
    console.log(`${app} is asking for a human verification (${reason.slice(0, 80)}). Waiting for the user.`);
    onNotice?.(notice);
    await session.update({ state: "needs_you", detail: notice }).catch(() => undefined);
    await session.showForHuman?.().catch(() => undefined);
  };
  const hide = async () => {
    if (!showing) return;
    showing = false;
    console.log(`${app} verification is complete.`);
    onNotice?.(null);
    await session.hideAfterHuman?.().catch(() => undefined);
    await session.update({ state: "publishing", detail: `${app} verification is complete. Continuing.` }).catch(() => undefined);
  };

  const timer = setInterval(() => {
    if (settling || checking) return;
    checking = true;
    void humanCheckOnPage(page).then(async (reason) => {
      if (settling) return;
      if (reason) {
        clearSince = null;
        await show(reason);
      } else if (showing) {
        clearSince ??= Date.now();
        if (Date.now() - clearSince >= CLEAR_FOR_MS) await hide();
      }
    }).finally(() => { checking = false; });
  }, CHECK_EVERY_MS);
  timer.unref?.();

  return {
    async settle(timeoutMs = humanCheckTimeoutMs()): Promise<HumanCheckOutcome> {
      settling = true;
      try {
        const reason = await humanCheckOnPage(page);
        if (!reason && !showing) return "none";
        await show(reason || "verification");
        const deadline = Date.now() + timeoutMs;
        let clearAt: number | null = null;
        while (Date.now() < deadline && !signal?.aborted && !page.isClosed()) {
          if (await humanCheckOnPage(page)) clearAt = null;
          else {
            clearAt ??= Date.now();
            if (Date.now() - clearAt >= CLEAR_FOR_MS) {
              await hide();
              return "cleared";
            }
          }
          await page.waitForTimeout(1000).catch(() => undefined);
        }
        await hide();
        return "timed_out";
      } finally {
        settling = false;
      }
    },
    stop() {
      clearInterval(timer);
      onNotice?.(null);
    },
  };
}
