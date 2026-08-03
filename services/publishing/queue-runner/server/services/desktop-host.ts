import type { Platform, PublishingEngine } from "../../shared/schema.js";

export type DesktopBrowserPurpose = "login" | "publish";

export type DesktopBrowserRequest = {
  accountId: string;
  platform: Platform;
  displayName: string;
  handle: string;
  purpose: DesktopBrowserPurpose;
  engine: PublishingEngine;
};

export type DesktopBrowserSession = {
  id: string;
  debugEndpoint: string;
  targetUrl: string;
};

export type DesktopWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopExternalActivitySession = {
  id: string;
  workspaceBounds: DesktopWindowBounds;
};

export type DesktopExternalBrowserLayout = {
  index: number;
  total: number;
  row: number;
  column: number;
  rows: number;
  columns: number;
  centered: boolean;
  bounds: DesktopWindowBounds;
};

export type DesktopBrowserActivity = {
  state?: "opening" | "waiting" | "publishing" | "posted" | "failed" | "stopped";
  detail?: string;
  currentItem?: string;
  currentIndex?: number;
  totalItems?: number;
  externalLayout?: DesktopExternalBrowserLayout;
};

export type PublishingDesktopHost = {
  requestPersistentPublishingPermission(): Promise<void>;
  requestPublishingPermission(): Promise<void>;
  finishPublishingRun(): Promise<void> | void;
  openBrowser(request: DesktopBrowserRequest): Promise<DesktopBrowserSession>;
  openExternalActivity(request: DesktopBrowserRequest): Promise<DesktopExternalActivitySession>;
  updateBrowser(sessionId: string, activity: DesktopBrowserActivity): Promise<void> | void;
  closeBrowser(sessionId: string): Promise<void> | void;
  stopPublishingBrowsers(reason: string): Promise<void> | void;
  clearAccountBrowserData(accountId: string): Promise<void> | void;
};

declare global {
  // The Electron main process installs this adapter before importing the bundled
  // publishing server. CLI and test runtimes intentionally leave it undefined.
  var __AGENTICTHAT_PUBLISHING_DESKTOP_HOST__: PublishingDesktopHost | undefined;
}

export function publishingDesktopHost() {
  return globalThis.__AGENTICTHAT_PUBLISHING_DESKTOP_HOST__ ?? null;
}
