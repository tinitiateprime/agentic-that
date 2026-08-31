const SECRET_FIELD = /(?:password|cookie|token|secret|key|authorization|caption|input)/i;

function safeFields(fields: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [
    key,
    SECRET_FIELD.test(key) ? "[REDACTED]" : value,
  ]));
}

export function operationalLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
) {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "agenticthat-automation-server",
    event,
    ...safeFields(fields),
  });
  (level === "error" ? process.stderr : process.stdout).write(`${record}\n`);
}
