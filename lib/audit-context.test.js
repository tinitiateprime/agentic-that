import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runAsAuditUser, runWithAuditScope, setAuditUsername, withAudit } from "./audit-context.js";

// A stand-in for a postgres.js client that records what reaches the database.
function fakeClient() {
  const log = [];
  const run = (strings, ...values) => {
    log.push({ sql: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve([]);
  };
  const sql = (first, ...rest) => (Array.isArray(first) && first.raw ? run(first, ...rest) : { helper: first });
  sql.begin = async (callback) => {
    log.push("BEGIN");
    const result = await callback(sql);
    log.push("COMMIT");
    return result;
  };
  sql.unsafe = (query, params = []) => {
    log.push({ sql: query, values: params });
    return Promise.resolve([]);
  };
  sql.json = (value) => ({ json: value });
  return { sql, log };
}

const setConfig = "SELECT set_config('app.username', ?, true)";

test("writes by a known user run in a transaction that sets app.username first", async () => {
  const { sql, log } = fakeClient();
  const audited = withAudit(sql);
  await runAsAuditUser("Owner@Example.com", () => audited`UPDATE contacts SET name = ${"Anita"} WHERE id = ${1}`);
  assert.deepEqual(log[0], "BEGIN");
  assert.deepEqual(log[1], { sql: setConfig, values: ["owner@example.com"] });
  assert.match(log[2].sql, /^UPDATE contacts SET name = \? WHERE id = \?$/);
  assert.deepEqual(log[3], "COMMIT");
});

test("reads and anonymous writes pass straight through", async () => {
  const { sql, log } = fakeClient();
  const audited = withAudit(sql);
  await runAsAuditUser("owner@example.com", () => audited`SELECT * FROM contacts WHERE id = ${1}`);
  await audited`INSERT INTO messages (body) VALUES (${"hi"})`; // no user: webhook / job
  assert.equal(log.length, 2);
  assert.ok(!log.includes("BEGIN"));
});

test("INSERT ... ON CONFLICT and data-changing CTEs count as writes", async () => {
  const { sql, log } = fakeClient();
  const audited = withAudit(sql);
  await runAsAuditUser("a@b.co", async () => {
    await audited`WITH moved AS (DELETE FROM jobs WHERE id = ${1} RETURNING *) SELECT * FROM moved`;
    await audited`INSERT INTO t (id) VALUES (${1}) ON CONFLICT (id) DO UPDATE SET id = excluded.id`;
  });
  assert.equal(log.filter((entry) => entry === "BEGIN").length, 2);
});

test("sql.begin and sql.unsafe set the user too; helpers are untouched", async () => {
  const { sql, log } = fakeClient();
  const audited = withAudit(sql);
  await runAsAuditUser("a@b.co", async () => {
    await audited.begin(async (tx) => tx`DELETE FROM groups WHERE id = ${2}`);
    await audited.unsafe("UPDATE groups SET name = $1", ["x"]);
    await audited.unsafe("SELECT 1");
  });
  assert.deepEqual(log.slice(0, 2), ["BEGIN", { sql: setConfig, values: ["a@b.co"] }]);
  assert.deepEqual(log.slice(4, 6), ["BEGIN", { sql: setConfig, values: ["a@b.co"] }]);
  assert.deepEqual(log.at(-1), { sql: "SELECT 1", values: [] });
  assert.deepEqual(audited({ id: 1 }), { helper: { id: 1 } });
  assert.deepEqual(audited.json({ a: 1 }), { json: { a: 1 } });
  assert.equal(withAudit(audited), audited);
});

test("a request scope picks up the user once credentials are verified", async () => {
  const { sql, log } = fakeClient();
  const audited = withAudit(sql);
  await runWithAuditScope(async () => {
    await audited`INSERT INTO telegram_posts (id) VALUES (${1})`; // before auth: system
    setAuditUsername("Agent@Example.com");
    await audited`INSERT INTO telegram_posts (id) VALUES (${2})`;
  });
  assert.equal(log.filter((entry) => entry === "BEGIN").length, 1);
  assert.deepEqual(log[2], { sql: setConfig, values: ["agent@example.com"] });
});

test("the migration adds the four audit columns to every application table", async () => {
  const migration = await readFile(new URL("../supabase/migrations/202611250001_audit_columns.sql", import.meta.url), "utf8");
  for (const column of ["created_by_username", "created_datetime", "updated_by_username", "updated_datetime"]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`));
  }
  assert.match(migration, /current_setting\('app\.username', true\)/);
  assert.match(migration, /n\.nspname in \('public', 'agentic_that'\)/);
  assert.match(migration, /select agentic_that\.enable_audit_everywhere\(\);/);
  // Existing created_at / updated_at keep driving lease and retry logic.
  assert.doesNotMatch(migration, /new\.updated_at\s*:=/);

  const runner = await readFile(new URL("../scripts/migrate-platform-database.mjs", import.meta.url), "utf8");
  assert.match(runner, /agentic_that\.enable_audit_everywhere\(\)/);
});

test("every database client is wrapped", async () => {
  const files = {
    "../services/messaging/whatsapp/src/lib/db.js": /withAudit\(client\(\)\)/,
    "./database-document-store.js": /withAudit\(raw\)/,
    "../src/platform/server/website-studio-database.js": /withAudit\(globalForWebsiteStudio\.__websiteStudioSql\)/,
    "../services/messaging/telegram/src/store.ts": /withAudit\(globalForTelegram\.__agenticThatTelegramSql\)/,
    "../services/messaging/telegram/src/server.ts": /runWithAuditScope\(\(\) => handleRequestWithErrors/,
  };
  for (const [path, pattern] of Object.entries(files)) {
    assert.match(await readFile(new URL(path, import.meta.url), "utf8"), pattern, path);
  }
});
