import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decryptFile, encryptFile, LocalDataKeyEnvelopeProvider } from "./profile-encryption.ts";

test("local profile encryption round-trips and detects encrypted-file tampering", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-profile-encryption-"));
  const source = path.join(directory, "source.bin");
  const encrypted = path.join(directory, "encrypted.bin");
  const restored = path.join(directory, "restored.bin");
  const original = randomBytes(256 * 1024);
  const envelopes = new LocalDataKeyEnvelopeProvider(randomBytes(32).toString("base64url"));
  try {
    await writeFile(source, original, { mode: 0o600 });
    const metadata = await encryptFile(source, encrypted, envelopes);
    assert.equal(metadata.format, "agenticthat-aes-256-gcm-v1");
    assert.notDeepEqual(await readFile(encrypted), original);
    await decryptFile(encrypted, restored, metadata, envelopes);
    assert.deepEqual(await readFile(restored), original);

    const tampered = await readFile(encrypted);
    tampered[Math.floor(tampered.length / 2)]! ^= 1;
    await writeFile(encrypted, tampered);
    await assert.rejects(
      decryptFile(encrypted, restored, metadata, envelopes),
      /integrity checksum/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a different wrapping key cannot decrypt a browser profile", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-profile-wrong-key-"));
  const source = path.join(directory, "source.bin");
  const encrypted = path.join(directory, "encrypted.bin");
  const restored = path.join(directory, "restored.bin");
  const writer = new LocalDataKeyEnvelopeProvider(randomBytes(32).toString("base64url"));
  const wrongReader = new LocalDataKeyEnvelopeProvider(randomBytes(32).toString("base64url"));
  try {
    await writeFile(source, randomBytes(1024), { mode: 0o600 });
    const metadata = await encryptFile(source, encrypted, writer);
    await assert.rejects(decryptFile(encrypted, restored, metadata, wrongReader));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
