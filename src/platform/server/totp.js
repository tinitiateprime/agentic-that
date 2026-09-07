import crypto from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}
export function decodeBase32(input) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of String(input || "").toUpperCase().replace(/=|\s|-/g, "")) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("MFA secret is invalid.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return encodeBase32(crypto.randomBytes(20));
}

export function totpCode(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret, code, timestamp = Date.now()) {
  const normalized = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const supplied = Buffer.from(normalized);
  return [-1, 0, 1].some((offset) => {
    const expected = Buffer.from(totpCode(secret, timestamp + offset * 30_000));
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  });
}

function encryptionKey() {
  const source = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.SESSION_ENCRYPTION_KEY || "";
  if (!source && process.env.NODE_ENV === "production") throw new Error("CREDENTIAL_ENCRYPTION_KEY is required for admin MFA.");
  return crypto.createHash("sha256").update(source || "agentic-that-development-mfa").digest();
}

export function encryptMfaSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptMfaSecret(value) {
  const [version, iv, tag, ciphertext] = String(value || "").split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Admin MFA is not configured correctly.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function totpEnrollmentUri(email, secret) {
  const label = encodeURIComponent(`AgenticThat:${email}`);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=AgenticThat&algorithm=SHA1&digits=6&period=30`;
}

export function createRecoveryCodes() {
  return Array.from({ length: 10 }, () => crypto.randomBytes(5).toString("hex").toUpperCase());
}

export function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update(String(code || "").replace(/\s|-/g, "").toUpperCase()).digest("hex");
}
