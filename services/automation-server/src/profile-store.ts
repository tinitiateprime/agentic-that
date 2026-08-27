import { createHash, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type DevelopmentMediaUpload = {
  id: string;
  workspaceId: string;
  fileName: string;
  mimeType: string;
  extension: string;
  declaredSize: number;
  receivedSize: number;
  partKey: string;
  writing: boolean;
  touchedAt: number;
};

const MEDIA_UPLOAD_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
const MEDIA_UPLOAD_EXPIRY_MS = 60 * 60_000;

export class AutomationFileStore {
  readonly root: string;
  readonly mediaRoot: string;
  readonly profilesRoot: string;
  readonly resultsRoot: string;
  readonly temporaryRoot: string;
  private readonly mediaUploads = new Map<string, DevelopmentMediaUpload>();

  constructor(root: string, readonly mediaUploadMaxBytes = 10 * 1024 * 1024 * 1024) {
    this.root = path.resolve(root);
    this.mediaRoot = path.join(this.root, "media");
    this.profilesRoot = path.join(this.root, "profiles");
    this.resultsRoot = path.join(this.root, "scraping-results");
    this.temporaryRoot = path.join(this.root, "temporary");
  }

  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await Promise.all([
      mkdir(this.mediaRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.profilesRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.resultsRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.temporaryRoot, { recursive: true, mode: 0o700 }),
    ]);
    await Promise.all([
      chmod(this.root, 0o700),
      chmod(this.mediaRoot, 0o700),
      chmod(this.profilesRoot, 0o700),
      chmod(this.resultsRoot, 0o700),
      chmod(this.temporaryRoot, 0o700),
    ]);
    const mediaEntries = await readdir(this.mediaRoot).catch(() => []);
    await Promise.all(mediaEntries
      .filter(entry => /^upload_[a-f0-9]{32}[.]part$/.test(entry))
      .map(entry => rm(this.mediaFilePath(entry), { force: true })));
  }

  profileStorageKey(accountId: string) {
    if (!accountId.trim()) throw new Error("An account id is required for profile storage.");
    return `profile_${createHash("sha256").update(accountId).digest("hex").slice(0, 32)}`;
  }

  profileDirectory(accountId: string) {
    return this.inside(this.profilesRoot, this.profileStorageKey(accountId));
  }

  async ensureDevelopmentProfile(accountId: string) {
    const directory = this.profileDirectory(accountId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    return directory;
  }

  async removeDevelopmentProfile(accountId: string) {
    const directory = this.profileDirectory(accountId);
    if (directory === this.profilesRoot) throw new Error("Refusing to remove the profiles root.");
    await rm(directory, { recursive: true, force: true });
  }

  mediaFilePath(storageKey: string) {
    const key = storageKey.trim();
    if (!key || path.basename(key) !== key || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(key)) {
      throw new Error("The media storage key is invalid.");
    }
    return this.inside(this.mediaRoot, key);
  }

  async mediaFileExists(storageKey: string) {
    try {
      return (await stat(this.mediaFilePath(storageKey))).isFile();
    } catch {
      return false;
    }
  }

  async storeDevelopmentMedia(bytes: Buffer, originalName: string, mimeType: string) {
    const { extension, fileName, normalizedMimeType } = this.mediaMetadata(originalName, mimeType);
    if (!bytes.length || bytes.length > this.mediaUploadMaxBytes) {
      throw new Error(`Publishing media must be between 1 byte and the configured server storage ceiling.`);
    }
    const storageKey = `media_${randomUUID().replaceAll("-", "")}${extension}`;
    await writeFile(this.mediaFilePath(storageKey), bytes, { flag: "wx", mode: 0o600 });
    return { storageKey, fileName, mimeType: normalizedMimeType, size: bytes.length };
  }

  async beginDevelopmentMediaUpload(workspaceId: string, originalName: string, mimeType: string, declaredSize: number) {
    if (!workspaceId.trim()) throw new Error("A workspace is required for media upload.");
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > this.mediaUploadMaxBytes) {
      throw new Error("The file is empty or exceeds this server's configured storage ceiling.");
    }
    await this.pruneExpiredMediaUploads();
    const { extension, fileName, normalizedMimeType } = this.mediaMetadata(originalName, mimeType);
    const id = `upload_${randomUUID().replaceAll("-", "")}`;
    const partKey = `${id}.part`;
    await writeFile(this.mediaFilePath(partKey), Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    this.mediaUploads.set(id, {
      id,
      workspaceId: workspaceId.trim(),
      fileName,
      mimeType: normalizedMimeType,
      extension,
      declaredSize,
      receivedSize: 0,
      partKey,
      writing: false,
      touchedAt: Date.now(),
    });
    return { uploadId: id, chunkSize: MEDIA_UPLOAD_CHUNK_MAX_BYTES };
  }

  async appendDevelopmentMediaUpload(workspaceId: string, uploadId: string, offset: number, bytes: Buffer) {
    const upload = this.requireMediaUpload(workspaceId, uploadId);
    if (upload.writing) throw new Error("A chunk is already being written for this upload.");
    if (!bytes.length || bytes.length > MEDIA_UPLOAD_CHUNK_MAX_BYTES) {
      throw new Error("The media upload chunk is empty or too large.");
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > upload.receivedSize) {
      throw new Error(`Upload offset mismatch; expected ${upload.receivedSize}.`);
    }
    // A remote response can be lost after the bytes reached disk. Accept an
    // exact repeat of an already-written chunk so client retries are safe.
    if (offset < upload.receivedSize) {
      if (offset + bytes.length > upload.receivedSize) {
        throw new Error(`Upload offset mismatch; expected ${upload.receivedSize}.`);
      }
      const existing = Buffer.alloc(bytes.length);
      const handle = await open(this.mediaFilePath(upload.partKey), "r");
      try {
        const { bytesRead } = await handle.read(existing, 0, existing.length, offset);
        if (bytesRead === bytes.length && existing.equals(bytes)) {
          upload.touchedAt = Date.now();
          return { received: upload.receivedSize, size: upload.declaredSize };
        }
      } finally {
        await handle.close();
      }
      throw new Error(`Upload offset mismatch; expected ${upload.receivedSize}.`);
    }
    if (upload.receivedSize + bytes.length > upload.declaredSize) {
      throw new Error("The media upload chunk exceeds the declared file size.");
    }
    upload.writing = true;
    try {
      await appendFile(this.mediaFilePath(upload.partKey), bytes);
      upload.receivedSize += bytes.length;
      upload.touchedAt = Date.now();
      return { received: upload.receivedSize, size: upload.declaredSize };
    } finally {
      upload.writing = false;
    }
  }

  async completeDevelopmentMediaUpload(workspaceId: string, uploadId: string) {
    const upload = this.requireMediaUpload(workspaceId, uploadId);
    if (upload.writing || upload.receivedSize !== upload.declaredSize) {
      throw new Error(`Media upload is incomplete; received ${upload.receivedSize} of ${upload.declaredSize} bytes.`);
    }
    const partPath = this.mediaFilePath(upload.partKey);
    const actualSize = (await stat(partPath)).size;
    if (actualSize !== upload.declaredSize) throw new Error("The staged media size does not match the declared file size.");
    const storageKey = `media_${randomUUID().replaceAll("-", "")}${upload.extension}`;
    await rename(partPath, this.mediaFilePath(storageKey));
    this.mediaUploads.delete(upload.id);
    return { storageKey, fileName: upload.fileName, mimeType: upload.mimeType, size: actualSize };
  }

  async cancelDevelopmentMediaUpload(workspaceId: string, uploadId: string) {
    const upload = this.requireMediaUpload(workspaceId, uploadId);
    this.mediaUploads.delete(upload.id);
    await rm(this.mediaFilePath(upload.partKey), { force: true });
  }

  private mediaMetadata(originalName: string, mimeType: string) {
    const extensions: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/avif": ".avif",
      "image/tiff": ".tiff",
      "video/mp4": ".mp4",
      "video/quicktime": ".mov",
    };
    const normalizedMimeType = mimeType.toLowerCase();
    const extension = extensions[normalizedMimeType];
    if (!extension) throw new Error("Choose a JPEG, PNG, WebP, GIF, AVIF, TIFF, MP4, or MOV file.");
    const fileName = path.basename(originalName.trim());
    if (!fileName || fileName === "." || fileName.length > 255) throw new Error("The media filename is invalid.");
    return { extension, fileName, normalizedMimeType };
  }

  private requireMediaUpload(workspaceId: string, uploadId: string) {
    const upload = this.mediaUploads.get(uploadId.trim());
    if (!upload || upload.workspaceId !== workspaceId.trim()) throw new Error("Media upload was not found for this workspace.");
    return upload;
  }

  private async pruneExpiredMediaUploads() {
    const expired = [...this.mediaUploads.values()].filter(upload => Date.now() - upload.touchedAt > MEDIA_UPLOAD_EXPIRY_MS && !upload.writing);
    for (const upload of expired) {
      this.mediaUploads.delete(upload.id);
      await rm(this.mediaFilePath(upload.partKey), { force: true });
    }
  }

  publishingPreviewStorageKey(jobId: string) {
    if (!jobId.trim()) throw new Error("A job id is required for preview storage.");
    return `preview_${createHash("sha256").update(jobId).digest("hex").slice(0, 32)}.jpg`;
  }

  publishingPreviewPath(jobId: string) {
    return this.inside(this.resultsRoot, this.publishingPreviewStorageKey(jobId));
  }

  async storePublishingPreview(jobId: string, screenshot: Buffer) {
    if (!screenshot.length || screenshot.length > 10 * 1024 * 1024) {
      throw new Error("The publishing preview screenshot must be between 1 byte and 10 MB.");
    }
    const storageKey = this.publishingPreviewStorageKey(jobId);
    await writeFile(this.publishingPreviewPath(jobId), screenshot, { mode: 0o600 });
    return storageKey;
  }

  async readPublishingPreview(jobId: string) {
    return readFile(this.publishingPreviewPath(jobId));
  }

  async createTemporaryScrapingDirectory() {
    await mkdir(this.temporaryRoot, { recursive: true });
    return mkdtemp(path.join(this.temporaryRoot, "scrape-"));
  }

  async removeTemporaryDirectory(directory: string) {
    const safeDirectory = this.inside(this.temporaryRoot, path.relative(this.temporaryRoot, path.resolve(directory)));
    if (safeDirectory === this.temporaryRoot) throw new Error("Refusing to remove the temporary storage root.");
    await rm(safeDirectory, { recursive: true, force: true });
  }

  private inside(root: string, child: string) {
    const resolvedRoot = path.resolve(root);
    const resolvedChild = path.resolve(root, child);
    const relative = path.relative(resolvedRoot, resolvedChild);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      if (!relative && resolvedChild === resolvedRoot) return resolvedRoot;
      throw new Error("The requested storage path is outside the server data directory.");
    }
    return resolvedChild;
  }
}
