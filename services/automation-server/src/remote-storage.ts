import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient, type BlockBlobClient } from "@azure/storage-blob";
import { c as createTar, x as extractTar } from "tar";
import type { AutomationConfig } from "./config.ts";
import {
  AzureKeyVaultDataKeyEnvelopeProvider,
  decryptFile,
  encryptFile,
  type DataKeyEnvelopeProvider,
  type EncryptedFileMetadata,
} from "./profile-encryption.ts";

export type RemoteProfileVersion = {
  version: number;
  etag: string | null;
  contentSha256?: string;
  encryptedSizeBytes?: number;
  encryptionKeyId?: string;
  encryptionKeyVersion?: string;
};

export interface AutomationRemoteStorage {
  assertReady(): Promise<void>;
  restoreProfile(workspaceId: string, accountId: string, storageKey: string, targetDirectory: string): Promise<RemoteProfileVersion>;
  saveProfile(
    workspaceId: string,
    accountId: string,
    storageKey: string,
    sourceDirectory: string,
    expected: RemoteProfileVersion,
  ): Promise<RemoteProfileVersion>;
  removeProfile(workspaceId: string, accountId: string, storageKey: string): Promise<void>;
  uploadMedia(workspaceId: string, storageKey: string, sourceFile: string, mimeType: string): Promise<void>;
  downloadMedia(workspaceId: string, storageKey: string, destinationFile: string): Promise<void>;
  uploadArtifact(workspaceId: string, storageKey: string, sourceFile: string, contentType: string): Promise<void>;
  downloadArtifact(workspaceId: string, storageKey: string, destinationFile: string): Promise<void>;
}

function namespace(workspaceId: string) {
  if (!workspaceId.trim()) throw new Error("A workspace is required for remote automation storage.");
  return createHash("sha256").update(workspaceId.trim()).digest("hex").slice(0, 32);
}

function metadataValue(metadata: Record<string, string> | undefined, name: string) {
  const value = metadata?.[name];
  if (!value) throw new Error(`The encrypted browser profile is missing ${name} metadata.`);
  return value;
}

function encryptionMetadata(metadata: Record<string, string> | undefined): EncryptedFileMetadata {
  const algorithm = metadataValue(metadata, "wrapalgorithm");
  if (algorithm !== "RSA-OAEP-256" && algorithm !== "A256GCMKW") {
    throw new Error("The browser profile key wrapping algorithm is unsupported.");
  }
  return {
    format: metadataValue(metadata, "format") as EncryptedFileMetadata["format"],
    algorithm,
    keyId: Buffer.from(metadataValue(metadata, "keyid"), "base64url").toString("utf8"),
    keyVersion: metadataValue(metadata, "keyversion"),
    wrappedKey: metadataValue(metadata, "wrappedkey"),
    iv: metadataValue(metadata, "iv"),
    authenticationTag: metadataValue(metadata, "authtag"),
    encryptedSha256: metadataValue(metadata, "sha256"),
  };
}

function profileMetadata(
  encrypted: EncryptedFileMetadata,
  workspaceId: string,
  accountId: string,
  version: number,
) {
  return {
    format: encrypted.format,
    wrapalgorithm: encrypted.algorithm,
    keyid: Buffer.from(encrypted.keyId, "utf8").toString("base64url"),
    keyversion: encrypted.keyVersion,
    wrappedkey: encrypted.wrappedKey,
    iv: encrypted.iv,
    authtag: encrypted.authenticationTag,
    sha256: encrypted.encryptedSha256,
    workspace: namespace(workspaceId),
    account: createHash("sha256").update(accountId).digest("hex"),
    profileversion: String(version),
  };
}

function isStatus(error: unknown, statusCode: number) {
  return typeof error === "object" && error !== null && "statusCode" in error
    && Number((error as { statusCode?: unknown }).statusCode) === statusCode;
}

export class AzureAutomationRemoteStorage implements AutomationRemoteStorage {
  private readonly service: BlobServiceClient;

