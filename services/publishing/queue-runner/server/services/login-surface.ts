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

const externalLoginFirstPlatforms = new Set<Platform>(["x", "youtube"]);

export function selectManualLoginSurface({
  platform,
  requestedSurface,
  activeEngine,
  credentialConfigured,
  externalProfilePresent,
  embeddedBrowserAvailable,
}: ManualLoginSurfaceInput): ManualLoginSurface {
  if (requestedSurface === "external") return "external";
  if (requestedSurface === "embedded") return embeddedBrowserAvailable ? "embedded" : "external";
  if (!embeddedBrowserAvailable) return "external";

  // Google and X reject embedded sign-in frequently. Start their normal login
  // flow in a dedicated Chrome/Edge profile owned and verified by Companion.
  if (externalLoginFirstPlatforms.has(platform)) return "external";

  // Continue provider-bound and incomplete external sessions in the same
  // isolated profile instead of opening a fresh embedded partition.
  if (activeEngine === "external_browser") return "external";
  if (!credentialConfigured && externalProfilePresent) return "external";

  return "embedded";
}
