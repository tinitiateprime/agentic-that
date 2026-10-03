export type FacebookCompanionBrowserSession = {
  id: string;
  debugEndpoint: string;
  targetUrl: string;
  sessionMode: "anonymous" | "connected";
};

export type FacebookCompanionDesktopHost = {
  openBrowser(request: {
    jobId: string;
    ownerKey?: string;
    preferConnectedSession?: boolean;
  }): Promise<FacebookCompanionBrowserSession>;
  closeBrowser(sessionId: string): Promise<void> | void;
  stopBrowsers(reason: string): Promise<void> | void;
};

declare global {
  var __AGENTICTHAT_FACEBOOK_COMPANION_DESKTOP_HOST__: FacebookCompanionDesktopHost | undefined;
}

export function facebookCompanionDesktopHost() {
  return globalThis.__AGENTICTHAT_FACEBOOK_COMPANION_DESKTOP_HOST__ ?? null;
}