  constructor(
    private readonly config: AutomationConfig,
    private readonly envelopes: DataKeyEnvelopeProvider,
    private readonly workingRoot: string,
    credential = new DefaultAzureCredential(),
  ) {
    if (!config.azureStorageAccountUrl) throw new Error("AZURE_STORAGE_ACCOUNT_URL is required for Azure storage.");
    this.service = new BlobServiceClient(config.azureStorageAccountUrl, credential);
  }

  static fromConfig(config: AutomationConfig, workingRoot: string) {
    const credential = new DefaultAzureCredential();
    const envelopes = new AzureKeyVaultDataKeyEnvelopeProvider(
      config.azureKeyVaultUrl,
      config.azureProfileKeyName,
      credential,
    );
    return new AzureAutomationRemoteStorage(config, envelopes, workingRoot, credential);
  }

  async assertReady() {
    const containers = [
      this.config.azureProfilesContainer,
      this.config.azureMediaContainer,
      this.config.azureArtifactsContainer,
    ];
    for (const name of containers) {
      if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(name)) {
        throw new Error(`Azure Blob container name is invalid: ${name}`);
      }
      const properties = await this.service.getContainerClient(name).getProperties();
      if (properties.blobPublicAccess) {
        throw new Error(`Azure Blob container must be private: ${name}`);
      }
    }
    const testDataKey = randomBytes(32);
    try {
      const wrapped = await this.envelopes.wrap(testDataKey);
      const unwrapped = await this.envelopes.unwrap(wrapped);
      try {
        if (unwrapped.length !== testDataKey.length || !timingSafeEqual(unwrapped, testDataKey)) {
          throw new Error("Azure Key Vault did not round-trip the profile encryption test key.");
        }
      } finally {
        unwrapped.fill(0);
      }
    } finally {
      testDataKey.fill(0);
    }
  }

  async restoreProfile(workspaceId: string, accountId: string, storageKey: string, targetDirectory: string) {
    const blob = this.profileBlob(workspaceId, storageKey);
    let properties;
    try {
      properties = await blob.getProperties();
    } catch (error) {
      if (isStatus(error, 404)) return { version: 0, etag: null };
      throw error;
    }
    const metadata = properties.metadata;
    if (metadataValue(metadata, "workspace") !== namespace(workspaceId)) throw new Error("The browser profile workspace metadata is invalid.");
    if (metadataValue(metadata, "account") !== createHash("sha256").update(accountId).digest("hex")) {
      throw new Error("The browser profile account metadata is invalid.");
    }
    const version = Number(metadataValue(metadata, "profileversion"));
    if (!Number.isSafeInteger(version) || version < 1) throw new Error("The remote browser profile version is invalid.");
    const temporary = await this.temporaryDirectory("profile-restore-");
    const encryptedFile = path.join(temporary, "profile.tar.gz.encrypted");
    const archiveFile = path.join(temporary, "profile.tar.gz");
    try {
      await blob.downloadToFile(encryptedFile);
      await decryptFile(encryptedFile, archiveFile, encryptionMetadata(metadata), this.envelopes);
      await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
      await extractTar({ cwd: targetDirectory, file: archiveFile, gzip: true, strict: true, preservePaths: false });
      const encryption = encryptionMetadata(metadata);
      return {
        version,
        etag: properties.etag || null,
        contentSha256: encryption.encryptedSha256,
        encryptedSizeBytes: properties.contentLength,
        encryptionKeyId: encryption.keyId,
        encryptionKeyVersion: encryption.keyVersion,
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async saveProfile(
    workspaceId: string,
    accountId: string,
    storageKey: string,
    sourceDirectory: string,
    expected: RemoteProfileVersion,
  ) {
    const source = await stat(sourceDirectory).catch(() => null);
    if (!source?.isDirectory()) throw new Error("The browser profile directory does not exist.");
    const temporary = await this.temporaryDirectory("profile-save-");
    const archiveFile = path.join(temporary, "profile.tar.gz");
    const encryptedFile = path.join(temporary, "profile.tar.gz.encrypted");
    try {
      await createTar({
        cwd: sourceDirectory,
        file: archiveFile,
        gzip: true,
        portable: true,
        noMtime: true,
        strict: true,
      }, ["."]);
      const encrypted = await encryptFile(archiveFile, encryptedFile, this.envelopes);
      const nextVersion = expected.version + 1;
      const conditions = expected.etag ? { ifMatch: expected.etag } : { ifNoneMatch: "*" };
      let response;
      try {
        response = await this.profileBlob(workspaceId, storageKey).uploadFile(encryptedFile, {
          conditions,
          metadata: profileMetadata(encrypted, workspaceId, accountId, nextVersion),
          blobHTTPHeaders: { blobContentType: "application/octet-stream" },
        });
      } catch (error) {
        if (isStatus(error, 409) || isStatus(error, 412)) {
          throw new Error("The remote browser profile changed while this worker was using it; refusing to overwrite it.");
        }
        throw error;
      }
      return {
        version: nextVersion,
        etag: response.etag || null,
        contentSha256: encrypted.encryptedSha256,
        encryptedSizeBytes: (await stat(encryptedFile)).size,
        encryptionKeyId: encrypted.keyId,
        encryptionKeyVersion: encrypted.keyVersion,
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async removeProfile(workspaceId: string, _accountId: string, storageKey: string) {
    await this.profileBlob(workspaceId, storageKey).deleteIfExists({ deleteSnapshots: "include" });
  }

  async uploadMedia(workspaceId: string, storageKey: string, sourceFile: string, mimeType: string) {
    const blob = this.mediaBlob(workspaceId, storageKey);
    try {
      await blob.uploadFile(sourceFile, {
        conditions: { ifNoneMatch: "*" },
        metadata: { workspace: namespace(workspaceId) },
        blobHTTPHeaders: { blobContentType: mimeType },
      });
    } catch (error) {
      if (!isStatus(error, 409) && !isStatus(error, 412)) throw error;
      const [existing, local] = await Promise.all([blob.getProperties(), stat(sourceFile)]);
      if (existing.metadata?.workspace !== namespace(workspaceId)
        || existing.contentLength !== local.size
        || existing.contentType !== mimeType) {
        throw new Error("The publishing media key already belongs to different content.");
      }
    }
  }

  async downloadMedia(workspaceId: string, storageKey: string, destinationFile: string) {
    const blob = this.mediaBlob(workspaceId, storageKey);
    const properties = await blob.getProperties();
    if (properties.metadata?.workspace !== namespace(workspaceId)) throw new Error("The publishing media workspace metadata is invalid.");
    await blob.downloadToFile(destinationFile);
  }

  async uploadArtifact(workspaceId: string, storageKey: string, sourceFile: string, contentType: string) {
    await this.artifactBlob(workspaceId, storageKey).uploadFile(sourceFile, {
      metadata: { workspace: namespace(workspaceId) },
      blobHTTPHeaders: { blobContentType: contentType },
    });
  }

  async downloadArtifact(workspaceId: string, storageKey: string, destinationFile: string) {
    const blob = this.artifactBlob(workspaceId, storageKey);
    const properties = await blob.getProperties();
    if (properties.metadata?.workspace !== namespace(workspaceId)) throw new Error("The diagnostic artifact workspace metadata is invalid.");
    await blob.downloadToFile(destinationFile);
  }

  private profileBlob(workspaceId: string, storageKey: string) {
    return this.blob(this.config.azureProfilesContainer, `${namespace(workspaceId)}/${storageKey}.profile.enc`);
  }

  private mediaBlob(workspaceId: string, storageKey: string) {
    return this.blob(this.config.azureMediaContainer, `${namespace(workspaceId)}/${storageKey}`);
  }

  private artifactBlob(workspaceId: string, storageKey: string) {
    return this.blob(this.config.azureArtifactsContainer, `${namespace(workspaceId)}/${storageKey}`);
  }

  private blob(container: string, name: string): BlockBlobClient {
    return this.service.getContainerClient(container).getBlockBlobClient(name);
  }

  private async temporaryDirectory(prefix: string) {
    const root = path.join(this.workingRoot, "remote-storage");
    await mkdir(root, { recursive: true, mode: 0o700 });
    return await mkdtemp(path.join(root, prefix));
  }
}
