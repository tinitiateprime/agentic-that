import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type PersistedEnvelope = {
  version: 1;
  protected: true;
  iv: string;
  tag: string;
  ciphertext: string;
};

function persistenceFile(platform: string) {
  const storePath = process.env.PUBLISH_QUEUE_DATA_PATH?.trim();
  if (!storePath) return null;
  return path.join(path.dirname(path.resolve(storePath)), `${platform}-companion-jobs.json`);
}

function encryptionKey() {
  const secret = process.env.PUBLISH_QUEUE_SESSION_ENCRYPTION_KEY?.trim();
  return secret ? createHash("sha256").update(secret).digest() : null;
}

function encode(value: unknown) {
  const key = encryptionKey();
  const plain = JSON.stringify(value);
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    protected: true,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  } satisfies PersistedEnvelope);
}

function decode(contents: string) {
  const parsed = JSON.parse(contents) as PersistedEnvelope | unknown[];
  if (!parsed || Array.isArray(parsed) || (parsed as PersistedEnvelope).protected !== true) return parsed;
  const key = encryptionKey();
  if (!key) throw new Error("The local scraping queue encryption key is unavailable.");
  const envelope = parsed as PersistedEnvelope;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8"));
}

function atomicWrite(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "w", 0o600);
  try {
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function loadCompanionJobs(platform: "instagram" | "facebook") {
  const filePath = persistenceFile(platform);
  if (!filePath) return [];
  for (const candidate of [filePath, `${filePath}.backup`]) {
    try {
      const value = decode(fs.readFileSync(candidate, "utf8"));
      if (!Array.isArray(value)) continue;
      if (candidate !== filePath) atomicWrite(filePath, encode(value));
      return value as Array<Record<string, unknown>>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        console.warn(`Could not restore ${platform} Companion queue from ${path.basename(candidate)}.`);
      }
    }
  }
  return [];
}

export function persistCompanionJobs(platform: "instagram" | "facebook", jobs: unknown[]) {
  const filePath = persistenceFile(platform);
  if (!filePath) return;
  if (process.env.NODE_ENV === "production" && !encryptionKey()) {
    throw new Error("The local scraping queue cannot be saved without secure storage.");
  }
  try {
    if (fs.existsSync(filePath)) {
      const current = fs.readFileSync(filePath, "utf8");
      decode(current);
      atomicWrite(`${filePath}.backup`, current);
    }
  } catch {
    // Preserve the previous known-good backup when the primary file is corrupt.
  }
  atomicWrite(filePath, encode(jobs));
}
