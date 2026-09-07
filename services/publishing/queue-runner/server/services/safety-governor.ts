import type { AccountSafetyMode, Platform, PlatformUpload, PostFormat } from "../../shared/schema.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function publishingSafetyPacingEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return ["1", "true", "yes", "on"].includes(
    String(environment.PUBLISHING_SAFETY_PACING_ENABLED || "").trim().toLowerCase(),
  );
}

export type PublishingSafetyRule = {
  hourlyLimit: number;
  dailyLimit: number;
  minimumGapMs: number;
};

export type PublishingSafetyAssessment = {
  allowed: boolean;
  retryAt?: string;
  reason?: string;
  rule: PublishingSafetyRule;
  postsLastHour: number;
  postsLastDay: number;
};

export type ScheduledPublishingSafetyAssessment = PublishingSafetyAssessment & {
  requestedAt: string;
  earliestAt: string;
};

const platformRules = {
  instagram: { hourlyLimit: 1, dailyLimit: 6, minimumGapMs: 60 * 60 * 1000 },
  facebook: { hourlyLimit: 2, dailyLimit: 10, minimumGapMs: 30 * 60 * 1000 },
  linkedin: { hourlyLimit: 1, dailyLimit: 3, minimumGapMs: 60 * 60 * 1000 },
  x: { hourlyLimit: 4, dailyLimit: 30, minimumGapMs: 15 * 60 * 1000 },
} satisfies Partial<Record<PlatformUpload["platform"], PublishingSafetyRule>>;

export function publishingSafetyRuleFor(
  platform: Platform,
  postFormat: PostFormat | undefined,
  safetyMode: AccountSafetyMode = "standard",
): PublishingSafetyRule {
  const standardRule = platform === "youtube"
    ? postFormat === "video"
      ? { hourlyLimit: 1, dailyLimit: 3, minimumGapMs: 60 * 60 * 1000 }
      : { hourlyLimit: 2, dailyLimit: 6, minimumGapMs: 30 * 60 * 1000 }
    : platformRules[platform];
  if (safetyMode === "standard") return standardRule;
  return {
    hourlyLimit: Math.max(1, Math.floor(standardRule.hourlyLimit / 2)),
    dailyLimit: Math.max(1, Math.floor(standardRule.dailyLimit / 2)),
    minimumGapMs: Math.max(60 * 60 * 1000, standardRule.minimumGapMs * 2),
  };
}

export function publishingSafetyRule(
  upload: Pick<PlatformUpload, "platform" | "postFormat">,
  safetyMode: AccountSafetyMode = "standard",
): PublishingSafetyRule {
  return publishingSafetyRuleFor(upload.platform, upload.postFormat, safetyMode);
}

