import type { Platform } from "../../shared/schema.js";

export type DesktopBrowserPurpose = "login" | "publish";

export type DesktopBrowserRequest = {
  accountId: string;
  platform: Platform;
  displayName: string;
  handle: string;
  purpose: DesktopBrowserPurpose;
};

export type DesktopBrowserSession = {
  id: string;
  debugEndpoint: string;
  targetUrl: string;
};

export type DesktopBrowserActivity = {
  state: "opening" | "waiting" | "publishing" | "posted" | "failed" | "stopped";
  detail?: string;
  currentItem?: string;
  currentIndex?: number;
  totalItems?: number;
};

export type PublishingDesktopHost = {
  openBrowser(request: DesktopBrowserRequest): Promise<DesktopBrowserSession>;
  updateBrowser(sessionId: string, activity: DesktopBrowserActivity): Promise<void> | void;
  closeBrowser(sessionId: string): Promise<void> | void;
  stopPublishingBrowsers(reason: string): Promise<void> | void;
};

declare global {
  // The Electron main process installs this adapter before importing the bundled
  // publishing server. CLI and test runtimes intentionally leave it undefined.
  var __AGENTICTHAT_PUBLISHING_DESKTOP_HOST__: PublishingDesktopHost | undefined;
}

export function publishingDesktopHost() {
  return globalThis.__AGENTICTHAT_PUBLISHING_DESKTOP_HOST__ ?? null;
}
