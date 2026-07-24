import {
  extensionMediaProxyUrl,
  publishingExtensionFetch,
  publishingExtensionIsActive,
} from "./publishing-extension-bridge.ts";

const configuredPublishingOrigin = process.env.NEXT_PUBLIC_PUBLISH_QUEUE_API_URL?.trim().replace(/\/$/, "") ?? "";
const localPublishingOrigin = "http://127.0.0.1:8792";

let activePublishingOrigin = configuredPublishingOrigin;
let lastCompanionCheckAt = 0;
let companionCheck: Promise<string> | null = null;

type LocalRequestInit = RequestInit & {
  targetAddressSpace?: "loopback";
};

function localRequestInit(init: RequestInit = {}): LocalRequestInit {
  return {
    ...init,
    mode: "cors",
    targetAddressSpace: "loopback",
  };
}

async function detectLocalPublishingCompanion() {
  if (typeof window === "undefined") return "";

  const now = Date.now();
  const cacheLifetime = activePublishingOrigin === localPublishingOrigin ? 30_000 : 3_000;
  if (now - lastCompanionCheckAt < cacheLifetime) return activePublishingOrigin;
  if (companionCheck) return companionCheck;

  companionCheck = (async () => {
    const controller = new AbortController();
    // Chrome 142+ may wait while the user grants Local Network Access / Apps on device.
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(
        `${localPublishingOrigin}/api/health`,
        localRequestInit({ cache: "no-store", signal: controller.signal }),
      );
      if (!response.ok) return "";
      const health = await response.json() as { automationReady?: boolean };
      return health.automationReady ? localPublishingOrigin : "";
    } catch {
      return "";
    } finally {
      window.clearTimeout(timeout);
    }
  })();

  try {
    activePublishingOrigin = await companionCheck;
    lastCompanionCheckAt = Date.now();
    return activePublishingOrigin;
  } finally {
    companionCheck = null;
  }
}

export async function resolvePublishingOrigin() {
  if (configuredPublishingOrigin) {
    activePublishingOrigin = configuredPublishingOrigin;
    return configuredPublishingOrigin;
  }
  return detectLocalPublishingCompanion();
}

export async function publishingFetch(path: string, init: RequestInit = {}) {
  if (!configuredPublishingOrigin && typeof window !== "undefined" && !(init.body instanceof FormData)) {
    const extensionResponse = await publishingExtensionFetch(path, init);
    if (extensionResponse && extensionResponse.headers.get("X-AgenticThat-Bridge-Error") !== "1") {
      return extensionResponse;
    }
  }

  const origin = await resolvePublishingOrigin();
  if (!origin && typeof window !== "undefined") {
    throw new Error(
      "The publishing companion could not be reached. Install the AgenticThat Chrome extension, start Start Publishing Companion.cmd, and try again."
    );
  }
  const normalizedPath = path.startsWith("/api/") ? path : `/api/${path.replace(/^\//, "")}`;
  const requestUrl = origin
    ? `${origin}${normalizedPath}`
    : `/api/publishing${normalizedPath.slice("/api".length)}`;

  return fetch(
    requestUrl,
    origin === localPublishingOrigin ? localRequestInit(init) : init,
  );
}

export function publishingAssetUrl(url: string, options: { compact?: boolean; controls?: boolean } = {}) {
  if (url.startsWith("http") || url.startsWith("data:")) return url;
  const extensionUrl = extensionMediaProxyUrl(url, options);
  if (extensionUrl) return extensionUrl;
  if (activePublishingOrigin) return `${activePublishingOrigin}${url}`;
  return url.startsWith("/uploads/") ? `/publishing${url}` : url;
}

export function isLocalPublishingCompanionActive() {
  return activePublishingOrigin === localPublishingOrigin;
}

export function isPublishingExtensionActive() {
  return publishingExtensionIsActive();
}
