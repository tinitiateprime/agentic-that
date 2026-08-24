import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
    await Promise.all([
      mkdir(this.mediaRoot, { recursive: true }),
      mkdir(this.profilesRoot, { recursive: true }),
      mkdir(this.resultsRoot, { recursive: true }),
      mkdir(this.temporaryRoot, { recursive: true }),
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
    await mkdir(directory, { recursive: true });
    return directory;
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
