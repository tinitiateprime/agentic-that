import { chromium, type Browser } from "playwright-core";
import { instagramCompanionDesktopHost } from "./companion-desktop-host.js";
import {
  runInstagramScrapeWithSessionFactory,
  type InstagramBrowserSession,
  type InstagramBrowserSessionFactory,
  type InstagramScrapeInput,
} from "./scraper.js";

export class InstagramCompanionCancelledError extends Error {
  constructor(message = "Instagram scraping was cancelled.") {
    super(message);
    this.name = "InstagramCompanionCancelledError";
  }
}

async function waitForDesktopPage(browser: Browser, targetUrl: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = browser.contexts()
      .flatMap(context => context.pages())
      .find(candidate => candidate.url() === targetUrl);
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The hidden Companion scraping browser did not become available.");
}

class CompanionSessionFactory implements InstagramBrowserSessionFactory {
  private readonly active = new Set<InstagramBrowserSession>();

  constructor(
    private readonly jobId: string,
    private readonly signal: AbortSignal,
    private readonly onBrowserReady?: () => void,
  ) {}

  private browserReadyReported = false;

  async create(): Promise<InstagramBrowserSession> {
    if (this.signal.aborted) throw new InstagramCompanionCancelledError();
    const desktopHost = instagramCompanionDesktopHost();
    if (!desktopHost) {
      throw new Error("Local Companion scraping is unavailable. Open or restart AgenticThat Publishing Companion.");
    }

    const managed = await desktopHost.openBrowser({ jobId: this.jobId });
    let connection: Browser | null = null;
    let session: InstagramBrowserSession | null = null;
    let closed = false;

    const close = async () => {
      if (closed) return;
      closed = true;
      this.signal.removeEventListener("abort", onAbort);
      if (session) this.active.delete(session);
      await Promise.resolve(desktopHost.closeBrowser(managed.id)).catch(() => undefined);
      await Promise.race([
        connection?.close().catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, 1_000)),
      ]);
    };
    const onAbort = () => { void close(); };

    try {
      connection = await chromium.connectOverCDP(managed.debugEndpoint);
      const page = await waitForDesktopPage(connection, managed.targetUrl);
      const context = page.context();
      await context.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      });
      await page.setViewportSize({ width: 1280, height: 900 }).catch(() => undefined);
      const userAgent = await page.evaluate(() => navigator.userAgent);
      session = { context, page, userAgent, close };
      this.active.add(session);
      if (!this.browserReadyReported) {
        this.browserReadyReported = true;
        this.onBrowserReady?.();
      }
      this.signal.addEventListener("abort", onAbort, { once: true });
      if (this.signal.aborted) {
        await close();
        throw new InstagramCompanionCancelledError();
      }
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

export async function runInstagramCompanionScrape(
  jobId: string,
  input: InstagramScrapeInput,
  signal: AbortSignal,
  onBrowserReady?: () => void,
) {
  const factory = new CompanionSessionFactory(jobId, signal, onBrowserReady);
  try {
    return await runInstagramScrapeWithSessionFactory(input, factory);
  } catch (error) {
    if (signal.aborted) throw new InstagramCompanionCancelledError();
    throw error;
  } finally {
    await factory.closeAll();
  }
}
