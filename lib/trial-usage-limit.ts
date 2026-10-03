export type TrialUsageResult =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; retryAfterSeconds: number };

export class RollingTrialUsageLimiter {
  private readonly events = new Map<string, number[]>();

  check(keyInput: string, maximum: number, windowMs: number, now = Date.now()): TrialUsageResult {
    const key = String(keyInput || "").trim().toLowerCase();
    if (!key || maximum < 1 || windowMs < 1) {
      throw new Error("A valid trial usage limit is required.");
    }
    const cutoff = now - windowMs;
    const recent = (this.events.get(key) || []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= maximum) {
      this.events.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1_000)),
      };
    }
    return { allowed: true, remaining: maximum - recent.length };
  }

  consume(keyInput: string, maximum: number, windowMs: number, now = Date.now()): TrialUsageResult {
    const checked = this.check(keyInput, maximum, windowMs, now);
    if (!checked.allowed) return checked;
    const key = String(keyInput || "").trim().toLowerCase();
    const cutoff = now - windowMs;
    const recent = (this.events.get(key) || []).filter((timestamp) => timestamp > cutoff);
    recent.push(now);
    this.events.set(key, recent);
    if (this.events.size > 10_000) this.removeExpired(now, windowMs);
    return { allowed: true, remaining: maximum - recent.length };
  }

  private removeExpired(now: number, longestWindowMs: number) {
    const cutoff = now - longestWindowMs;
    for (const [key, timestamps] of this.events) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length) this.events.set(key, recent);
      else this.events.delete(key);
    }
  }
}
