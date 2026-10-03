import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { migrationChecksum, migrationChecksumMatches } from "./migration-checksum.mjs";

function rawChecksum(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("migration checksums are identical across Linux and Windows line endings", () => {
  const linux = "create table example (id text);\nselect 1;\n";
  const windows = linux.replace(/\n/g, "\r\n");
  assert.equal(migrationChecksum(linux), migrationChecksum(windows));
});

test("migration checksums accept legacy raw hashes without accepting SQL edits", () => {
  const linux = "create table example (id text);\nselect 1;\n";
  const windows = linux.replace(/\n/g, "\r\n");
  assert.equal(migrationChecksumMatches(linux, rawChecksum(windows)), true);
  assert.equal(migrationChecksumMatches(windows, rawChecksum(linux)), true);
  assert.equal(migrationChecksumMatches("select 2;\n", rawChecksum(linux)), false);
});