function postedTime(upload: PlatformUpload) {
  if (upload.status !== "posted" || !upload.postedAt) return null;
  const timestamp = Date.parse(upload.postedAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function assessPublishingSafety(
  upload: PlatformUpload,
  accountUploads: PlatformUpload[],
  now = Date.now(),
  safetyMode: AccountSafetyMode = "standard",
  enforcePacing = publishingSafetyPacingEnabled(),
): PublishingSafetyAssessment {
  const rule = publishingSafetyRule(upload, safetyMode);
  const postedTimes = accountUploads
    .map(postedTime)
    .filter((timestamp): timestamp is number => timestamp !== null && timestamp <= now)
    .sort((left, right) => left - right);
  const hourlyTimes = postedTimes.filter(timestamp => timestamp > now - HOUR_MS);
  const dailyTimes = postedTimes.filter(timestamp => timestamp > now - DAY_MS);
  const retryCandidates: Array<{ at: number; reason: string }> = [];
  const latestPostAt = postedTimes.at(-1);

  if (latestPostAt !== undefined && latestPostAt + rule.minimumGapMs > now) {
    retryCandidates.push({
      at: latestPostAt + rule.minimumGapMs,
      reason: "Minimum spacing between posts is still active.",
    });
  }
  if (hourlyTimes.length >= rule.hourlyLimit) {
    retryCandidates.push({
      at: hourlyTimes[hourlyTimes.length - rule.hourlyLimit] + HOUR_MS,
      reason: `The ${rule.hourlyLimit}-post hourly safety limit was reached.`,
    });
  }
  if (dailyTimes.length >= rule.dailyLimit) {
    retryCandidates.push({
      at: dailyTimes[dailyTimes.length - rule.dailyLimit] + DAY_MS,
      reason: `The ${rule.dailyLimit}-post daily safety limit was reached.`,
    });
  }

  const controllingLimit = retryCandidates.sort((left, right) => right.at - left.at)[0];
  return {
    allowed: !enforcePacing || !controllingLimit,
    retryAt: enforcePacing && controllingLimit ? new Date(controllingLimit.at).toISOString() : undefined,
    reason: enforcePacing ? controllingLimit?.reason : undefined,
    rule,
    postsLastHour: hourlyTimes.length,
    postsLastDay: dailyTimes.length,
  };
}

function reservedPublishingTime(upload: PlatformUpload) {
  const value = upload.status === "posted"
    ? upload.postedAt
    : upload.status === "queued"
      ? upload.scheduledAt ?? upload.safetyDeferredUntil
      : undefined;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function assessScheduledPublishingSafety(
  upload: Pick<PlatformUpload, "id" | "platform" | "postFormat">,
  accountUploads: PlatformUpload[],
  requestedAt: number,
  safetyMode: AccountSafetyMode = "standard",
  enforcePacing = publishingSafetyPacingEnabled(),
): ScheduledPublishingSafetyAssessment {
  if (!Number.isFinite(requestedAt)) throw new Error("A valid publishing time is required.");
  const rule = publishingSafetyRule(upload, safetyMode);
  const reservedTimes = accountUploads
    .filter(item => item.id !== upload.id)
    .map(reservedPublishingTime)
    .filter((timestamp): timestamp is number => timestamp !== null)
    .sort((left, right) => left - right);
  if (!enforcePacing) {
    const hourlyTimes = reservedTimes.filter(timestamp => timestamp <= requestedAt && timestamp > requestedAt - HOUR_MS);
    const dailyTimes = reservedTimes.filter(timestamp => timestamp <= requestedAt && timestamp > requestedAt - DAY_MS);
    const requestedAtIso = new Date(requestedAt).toISOString();
    return {
      allowed: true,
      requestedAt: requestedAtIso,
      earliestAt: requestedAtIso,
      rule,
      postsLastHour: hourlyTimes.length,
      postsLastDay: dailyTimes.length,
    };
  }
  let candidate = requestedAt;
  let reason: string | undefined;

  // Move forward until the requested slot satisfies spacing and rolling caps.
  // Existing future schedules are reservations, so two accepted jobs cannot
  // silently collide when the scheduler wakes up.
  for (let iteration = 0; iteration < 100; iteration += 1) {
    let nextCandidate = candidate;
    const spacingConflict = reservedTimes.find(timestamp => Math.abs(timestamp - candidate) < rule.minimumGapMs);
    if (spacingConflict !== undefined) {
      nextCandidate = Math.max(nextCandidate, spacingConflict + rule.minimumGapMs);
      reason ??= "Minimum spacing between posts is still active.";
    }

    const hourlyTimes = reservedTimes.filter(timestamp => timestamp <= candidate && timestamp > candidate - HOUR_MS);
    if (hourlyTimes.length >= rule.hourlyLimit) {
      nextCandidate = Math.max(nextCandidate, hourlyTimes[hourlyTimes.length - rule.hourlyLimit] + HOUR_MS);
      reason ??= `The ${rule.hourlyLimit}-post hourly safety limit would be exceeded.`;
    }

    const dailyTimes = reservedTimes.filter(timestamp => timestamp <= candidate && timestamp > candidate - DAY_MS);
    if (dailyTimes.length >= rule.dailyLimit) {
      nextCandidate = Math.max(nextCandidate, dailyTimes[dailyTimes.length - rule.dailyLimit] + DAY_MS);
      reason ??= `The ${rule.dailyLimit}-post daily safety limit would be exceeded.`;
    }

    if (nextCandidate <= candidate) break;
    candidate = nextCandidate;
  }

  const hourlyTimes = reservedTimes.filter(timestamp => timestamp <= requestedAt && timestamp > requestedAt - HOUR_MS);
  const dailyTimes = reservedTimes.filter(timestamp => timestamp <= requestedAt && timestamp > requestedAt - DAY_MS);
  return {
    allowed: candidate <= requestedAt,
    requestedAt: new Date(requestedAt).toISOString(),
    earliestAt: new Date(candidate).toISOString(),
    retryAt: candidate > requestedAt ? new Date(candidate).toISOString() : undefined,
    reason: candidate > requestedAt ? reason ?? "The selected time conflicts with another protected publishing slot." : undefined,
    rule,
    postsLastHour: hourlyTimes.length,
    postsLastDay: dailyTimes.length,
  };
}
