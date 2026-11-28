import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scrub } from "./error-log.js";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("secrets are scrubbed from stored error text", () => {
  assert.equal(scrub("dsn postgres://app:hunter2@db.example.com/prod"), "dsn postgres://app:***@db.example.com/prod");
  assert.equal(scrub("Authorization: Bearer abcdefghijklmnop"), "Authorization: Bearer ***");
  assert.equal(scrub("meta said EAAabcdefghijklmnopqrstuvwxyz0123 is invalid"), "meta said *** is invalid");
  assert.equal(scrub("GET /hook?a=1&token=s3cr3t&b=2"), "GET /hook?a=1&token=***&b=2");
  assert.equal(scrub("failed token=abc123 retry"), "failed token=*** retry");
  assert.equal(scrub('{"password":"letmein","name":"x"}'), '{"password":"***","name":"x"}');
  assert.equal(scrub("keyboard=fine"), "keyboard=fine");
  assert.equal(scrub("x".repeat(50), 10), `${"x".repeat(10)}…`);
});

test("every server error is captured through Next.js onRequestError", async () => {
  const instrumentation = await source("../instrumentation.js");
  assert.match(instrumentation, /export async function onRequestError\(error, request, context\)/);
  assert.match(instrumentation, /process\.env\.NEXT_RUNTIME !== "nodejs"/);
  assert.match(instrumentation, /logRequestError\(error, request, context\)/);

  const writer = await source("./error-log.js");
  // Own connection, never the audited app client, and never throws.
  assert.match(writer, /__agenticThatErrorLogSql \|\|= postgres\(url/);
  assert.doesNotMatch(writer, /withAudit/);
  assert.match(writer, /catch \(logFailure\)/);
  assert.match(writer, /INSERT INTO agentic_that\.app_error_log/);
});

test("browser errors and the Telegram service report too", async () => {
  const globalError = await source("../app/global-error.jsx");
  assert.match(globalError, /sendBeacon\("\/api\/error-log\/client"/);
  const clientRoute = await source("../app/api/error-log/client/route.js");
  assert.match(clientRoute, /source: "client"/);
  assert.match(clientRoute, /cookieHeader: req\.headers\.get\("cookie"\)/);
  const telegram = await source("../services/messaging/telegram/src/server.ts");
  assert.match(telegram, /void logError\(error, \{\s*source: "telegram"/);
});

test("people only see their own errors unless they are Super Admins", async () => {
  const viewer = await source("../app/api/error-log/route.js");
  assert.match(viewer, /if \(all && !principal\.isGlobalAdmin\)/);
  assert.match(viewer, /WHERE user_id = \$\{String\(principal\.userId\)\}/);

  const migration = await source("../supabase/migrations/202611280001_app_error_log.sql");
  assert.match(migration, /create table if not exists agentic_that\.app_error_log/);
  assert.match(migration, /revoke all on table agentic_that\.app_error_log from public/);
});
