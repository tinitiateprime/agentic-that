// Small encrypted JSON files for Group Manager: contacts, groups and the app
// logins (Telegram session, Discord bot token, WhatsApp keys). They are
// encrypted with the Companion's session key (kept by the operating system's
// secure storage) and written atomically, readable only by this user.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Envelope = { version: 1; protected: true; iv: string; tag: string; ciphertext: string };

function encryptionKey() {
  const secret = process.env.PUBLISH_QUEUE_SESSION_ENCRYPTION_KEY?.trim();
  return secret ? createHash("sha256").update(`agenticthat-groups:${secret}`).digest() : null;
}

/** JSON with Buffers kept as base64, so binary keys survive a round trip. */
function replacer(_key: string, value: unknown) {
  if (value && typeof value === "object" && (value as { type?: string }).type === "Buffer" && Array.isArray((value as { data?: unknown }).data)) {
    return { __buffer: Buffer.from((value as { data: number[] }).data).toString("base64") };
  }
  if (value instanceof Uint8Array) return { __buffer: Buffer.from(value).toString("base64") };
  return value;
}

function reviver(_key: string, value: unknown) {
  if (value && typeof value === "object" && typeof (value as { __buffer?: unknown }).__buffer === "string") {
    return Buffer.from((value as { __buffer: string }).__buffer, "base64");
  }
  return value;
}

export function encodeSecure(value: unknown) {
  const plain = JSON.stringify(value, replacer);
  const key = encryptionKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const envelope: Envelope = {
    version: 1,
    protected: true,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decodeSecure<T>(contents: string): T {
  const parsed = JSON.parse(contents, reviver) as Envelope | T;
  if (!parsed || typeof parsed !== "object" || (parsed as Envelope).protected !== true) return parsed as T;
  const key = encryptionKey();
  if (!key) throw new Error("The Companion's encryption key is unavailable, so saved groups can't be read.");
  const envelope = parsed as Envelope;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(plain, reviver) as T;
}

export function readSecureFile<T>(filePath: string, fallback: T): T {
  try {
    return decodeSecure<T>(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return fallback;
    throw error;
  }
}

export function writeSecureFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "w", 0o600);
  try {
    fs.writeFileSync(descriptor, encodeSecure(value), "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
}

export function removeSecureFile(filePath: string) {
  fs.rmSync(filePath, { force: true });
}
