import crypto from "node:crypto";
import postgres from "postgres";

// Writes application errors to agentic_that.app_error_log
// (supabase/migrations/202611280001_app_error_log.sql).
//
// Deliberately independent of the app's own database helpers: it opens its
// own small connection, never goes through the audit wrapper, and never
// throws. A failure here (table not migrated yet, database down) falls back to
// console.error, so logging can never turn into a second error.

const globalForErrorLog = globalThis;
const PLATFORM_SESSION_COOKIE = "agenticthat_session";
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;
const MAX_PER_MINUTE = 60;

function connectionString() {
  return String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
}

function client() {
  const url = connectionString();
  if (!url || url.includes("...") || /\[YOUR-PASSWORD\]/i.test(url)) return null;
  globalForErrorLog.__agenticThatErrorLogSql ||= postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    onnotice: () => {},
  });
  return globalForErrorLog.__agenticThatErrorLogSql;
}

// Remove secrets that commonly end up in error text.
export function scrub(value, limit) {
  let text = String(value ?? "");
  text = text
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1***@")
    .replace(/\b(Bearer|OAuth|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 ***")
    .replace(/\b(EAA[A-Za-z0-9]{20,})\b/g, "***")
    .replace(/((?:^|[?&\s,;(])(?:token|access_token|api_key|apikey|key|secret|signature|code|password)=)[^&\s"',;)]+/gi, "$1***")
    .replace(/("?(?:password|secret|token|apiKey|api_key|accessToken|access_token)"?\s*[:=]\s*")[^"]*"/gi, "$1***\"");
  return limit && text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function pathOnly(value) {
  const raw = String(value || "");
  if (!raw) return null;
  try {
    return new URL(raw, "http://local").pathname.slice(0, 500);
  } catch {
    return raw.split("?")[0].slice(0, 500);
  }
}

function cookieValue(cookieHeader, name) {
  for (const part of String(cookieHeader || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return part.slice(index + 1).trim();
      }
    }
  }
  return null;
}

function header(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join("; ") : value ?? null;
}

// The signed-in AgenticThat user behind a request, from its session cookie.
async function identityFromCookie(sql, cookieHeader) {
  const token = cookieValue(cookieHeader, PLATFORM_SESSION_COOKIE);
  if (!token) return {};
  try {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const [row] = await sql`
      SELECT u.id, lower(u.email) AS email, u.workspace_id
        FROM platform_sessions s
        JOIN platform_users u ON u.id = s.user_id
       WHERE s.token_hash = ${hash}
       LIMIT 1`;
    return row ? { userId: String(row.id), username: row.email || null, workspaceId: row.workspace_id || null } : {};
  } catch {
    return {};
  }
}

let windowStart = 0;
let windowCount = 0;
function allowed() {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= MAX_PER_MINUTE;
}

// Record one error. `error` may be an Error or anything thrown. Never throws;
// resolves to the stored row id, or null when it couldn't be stored.
export async function logError(error, details = {}) {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error ?? null));
  const message = scrub(details.message || err.message || String(err), MAX_MESSAGE) || "(no message)";
  console.error(`[error-log] ${details.source || "server"} ${details.method || ""} ${pathOnly(details.path) || ""} ${message}`.trim());

  if (!allowed()) return null;
  const sql = client();
  if (!sql) return null;

  try {
    const identity = details.userId || details.username
      ? { userId: details.userId || null, username: details.username || null, workspaceId: details.workspaceId || null }
      : await identityFromCookie(sql, details.cookieHeader);
    const [row] = await sql`
      INSERT INTO agentic_that.app_error_log
        (source, kind, method, path, route, error_name, message, stack, digest, code,
         user_id, username, workspace_id, environment, context)
      VALUES
        (${String(details.source || "server").slice(0, 40)},
         ${details.kind ? String(details.kind).slice(0, 60) : null},
         ${details.method ? String(details.method).slice(0, 10) : null},
         ${pathOnly(details.path)},
         ${details.route ? String(details.route).slice(0, 300) : null},
         ${String(details.errorName || err.name || "Error").slice(0, 120)},
         ${message},
         ${details.stack === false ? null : scrub(details.stack || err.stack || "", MAX_STACK) || null},
         ${err.digest || details.digest || null},
         ${err.code ? String(err.code).slice(0, 40) : null},
         ${identity.userId || null},
         ${identity.username || null},
         ${identity.workspaceId || null},
         ${process.env.HOSTING_PROVIDER || process.env.NODE_ENV || null},
         ${sql.json(details.context || {})})
      RETURNING id`;
    if (Math.random() < 0.01) {
      await sql`DELETE FROM agentic_that.app_error_log WHERE occurred_at < now() - interval '30 days'`;
    }
    return row?.id ?? null;
  } catch (logFailure) {
    console.error(`[error-log] could not store error: ${scrub(logFailure?.message || logFailure, 300)}`);
    return null;
  }
}

// Next.js onRequestError(error, request, context) — see instrumentation.js.
export function logRequestError(error, request = {}, context = {}) {
  return logError(error, {
    source: "server",
    kind: context.routeType || null, // "render" | "route" | "action" | "middleware"
    method: request.method,
    path: request.path,
    route: context.routePath || null,
    cookieHeader: header(request.headers, "cookie"),
    context: {
      routerKind: context.routerKind || null,
      renderSource: context.renderSource || null,
      revalidateReason: context.revalidateReason || null,
    },
  });
}
