import type { BrowserContext, Page } from "playwright-core";
import type { PublishingEngine } from "../../shared/schema.js";
import type { DesktopBrowserActivity } from "../services/desktop-host.js";

export type PublishingBrowserSession = {
  engine: PublishingEngine;
  context: BrowserContext;
  page: Page;
  desktopSessionId?: string;
  update(activity: DesktopBrowserActivity): Promise<void>;
  close(): Promise<void>;
};

export type RestorePublishingSession = (context: BrowserContext) => Promise<void>;
