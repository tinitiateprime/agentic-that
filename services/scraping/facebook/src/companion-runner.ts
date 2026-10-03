import { chromium, type Browser } from "playwright-core";
import { facebookCompanionDesktopHost } from "./companion-desktop-host.js";
import {
  facebookNavigationHeaders,
  runFacebookScrape,
  runFacebookScrapeWithSessionFactory,
  type FacebookBrowserSession,
  type FacebookBrowserSessionFactory,
  type FacebookScrapeInput,
} from "./scraper.js";

export class FacebookCompanionCancelledError extends Error {
  constructor(message = "Facebook scraping was cancelled.") {
    super(message);
    this.name = "FacebookCompanionCancelledError";
  }
}

export function facebookResultNeedsBrowserFallback(result: Awaited<ReturnType<typeof runFacebookScrape>>) {
  return result.results.length === 0
    && (!result.analysis || Math.max(result.analysis.top_viewed.length, result.analysis.top_reacted.length, result.analysis.top_discussed.length) === 0)
    && ["login_required", "temporarily_unavailable", "partial"].includes(result.discoveryStatus);
}

async function waitForPage(browser: Browser, targetUrl: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url() === targetUrl);
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The hidden Companion Facebook browser did not become available.");
}

class CompanionFactory implements FacebookBrowserSessionFactory {
  private readonly active = new Set<FacebookBrowserSession>();
  private readyReported = false;

  constructor(
    private readonly jobId: string,
    private readonly signal: AbortSignal,
    private readonly onBrowserReady?: () => void,
    private readonly ownerKey?: string,
  ) {}

  async create(): Promise<FacebookBrowserSession> {
    if (this.signal.aborted) throw new FacebookCompanionCancelledError();
    const host = facebookCompanionDesktopHost();
    if (!host) throw new Error("Local Companion Facebook scraping is unavailable. Open or restart AgenticThat Publishing Companion.");
    const managed = await host.openBrowser({
      jobId: this.jobId,
      ownerKey: this.ownerKey,
      // Scraping never reuses a publishing/login session. Both Companion attempts
      // are temporary anonymous public-browser sessions.
      preferConnectedSession: false,
    });
    let connection: Browser | null = null;
    let session: FacebookBrowserSession | null = null;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      this.signal.removeEventListener("abort", onAbort);
      if (session) this.active.delete(session);
      await Promise.resolve(host.closeBrowser(managed.id)).catch(() => undefined);
      await Promise.race([connection?.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 1_000))]);
    };
    const onAbort = () => { void close(); };
    try {
      connection = await chromium.connectOverCDP(managed.debugEndpoint);
      const page = await waitForPage(connection, managed.targetUrl);
      const context = page.context();
      await context.setExtraHTTPHeaders(facebookNavigationHeaders());
      await page.setViewportSize({ width: 1280, height: 900 }).catch(() => undefined);
      session = {
        context,
        page,
        userAgent: await page.evaluate(() => navigator.userAgent),
        sessionMode: managed.sessionMode,
        close,
      };
      this.active.add(session);
      if (!this.readyReported) { this.readyReported = true; this.onBrowserReady?.(); }
      this.signal.addEventListener("abort", onAbort, { once: true });
      if (this.signal.aborted) { await close(); throw new FacebookCompanionCancelledError(); }
      return session;
    } catch (error) {
      await close();
      throw error;
    }
  }

  async closeAll() {
    await Promise.all([...this.active].map(session => session.close()));
  }
}

export async function runFacebookCompanionScrape(
  jobId: string,
  input: FacebookScrapeInput,
  signal: AbortSignal,
  onBrowserReady?: () => void,
  ownerKey?: string,
) {
  let primaryResult: Awaited<ReturnType<typeof runFacebookScrape>> | null = null;
  let primaryError: unknown;
  try {
    // Facebook currently withholds the hydrated feed from Electron's embedded
    // browser, while the same local request completes normally in installed
    // Chrome/Edge. Use that local browser first; it remains headless, isolated,
    // and on this computer. The embedded session remains a fallback for machines
    // where a supported local browser cannot be launched.
    primaryResult = await runFacebookScrape(input, { signal, onBrowserReady });
    if (!facebookResultNeedsBrowserFallback(primaryResult)) return primaryResult;
  } catch (error) {
    if (signal.aborted) throw new FacebookCompanionCancelledError();
    primaryError = error;
  }
  const factory = new CompanionFactory(jobId, signal, onBrowserReady, ownerKey);
  try {
    const fallbackResult = await runFacebookScrapeWithSessionFactory(input, factory);
    return facebookResultNeedsBrowserFallback(fallbackResult) && primaryResult ? primaryResult : fallbackResult;
  } catch (fallbackError) {
    if (signal.aborted) throw new FacebookCompanionCancelledError();
    throw fallbackError instanceof Error ? fallbackError : primaryError;
  } finally {
    await factory.closeAll();
  }
}
