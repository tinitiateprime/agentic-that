import crypto from "node:crypto";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function canonicalMigrationSource(value) {
  return String(value).replace(/\r\n?/g, "\n");
}

export function migrationChecksum(value) {
  return sha256(canonicalMigrationSource(value));
}

export function migrationChecksumMatches(value, expected) {
  const source = String(value);
  const canonical = canonicalMigrationSource(source);
  const legacyChecksums = new Set([
    migrationChecksum(source),
    sha256(source),
    sha256(canonical.replace(/\n/g, "\r\n")),
  ]);
  return legacyChecksums.has(String(expected || ""));
}
