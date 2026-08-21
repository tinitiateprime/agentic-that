const DISABLED_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

/**
 * Temporarily unlocks every product module and bypasses trial usage quotas.
 *
 * This is intentionally enabled by default for the current team-testing phase.
 * Set NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS=false and redeploy to restore the
 * stored trial, billing, and module-access restrictions.
 */
export function teamTestingFullAccessEnabled(
  rawValue = process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS,
) {
  return !DISABLED_VALUES.has(String(rawValue ?? "true").trim().toLowerCase());
}
