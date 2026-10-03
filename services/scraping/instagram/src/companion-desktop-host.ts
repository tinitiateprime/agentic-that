export type InstagramCompanionBrowserRequest = {
  jobId: string;
};

export type InstagramCompanionBrowserSession = {
  id: string;
  debugEndpoint: string;
  targetUrl: string;
};

export type InstagramCompanionDesktopHost = {
  openBrowser(request: InstagramCompanionBrowserRequest): Promise<InstagramCompanionBrowserSession>;
  closeBrowser(sessionId: string): Promise<void> | void;
  stopBrowsers(reason: string): Promise<void> | void;
};

declare global {
  // Electron installs this adapter before importing the bundled local API.
  // Server and test runtimes intentionally leave it undefined.
  var __AGENTICTHAT_INSTAGRAM_COMPANION_DESKTOP_HOST__: InstagramCompanionDesktopHost | undefined;
}

export function instagramCompanionDesktopHost() {
  return globalThis.__AGENTICTHAT_INSTAGRAM_COMPANION_DESKTOP_HOST__ ?? null;
}
