export type PublishingRiskKind = "rate_limit" | "verification" | "restriction" | "uncertain_publish";

export type PublishingRisk = {
  kind: PublishingRiskKind;
  accountStatus: "warning" | "paused" | "restricted";
  reason: string;
  requiresLogin: boolean;
};

export function classifyPublishingRisk(message: string, pageUrl = ""): PublishingRisk | null {
  const signal = `${message} ${pageUrl}`;

  if (/suspend(?:ed|ed account)?|account (?:is |has been )?disabled|account locked|account\/access|restricted account|restriction/i.test(signal)) {
    return {
      kind: "restriction",
      accountStatus: "restricted",
      reason: "The platform reported that this account is restricted, locked, suspended, or disabled.",
      requiresLogin: true,
    };
  }
  if (/\b429\b|rate.?limit|too many requests|temporarily limited|try again later|we limit how often|action blocked/i.test(signal)) {
    return {
      kind: "rate_limit",
      accountStatus: "paused",
      reason: "The platform rate-limited or temporarily blocked this account.",
      requiresLogin: false,
    };
  }
  if (/captcha|checkpoint|challenge|manual verification|security verification|verify (?:your|it['’]s)|verification code|two.?factor|\b2fa\b|arkose|unusual login|suspicious activity/i.test(signal)) {
    return {
      kind: "verification",
      accountStatus: "paused",
      reason: "The platform requires CAPTCHA, checkpoint, or manual account verification.",
      requiresLogin: true,
    };
  }
  if (/confirmation did not appear|did not confirm the post|post did not finish|dialog is still open .*after clicking|final publish (?:action|result).*uncertain|shared confirmation did not appear/i.test(signal)) {
    return {
      kind: "uncertain_publish",
      accountStatus: "warning",
      reason: "The final publish action was sent, but the platform result is uncertain. Verify the account before resuming.",
      requiresLogin: false,
    };
  }

  return null;
}
