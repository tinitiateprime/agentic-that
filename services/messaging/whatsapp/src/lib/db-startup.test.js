import assert from "node:assert/strict";
import test from "node:test";
import { ensureReady } from "./db.js";

test("explicitly disabling migrations prevents development bootstrap and imports", async (context) => {
  const previous = { NODE_ENV: process.env.NODE_ENV, RUN_DATABASE_MIGRATIONS: process.env.RUN_DATABASE_MIGRATIONS, DATABASE_URL: process.env.DATABASE_URL, SUPABASE_DB_URL: process.env.SUPABASE_DB_URL };
  context.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.NODE_ENV = "development";
  process.env.RUN_DATABASE_MIGRATIONS = "false";
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_DB_URL;
  assert.equal(await ensureReady(), undefined);
});
