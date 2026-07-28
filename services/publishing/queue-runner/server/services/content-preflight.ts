import type { Platform, PlatformUpload, PostFormat } from "../../shared/schema.js";

export type ContentPreflightSeverity = "block" | "warning";

export type ContentPreflightIssue = {
  code: string;
  severity: ContentPreflightSeverity;
  message: string;
  accountId?: string;
};

export type ContentPreflightDestination = {
  accountId: string;
  platform: Platform;
  description: string;
  scheduledAt?: string;
  scheduleId?: number;
};

export type ContentPreflightInput = {
  postFormat: PostFormat;
  title?: string;
  description: string;
  originalName: string;
  size: number;
  rightsConfirmed: boolean;
  destinations?: ContentPreflightDestination[];
};

const shortLinkHosts = new Set([
  "bit.ly",
  "buff.ly",
  "cutt.ly",
  "goo.gl",
  "is.gd",
  "ow.ly",
  "rebrand.ly",
  "t.co",
  "tiny.cc",
  "tinyurl.com",
]);

const privateIpv4Patterns = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
];

function normalizedText(value: string | undefined) {
  return (value ?? "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function normalizedFileName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").trim();
}

function normalizedScheduledAt(value: string | undefined) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value.trim();
}

function sameTiming(destination: ContentPreflightDestination, upload: PlatformUpload) {
  return normalizedScheduledAt(destination.scheduledAt) === normalizedScheduledAt(upload.scheduledAt)
    && (destination.scheduleId ?? null) === (upload.scheduleId ?? null);
}

function sameContent(input: ContentPreflightInput, destination: ContentPreflightDestination, upload: PlatformUpload) {
  if ((upload.postFormat ?? "image") !== input.postFormat) return false;
  if (normalizedText(upload.caption) !== normalizedText(destination.description)) return false;
  if (input.postFormat !== "text"
    && (normalizedFileName(upload.originalName) !== normalizedFileName(input.originalName) || upload.size !== input.size)) {
    return false;
  }
  if (destination.platform === "youtube" && input.postFormat === "video") {
    return normalizedText(upload.title) === normalizedText(input.title);
  }
  return true;
}

function extractUrls(text: string) {
  const matches = text.match(/(?:https?:\/\/|www\.)[^\s<>"'`]+/gi) ?? [];
  return matches.map(match => match.replace(/[),.;!?\]}]+$/g, ""));
}

function uniqueIssues(issues: ContentPreflightIssue[]) {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.code}:${issue.accountId ?? ""}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inspectLinks(text: string) {
  const issues: ContentPreflightIssue[] = [];
  const urls = extractUrls(text);
  const counts = new Map<string, number>();

  for (const rawUrl of urls) {
    let url: URL;
    try {
      url = new URL(rawUrl.toLowerCase().startsWith("www.") ? `https://${rawUrl}` : rawUrl);
    } catch {
      issues.push({ code: "invalid_link", severity: "block", message: `Fix the invalid link: ${rawUrl}` });
      continue;
    }

    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const normalizedUrl = url.toString();
    counts.set(normalizedUrl, (counts.get(normalizedUrl) ?? 0) + 1);

    const isPrivateIpv4 = privateIpv4Patterns.some(pattern => pattern.test(host));
    const isPrivateIpv6 = host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isPrivateIpv4 || isPrivateIpv6) {
      issues.push({ code: "private_link", severity: "block", message: "Remove local or private-network links before publishing." });
    }
    if (url.username || url.password) {
      issues.push({ code: "credential_link", severity: "block", message: "Remove links that contain a username or password." });
    }
    if (url.protocol === "http:") {
      issues.push({ code: "insecure_link", severity: "warning", message: `This link is not encrypted: ${host}` });
    }
    if (host.includes("xn--")) {
      issues.push({ code: "punycode_link", severity: "warning", message: `Review the internationalized link domain carefully: ${host}` });
    }
    if (shortLinkHosts.has(host)) {
      issues.push({ code: "shortened_link", severity: "warning", message: `Review the destination behind the shortened link: ${host}` });
    }
  }

  if ([...counts.values()].some(count => count > 2)) {
    issues.push({ code: "repeated_link", severity: "warning", message: "The same link appears more than twice; remove accidental repetition." });
  }
  return issues;
}

