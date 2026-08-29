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

  // X and Google reject or stall embedded sign-in often enough that the
  // normal Login action must begin in a real Chrome/Edge profile. Companion
  // verifies the resulting session and transfers it into its protected
  // partition when the provider permits. Provider-bound sessions stay in the
  // isolated managed Chrome profile and use that same profile for publishing.
  if (externalLoginFirstPlatforms.has(platform)) return "external";

  // Once a provider has bound the account to managed Chrome, reconnect in the
  // same profile instead of accidentally opening an empty embedded partition.
  if (activeEngine === "external_browser") return "external";

  // Preserve an incomplete external login across a normal retry. This avoids
  // sending a user back to the embedded surface after a verification step.
  if (!credentialConfigured && externalProfilePresent) return "external";

  return "embedded";
}
