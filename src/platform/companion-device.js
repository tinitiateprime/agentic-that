const emptyDevice = { platform: "", architecture: "", desktop: false };

/**
 * Best-effort operating system guess used to pre-select a Companion download.
 * Runs on the server from the request user agent and again in the browser,
 * where `navigator.userAgentData` can also report the CPU architecture.
 */
export function detectCompanionDevice(userAgent, userAgentData = null) {
  const value = String(userAgent || "").toLowerCase();
  const hintedPlatform = String(userAgentData?.platform || "").toLowerCase();
  const hintedArchitecture = String(userAgentData?.architecture || "").toLowerCase();
  const arm = /aarch64|arm64|armv8/.test(value) || hintedArchitecture.includes("arm");

  if (hintedPlatform.includes("windows") || value.includes("windows")) {
    return { platform: "windows", architecture: "x64", desktop: true };
  }
  if (hintedPlatform.includes("macos") || value.includes("macintosh") || value.includes("mac os")) {
    if (/iphone|ipad|ipod/.test(value)) return emptyDevice;
    return { platform: "macos", architecture: "universal", desktop: true };
  }
  if (/android|iphone|ipad|ipod|mobile/.test(value)) return emptyDevice;
  if (hintedPlatform.includes("linux") || value.includes("linux") || value.includes("x11")) {
    return { platform: "linux", architecture: arm ? "arm64" : "x64", desktop: true };
  }
  return emptyDevice;
}

export function readBrowserDevice() {
  if (typeof navigator === "undefined") return emptyDevice;
  const data = navigator.userAgentData;
  return detectCompanionDevice(navigator.userAgent, data ? { platform: data.platform } : null);
}

/** Asks Chromium for the CPU architecture so ARM Linux users are offered ARM packages. */
export async function readBrowserArchitecture() {
  const data = typeof navigator === "undefined" ? null : navigator.userAgentData;
  if (!data?.getHighEntropyValues) return "";
  try {
    const values = await data.getHighEntropyValues(["architecture"]);
    return String(values?.architecture || "").toLowerCase();
  } catch {
    return "";
  }
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const megabytes = bytes / 1024 / 1024;
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(2)} GB`;
  return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} MB`;
}
