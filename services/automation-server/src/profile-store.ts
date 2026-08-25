import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export class AutomationFileStore {
  readonly root: string;
  readonly mediaRoot: string;
  readonly profilesRoot: string;
  readonly resultsRoot: string;
  readonly temporaryRoot: string;

  constructor(root: string) {
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
    const extensions: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "video/mp4": ".mp4",
      "video/quicktime": ".mov",
    };
    const extension = extensions[mimeType.toLowerCase()];
    if (!extension) throw new Error("This media type is not supported by the Instagram dry run.");
    const maximumBytes = mimeType.toLowerCase().startsWith("video/") ? 250 * 1024 * 1024 : 25 * 1024 * 1024;
    if (!bytes.length || bytes.length > maximumBytes) {
      throw new Error(`Local publishing media must be between 1 byte and ${maximumBytes / 1024 / 1024} MB.`);
    }
    const fileName = path.basename(originalName.trim());
    if (!fileName || fileName === "." || fileName.length > 255) throw new Error("The media filename is invalid.");
    const storageKey = `media_${randomUUID().replaceAll("-", "")}${extension}`;
    await writeFile(this.mediaFilePath(storageKey), bytes, { flag: "wx", mode: 0o600 });
    return { storageKey, fileName, mimeType: mimeType.toLowerCase(), size: bytes.length };
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
