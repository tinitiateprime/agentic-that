import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { CryptographyClient, KeyClient } from "@azure/keyvault-keys";

type AzureCredential = ConstructorParameters<typeof KeyClient>[1];

export type WrappedDataKey = {
  algorithm: "RSA-OAEP-256" | "A256GCMKW";
  keyId: string;
  keyVersion: string;
  wrappedKey: string;
};

export interface DataKeyEnvelopeProvider {
  wrap(dataKey: Buffer): Promise<WrappedDataKey>;
  unwrap(envelope: WrappedDataKey): Promise<Buffer>;
}

export type EncryptedFileMetadata = WrappedDataKey & {
  format: "agenticthat-aes-256-gcm-v1";
  iv: string;
  authenticationTag: string;
  encryptedSha256: string;
};

function decodeKey(value: string) {
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32) throw new Error("The local profile wrapping key must decode to exactly 32 bytes.");
  return key;
}

export class LocalDataKeyEnvelopeProvider implements DataKeyEnvelopeProvider {
  private readonly masterKey: Buffer;

  constructor(encodedMasterKey: string) {
    this.masterKey = decodeKey(encodedMasterKey);
  }

  async wrap(dataKey: Buffer): Promise<WrappedDataKey> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return {
      algorithm: "A256GCMKW",
      keyId: "local-test-only",
      keyVersion: "1",
      wrappedKey: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"),
    };
  }

  async unwrap(envelope: WrappedDataKey) {
    if (envelope.algorithm !== "A256GCMKW" || envelope.keyId !== "local-test-only") {
      throw new Error("The encrypted profile was not wrapped by this local test provider.");
    }
    const value = Buffer.from(envelope.wrappedKey, "base64url");
    if (value.length !== 60) throw new Error("The locally wrapped profile key is invalid.");
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    const key = Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]);
    if (key.length !== 32) throw new Error("The unwrapped local profile key is invalid.");
    return key;
  }
}

export class AzureKeyVaultDataKeyEnvelopeProvider implements DataKeyEnvelopeProvider {
  private readonly keys: KeyClient;

  constructor(vaultUrl: string, private readonly keyName: string, private readonly credential: AzureCredential) {
    if (!vaultUrl || !keyName) throw new Error("Azure Key Vault URL and profile key name are required.");
    this.keys = new KeyClient(vaultUrl, credential);
  }

  async wrap(dataKey: Buffer): Promise<WrappedDataKey> {
    const key = await this.keys.getKey(this.keyName);
    if (!key.id || !key.properties.version) throw new Error("Azure Key Vault returned a profile key without an id and version.");
    const result = await new CryptographyClient(key, this.credential).wrapKey("RSA-OAEP-256", dataKey);
    return {
      algorithm: "RSA-OAEP-256",
      keyId: key.id,
      keyVersion: key.properties.version,
      wrappedKey: Buffer.from(result.result).toString("base64url"),
    };
  }

  async unwrap(envelope: WrappedDataKey) {
    if (envelope.algorithm !== "RSA-OAEP-256") throw new Error("The production profile key uses an unsupported wrapping algorithm.");
    const key = await this.keys.getKey(this.keyName, { version: envelope.keyVersion });
    if (key.id !== envelope.keyId) throw new Error("The profile encryption key id does not match the configured Key Vault key.");
    const result = await new CryptographyClient(key, this.credential).unwrapKey(
      "RSA-OAEP-256",
      Buffer.from(envelope.wrappedKey, "base64url"),
    );
    const dataKey = Buffer.from(result.result);
    if (dataKey.length !== 32) throw new Error("Azure Key Vault returned an invalid profile data key.");
    return dataKey;
  }
}

async function sha256File(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function encryptFile(
  sourceFile: string,
  destinationFile: string,
  envelopes: DataKeyEnvelopeProvider,
): Promise<EncryptedFileMetadata> {
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  try {
    await pipeline(createReadStream(sourceFile), cipher, createWriteStream(destinationFile, { mode: 0o600 }));
    const wrapped = await envelopes.wrap(dataKey);
    return {
      format: "agenticthat-aes-256-gcm-v1",
      iv: iv.toString("base64url"),
      authenticationTag: cipher.getAuthTag().toString("base64url"),
      encryptedSha256: await sha256File(destinationFile),
      ...wrapped,
    };
  } finally {
    dataKey.fill(0);
  }
}

export async function decryptFile(
  sourceFile: string,
  destinationFile: string,
  metadata: EncryptedFileMetadata,
  envelopes: DataKeyEnvelopeProvider,
) {
  if (metadata.format !== "agenticthat-aes-256-gcm-v1") throw new Error("The encrypted profile format is unsupported.");
  const actualHash = await sha256File(sourceFile);
  if (actualHash !== metadata.encryptedSha256) throw new Error("The encrypted profile failed its integrity checksum.");
  const dataKey = await envelopes.unwrap(metadata);
  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(metadata.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(metadata.authenticationTag, "base64url"));
    await pipeline(createReadStream(sourceFile), decipher, createWriteStream(destinationFile, { mode: 0o600 }));
  } finally {
    dataKey.fill(0);
  }
}

export async function verifyEncryptedFile(file: string, metadata: EncryptedFileMetadata) {
  return (await sha256File(file)) === metadata.encryptedSha256;
}

export async function loadLocalEnvelopeProvider(keyFile: string) {
  const encoded = (await readFile(keyFile, "utf8")).trim();
  return new LocalDataKeyEnvelopeProvider(encoded);
}
