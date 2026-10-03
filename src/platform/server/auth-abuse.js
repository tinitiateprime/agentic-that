import crypto from "node:crypto";
import { getPlatformSql, PlatformAuthError } from "./auth-store.js";

const localWindows = new Map();

function subjectHash(subject) {
  const pepper = process.env.AUTH_RATE_LIMIT_PEPPER || process.env.SESSION_ENCRYPTION_KEY || "development";
  return crypto.createHmac("sha256", pepper).update(String(subject || "unknown").toLowerCase()).digest("hex");
}

export function requestClientAddress(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-nf-client-connection-ip") || "unknown";
}

export async function enforceAuthRateLimit(scope, subject, maximum, windowSeconds, blockSeconds = windowSeconds) {
  const hash = subjectHash(subject);
  const enforceLocally = () => {
    const key = `${scope}:${hash}`;
    const now = Date.now();
    const current = localWindows.get(key);
    if (!current || current.startedAt + windowSeconds * 1000 <= now) {
      localWindows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    if (current.count > maximum) throw new PlatformAuthError("RATE_LIMITED", "Too many attempts. Please wait and try again.");
    return true;
  };
  if (!process.env.DATABASE_URL?.trim() && !process.env.SUPABASE_DB_URL?.trim()) {
    enforceLocally();
    return;
  }

  const sql = await getPlatformSql();
  const [availability] = await sql`
    SELECT to_regclass('public.platform_auth_rate_limits') IS NOT NULL AS ready`;
  if (!availability?.ready) {
    enforceLocally();
    return;
  }
  const [row] = await sql`
    INSERT INTO platform_auth_rate_limits
      (scope, subject_hash, window_started, request_count, blocked_until, updated_at)
    VALUES
      (${scope}, ${hash}, now(), 1, NULL, now())
    ON CONFLICT (scope, subject_hash) DO UPDATE SET
      window_started = CASE
        WHEN platform_auth_rate_limits.window_started <= now() - (${windowSeconds} * interval '1 second')
          THEN now() ELSE platform_auth_rate_limits.window_started END,
      request_count = CASE
        WHEN platform_auth_rate_limits.window_started <= now() - (${windowSeconds} * interval '1 second')
          THEN 1 ELSE platform_auth_rate_limits.request_count + 1 END,
      blocked_until = CASE
        WHEN platform_auth_rate_limits.blocked_until > now() THEN platform_auth_rate_limits.blocked_until
        WHEN platform_auth_rate_limits.window_started > now() - (${windowSeconds} * interval '1 second')
             AND platform_auth_rate_limits.request_count + 1 > ${maximum}
          THEN now() + (${blockSeconds} * interval '1 second')
        ELSE NULL END,
      updated_at = now()
    RETURNING request_count, blocked_until`;
  if (row?.blocked_until && new Date(row.blocked_until).getTime() > Date.now()) {
    throw new PlatformAuthError("RATE_LIMITED", "Too many attempts. Please wait and try again.");
  }
}

export async function clearAuthRateLimit(scope, subject) {
  if (!process.env.DATABASE_URL?.trim() && !process.env.SUPABASE_DB_URL?.trim()) return;
  const sql = await getPlatformSql();
  const [availability] = await sql`
    SELECT to_regclass('public.platform_auth_rate_limits') IS NOT NULL AS ready`;
  if (!availability?.ready) return;
  await sql`DELETE FROM platform_auth_rate_limits WHERE scope = ${scope} AND subject_hash = ${subjectHash(subject)}`;
}
