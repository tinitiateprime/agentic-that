import crypto from "node:crypto";

// Encryption at rest for per-tenant provider credentials (Meta access tokens,
// app secrets, WATI tokens). These are customer credentials — never store them
// in plaintext.
//
// Set CREDENTIAL_ENCRYPTION_KEY to 32 bytes, hex or base64:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Ciphertext format: "v1:<iv>:<authTag>:<ciphertext>" (each part base64).
// Values that don't carry the "v1:" prefix are returned as-is by decryptSecret,
// so credentials written before a key existed keep working until re-saved.

const PREFIX = "v1";

function key() {
  const raw = (process.env.CREDENTIAL_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is not set — required to store provider credentials. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64).");
  }
  return buf;
}

export function hasEncryptionKey() {
  return Boolean((process.env.CREDENTIAL_ENCRYPTION_KEY || "").trim());
}

export function encryptSecret(plain) {
  if (plain == null || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored) {
  if (stored == null || stored === "") return null;
  const s = String(stored);
  // Not encrypted (written before a key was configured) — pass through.
  if (!s.startsWith(`${PREFIX}:`)) return s;

  const [, ivB64, tagB64, dataB64] = s.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// True when the value is already ciphertext — lets callers avoid double-encrypting.
export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}
