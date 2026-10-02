import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { getDatabaseSql, mutateDatabaseDocument, readDatabaseDocument } from "../lib/database-document-store.js";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
process.env.DATA_STORE = "postgres";
process.env.NODE_ENV = "production";
process.env.RUN_DATABASE_MIGRATIONS = "false";
const sql = await getDatabaseSql();
const key = `aws-validation/${randomUUID()}`;
try {
  await Promise.all(Array.from({ length: 20 }, () => mutateDatabaseDocument(key, { count: 0 }, document => ({ document: { count: document.count + 1 }, result: undefined }))));
  assert.equal((await readDatabaseDocument(key)).count, 20);
  await assert.rejects(mutateDatabaseDocument(key, {}, () => { throw new Error("rollback-check"); }), /rollback-check/);
  assert.equal((await readDatabaseDocument(key)).count, 20);
  console.log("Supabase durable storage passed concurrent-write and transaction-rollback checks.");
} finally {
  await sql`DELETE FROM agentic_that.app_document_store WHERE key = ${key}`;
  await sql.end();
}
