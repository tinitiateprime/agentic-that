import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  initializeDatabaseDocument,
  mutateDatabaseDocument,
  readDatabaseDocument,
} from "./database-document-store.js";

test("local development persists documents without a database URL and serializes mutations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-documents-"));
  const file = path.join(directory, "documents.json");
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
    SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
    PLATFORM_DOCUMENT_DATA_PATH: process.env.PLATFORM_DOCUMENT_DATA_PATH,
    NODE_ENV: process.env.NODE_ENV,
    NETLIFY: process.env.NETLIFY,
    NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT,
  };

  try {
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.SUPABASE_DATABASE_URL;
    delete process.env.NETLIFY;
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    process.env.NODE_ENV = "development";
    process.env.PLATFORM_DOCUMENT_DATA_PATH = file;

    await initializeDatabaseDocument("publishing", { count: 0 });
    await Promise.all(Array.from({ length: 8 }, () => mutateDatabaseDocument(
      "publishing",
      { count: 0 },
      async (document) => ({ document: { count: document.count + 1 }, result: document.count + 1 }),
    )));

    assert.deepEqual(await readDatabaseDocument("publishing"), { count: 8 });
    assert.equal(JSON.parse(await readFile(file, "utf8")).documents.publishing.count, 8);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("production refuses filesystem document persistence without a database URL", async () => {
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
    SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
  try {
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.SUPABASE_DATABASE_URL;
    process.env.NODE_ENV = "production";
    await assert.rejects(
      () => readDatabaseDocument("publishing"),
      /DATABASE_URL or SUPABASE_DB_URL is required/,
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
