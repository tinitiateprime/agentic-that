const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

/**
 * Temporarily unlocks every product module and bypasses trial usage quotas.
 *
 * This is fail-closed: a deployment receives unrestricted testing access only
 * when the flag is explicitly enabled. Production configuration validation
 * rejects that flag entirely.
 */
export function teamTestingFullAccessEnabled(
  rawValue = process.env.NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS,
) {
  return ENABLED_VALUES.has(String(rawValue ?? "false").trim().toLowerCase());
}
