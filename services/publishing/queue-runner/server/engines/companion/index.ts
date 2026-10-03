import { chromium } from "playwright-core";
import type { PublishingAccount } from "../../local-storage.js";
import type {
  DesktopBrowserPurpose,
  PublishingDesktopHost,
} from "../../services/desktop-host.js";
import type { PublishingBrowserSession, RestorePublishingSession } from "../types.js";

type CompanionEngineOptions = {
  account: PublishingAccount;
  purpose: DesktopBrowserPurpose;
  desktopHost: PublishingDesktopHost;
  restoreSessionState: RestorePublishingSession;
  releaseAccount: () => void;
};

async function waitForDesktopPage(
  browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>,
  targetUrl: string,
) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap(context => context.pages());
    const page = pages.find(candidate => candidate.url() === targetUrl);
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The Companion live browser view did not become available.");
}

export async function launchCompanionEngineBrowser({
  account,
  purpose,
  desktopHost,
  restoreSessionState,
  releaseAccount,
}: CompanionEngineOptions): Promise<PublishingBrowserSession> {
  let managed: Awaited<ReturnType<typeof desktopHost.openBrowser>>;
  try {
    managed = await desktopHost.openBrowser({
      accountId: account.id,
      platform: account.platform,
      displayName: account.displayName,
      handle: account.handle,
      purpose,
      engine: "companion",
    });
  } catch (error) {
    releaseAccount();
    throw error;
  }

  let connection: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await Promise.resolve(desktopHost.closeBrowser(managed.id)).catch(() => undefined);
      await Promise.race([
        connection?.close().catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, 1000)),
      ]);
    } finally {
      releaseAccount();
    }
  };

  try {
    connection = await chromium.connectOverCDP(managed.debugEndpoint);
    const page = await waitForDesktopPage(connection, managed.targetUrl);
    const context = page.context();
    await restoreSessionState(context);
    return {
      engine: "companion",
      context,
      page,
      desktopSessionId: managed.id,
      update: activity => Promise.resolve(desktopHost.updateBrowser(managed.id, activity)),
      close,
    };
  } catch (error) {
    await Promise.resolve(desktopHost.updateBrowser(managed.id, {
      state: "failed",
      detail: "The Companion browser could not start. Restart Companion and try again.",
    })).catch(() => undefined);
    await close();
    throw error;
  }
}
