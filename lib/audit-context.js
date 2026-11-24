import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

// Who is acting, for the audit columns (created_by_username / updated_by_username)
// that the database trigger agentic_that.audit_stamp() fills in on every table.
// See supabase/migrations/202611250001_audit_columns.sql.
//
// The trigger reads the transaction-local setting `app.username`. withAudit()
// wraps a postgres.js client so that, when a signed-in user is known, each
// write runs in a transaction that sets it first. Reads are untouched, and
// writes with no signed-in user (webhooks, background jobs, scripts) run as
// before and are recorded as 'system'.
//
// The username is the user's login email. It comes from, in order:
//   1. an explicit scope: runAsAuditUser(username, fn), or setAuditUsername()
//      inside runWithAuditScope() (the Telegram service uses this);
//   2. the AgenticThat session cookie of the current Next.js request.

const scopeStorage = new AsyncLocalStorage();
const PLATFORM_SESSION_COOKIE = "agenticthat_session";
const CACHE_TTL_MS = 60_000;
const CACHE_LIMIT = 500;
const sessionCache = new Map(); // session token -> { username, expires }

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  return username || null;
}

// Run fn with a fixed acting user (scripts, jobs started on a user's behalf).
export function runAsAuditUser(username, fn) {
  return scopeStorage.run({ username: normalizeUsername(username) }, fn);
}

// Open a per-request scope whose user is filled in later by setAuditUsername(),
// e.g. once a request's credentials have been checked.
export function runWithAuditScope(fn) {
  return scopeStorage.run({ username: null }, fn);
}

export function setAuditUsername(username) {
  const scope = scopeStorage.getStore();
  if (scope) scope.username = normalizeUsername(username);
}

// Looks the session up with the raw (unwrapped) client on purpose: going
// through the app's helpers could wait on first-request database setup, which
// may itself be the write being audited.
async function platformSessionUsername(rawSql) {
  let token;
  try {
    const { cookies } = await import("next/headers");
    token = (await cookies()).get(PLATFORM_SESSION_COOKIE)?.value;
  } catch {
    return null; // not inside a Next.js request
  }
  if (!token || !rawSql) return null;

  const cached = sessionCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.username;

  let username = null;
  try {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const [row] = await rawSql`
      SELECT u.email
        FROM platform_sessions s
        JOIN platform_users u ON u.id = s.user_id
       WHERE s.token_hash = ${hash}
         AND s.expires_at > now()
       LIMIT 1`;
    username = normalizeUsername(row?.email);
  } catch {
    username = null; // auth tables not created yet, or file-based auth
  }
  if (sessionCache.size >= CACHE_LIMIT) sessionCache.clear();
  sessionCache.set(token, { username, expires: Date.now() + CACHE_TTL_MS });
  return username;
}

export async function currentAuditUsername(rawSql) {
  const scope = scopeStorage.getStore();
  if (scope?.username) return scope.username;
  return platformSessionUsername(rawSql);
}

// Data-changing statements, including INSERT ... ON CONFLICT and writes
// inside a WITH clause.
const WRITE_STATEMENT = /\b(insert\s+into|update\s+[\w."]+\s+(?:as\s+\w+\s+)?set|delete\s+from|merge\s+into)\b/i;

function isWriteTemplate(strings) {
  return Array.isArray(strings) && Array.isArray(strings.raw) && WRITE_STATEMENT.test(strings.join(" "));
}

function setActor(tx, username) {
  return tx`SELECT set_config('app.username', ${username}, true)`;
}

// Wrap a postgres.js client so writes carry the acting user. The wrapper is a
// drop-in replacement: helpers (sql(obj), sql.json, ...), reads and
// everything else pass straight through.
export function withAudit(sql) {
  if (!sql || sql.__audited) return sql;

  const begin = (...args) => {
    const callback = args[args.length - 1];
    if (typeof callback !== "function") return sql.begin(...args);
    return currentAuditUsername(sql).then((username) => {
      if (!username) return sql.begin(...args);
      return sql.begin(...args.slice(0, -1), async (tx) => {
        await setActor(tx, username);
        return callback(tx);
      });
    });
  };

  const unsafe = (query, ...rest) => {
    if (!WRITE_STATEMENT.test(String(query))) return sql.unsafe(query, ...rest);
    return currentAuditUsername(sql).then((username) => {
      if (!username) return sql.unsafe(query, ...rest);
      return sql.begin(async (tx) => {
        await setActor(tx, username);
        return tx.unsafe(query, ...rest);
      });
    });
  };

  return new Proxy(sql, {
    apply(target, thisArg, args) {
      if (!isWriteTemplate(args[0])) return Reflect.apply(target, thisArg, args);
      return currentAuditUsername(sql).then((username) => {
        if (!username) return Reflect.apply(target, thisArg, args);
        return target.begin(async (tx) => {
          await setActor(tx, username);
          return tx(...args);
        });
      });
    },
    get(target, prop, receiver) {
      if (prop === "__audited") return true;
      if (prop === "begin") return begin;
      if (prop === "unsafe") return unsafe;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
