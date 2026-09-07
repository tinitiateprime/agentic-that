import type { Platform, PublishingEngine } from "../../shared/schema.js";

export type ManualLoginSurface = "embedded" | "external";
export type ManualLoginRequest = ManualLoginSurface | "engine";

type ManualLoginSurfaceInput = {
  platform: Platform;
  requestedSurface: ManualLoginRequest;
  activeEngine: PublishingEngine;
  credentialConfigured: boolean;
  externalProfilePresent: boolean;
  embeddedBrowserAvailable: boolean;
};

const externalBrowserRequiredPlatforms = new Set<Platform>(["facebook", "x", "youtube"]);

export function platformRequiresExternalBrowser(platform: Platform) {
  return externalBrowserRequiredPlatforms.has(platform);
}

export function publishingEngineForPlatform(
  platform: Platform,
  requestedEngine: PublishingEngine = "companion",
): PublishingEngine {
  return platformRequiresExternalBrowser(platform) || requestedEngine === "external_browser"
    ? "external_browser"
    : "companion";
}

export function selectManualLoginSurface({
  platform,
  requestedSurface,
  activeEngine,
  credentialConfigured,
  externalProfilePresent,
  embeddedBrowserAvailable,
}: ManualLoginSurfaceInput): ManualLoginSurface {
  // Facebook, X, and Google can block, loop, or distrust embedded sign-in surfaces.
  // Never offer an embedded override: the dedicated browser profile is the
  // durable account session used for both login and publishing.
  if (platformRequiresExternalBrowser(platform)) return "external";
  if (requestedSurface === "external") return "external";
  if (requestedSurface === "embedded") return embeddedBrowserAvailable ? "embedded" : "external";
  if (!embeddedBrowserAvailable) return "external";

  // Continue provider-bound and incomplete external sessions in the same
  // isolated profile instead of opening a fresh embedded partition.
  if (activeEngine === "external_browser") return "external";
  if (!credentialConfigured && externalProfilePresent) return "external";

  return "embedded";
}