function inspectSpamSignals(text: string) {
  const issues: ContentPreflightIssue[] = [];
  const hashtagCount = text.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  const mentionCount = text.match(/(^|\s)@[\p{L}\p{N}_.-]+/gu)?.length ?? 0;
  const letters = text.match(/\p{L}/gu) ?? [];
  const uppercaseLetters = text.match(/\p{Lu}/gu) ?? [];
  const pressurePhrases = [
    /\bguaranteed (?:profit|returns?|income)\b/i,
    /\bact now\b/i,
    /\blimited time only\b/i,
    /\b(?:risk[- ]free|no risk) (?:profit|returns?|income)\b/i,
    /\bclick here now\b/i,
  ];

  if (hashtagCount > 20) {
    issues.push({ code: "excessive_hashtags", severity: "warning", message: `${hashtagCount} hashtags may look repetitive or spam-like.` });
  }
  if (mentionCount > 10) {
    issues.push({ code: "excessive_mentions", severity: "warning", message: `${mentionCount} mentions may look like unsolicited tagging.` });
  }
  if (letters.length >= 30 && uppercaseLetters.length / letters.length > 0.7) {
    issues.push({ code: "excessive_capitals", severity: "warning", message: "Most of the text is capitalized; review it before publishing." });
  }
  if (pressurePhrases.filter(pattern => pattern.test(text)).length >= 2) {
    issues.push({ code: "spam_language", severity: "warning", message: "The text contains several high-pressure or guaranteed-outcome phrases." });
  }

  const repeatedLines = new Map<string, number>();
  text.split(/\r?\n/).map(normalizedText).filter(line => line.length >= 8).forEach(line => {
    repeatedLines.set(line, (repeatedLines.get(line) ?? 0) + 1);
  });
  if ([...repeatedLines.values()].some(count => count >= 3)) {
    issues.push({ code: "repeated_text", severity: "warning", message: "The same line appears three or more times." });
  }
  return issues;
}

export function evaluateContentPreflight(
  input: ContentPreflightInput,
  existingUploads: PlatformUpload[] = [],
  now = Date.now(),
) {
  const issues: ContentPreflightIssue[] = [];
  if (input.postFormat !== "text" && !input.rightsConfirmed) {
    issues.push({
      code: "media_rights_required",
      severity: "block",
      message: "Confirm that you own this media or have permission to publish it.",
    });
  }

  const contentVariants = new Set([
    input.description,
    ...(input.destinations?.map(destination => destination.description) ?? []),
  ]);
  for (const text of contentVariants) {
    issues.push(...inspectLinks(text), ...inspectSpamSignals(text));
  }

  const destinations = input.destinations ?? [];
  const destinationsByPlatformAndText = new Map<string, number>();
  for (const destination of destinations) {
    const key = `${destination.platform}:${normalizedText(destination.description)}`;
    destinationsByPlatformAndText.set(key, (destinationsByPlatformAndText.get(key) ?? 0) + 1);
  }
  if ([...destinationsByPlatformAndText.values()].some(count => count > 1)) {
    issues.push({
      code: "same_platform_broadcast",
      severity: "warning",
      message: "The same content is going to multiple accounts on one app. Confirm that this is intentional.",
    });
  }

  const oneDayAgo = now - 24 * 60 * 60_000;
  for (const destination of destinations) {
    for (const upload of existingUploads) {
      if (upload.accountId !== destination.accountId || !sameContent(input, destination, upload)) continue;
      if ((upload.status === "queued" || upload.status === "processing") && sameTiming(destination, upload)) {
        issues.push({
          code: "exact_queued_duplicate",
          severity: "block",
          accountId: destination.accountId,
          message: "This exact post is already queued for the same account and time.",
        });
        continue;
      }

      const postedTimestamp = Date.parse(upload.postedAt ?? "");
      if (upload.status === "posted" && Number.isFinite(postedTimestamp) && postedTimestamp >= oneDayAgo) {
        issues.push({
          code: "recent_account_repeat",
          severity: "warning",
          accountId: destination.accountId,
          message: "This account published the same content in the last 24 hours. Confirm that the repeat is intentional.",
        });
      }
    }
  }
  return uniqueIssues(issues);
}

export class ContentPreflightError extends Error {
  readonly code: "CONTENT_PREFLIGHT_BLOCKED" | "CONTENT_PREFLIGHT_WARNINGS";
  readonly issues: ContentPreflightIssue[];

  constructor(issues: ContentPreflightIssue[], warningOnly = false) {
    const blocks = issues.filter(issue => issue.severity === "block");
    const selected = warningOnly ? issues.filter(issue => issue.severity === "warning") : blocks.length ? blocks : issues;
    super(selected.map(issue => issue.message).join(" ") || "Content pre-flight check failed.");
    this.name = "ContentPreflightError";
    this.code = blocks.length ? "CONTENT_PREFLIGHT_BLOCKED" : "CONTENT_PREFLIGHT_WARNINGS";
    this.issues = selected;
  }
}

export function assertContentPreflight(issues: ContentPreflightIssue[], confirmWarnings: boolean) {
  if (issues.some(issue => issue.severity === "block")) throw new ContentPreflightError(issues);
  if (!confirmWarnings && issues.some(issue => issue.severity === "warning")) {
    throw new ContentPreflightError(issues, true);
  }
}

export function isExactQueuedDuplicate(
  input: ContentPreflightInput,
  destination: ContentPreflightDestination,
  upload: PlatformUpload,
) {
  return upload.accountId === destination.accountId
    && (upload.status === "queued" || upload.status === "processing")
    && sameContent(input, destination, upload)
    && sameTiming(destination, upload);
}
