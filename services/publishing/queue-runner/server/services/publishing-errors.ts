const APP_NAMES: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  reddit: "Reddit",
};

/**
 * The app itself said no (video too long, media refused). The result is known,
 * so the post is a plain failure: not "uncertain", not a reason to pause the
 * account, and never retried automatically.
 */
export class PlatformRefusedError extends Error {
  readonly platformRefused = true;
}

export function isPlatformRefusal(error: unknown) {
  return (error as { platformRefused?: unknown } | null)?.platformRefused === true;
}

/** The first meaningful line of a technical error, without terminal colour codes. */
function firstLine(message: string) {
  return message.replace(/\u001b\[\d+m/g, "").split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 240) || "";
}

/**
 * A failed post's reason in plain words, keeping the short technical detail at
 * the end so the cause can still be traced. Messages that are already plain
 * (written by the publishers themselves) are kept as they are.
 */
export function explainPublishingError(platform: string, message: string) {
  const app = APP_NAMES[platform] || "The app";
  const detail = firstLine(message);
  const plain = (() => {
    if (/intercepts pointer events/i.test(message)) return `Something on ${app}'s page covered the button the Companion needed to click.`;
    if (/Target page, context or browser has been closed|browser has been closed|Target closed/i.test(message)) return `The ${app} window was closed before posting finished.`;
    if (/net::ERR_|ERR_INTERNET_DISCONNECTED|ENOTFOUND|ECONNRESET|ETIMEDOUT|getaddrinfo/i.test(message)) return `The Companion couldn't reach ${app}. Check this computer's internet connection.`;
    if (/locator\.\w+: Timeout|waiting for locator|Timeout \d+ms exceeded/i.test(message)) return `${app}'s page didn't show what the Companion expected in time (it may have been slow or changed its layout).`;
    return "";
  })();
  if (!plain) return message;
  return detail ? `${plain} Detail: ${detail}` : plain;
}
