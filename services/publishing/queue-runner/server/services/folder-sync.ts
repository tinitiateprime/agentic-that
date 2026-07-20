import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FolderConnection, PlatformUpload } from "../../shared/schema.js";
import {
  createUpload,
  deleteFolderConnection,
  deleteUpload,
  getFolderConnection,
  getPlatformAccount,
  listFolderConnections,
  listUploads,
  setFolderSourcePresent,
  updateFolderConnectionScan,
  updateFolderUploadFile,
  upsertFolderConnection,
} from "../local-storage.js";

type ScannedFile = {
  absolutePath: string;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  fingerprint: string;
};

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const uploadDir = resolveFromRoot(process.env.UPLOAD_DIR ?? "./uploads");
const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();
const activeSyncs = new Map<string, Promise<FolderSyncResult>>();
let periodicScanTimer: NodeJS.Timeout | null = null;

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const videoExtensions = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);

export type FolderSyncResult = {
  connectionId: string;
  added: number;
  updated: number;
  removed: number;
  retainedHistory: number;
};

function resolveFromRoot(candidate: string) {
  return path.isAbsolute(candidate) ? candidate : path.resolve(rootDir, candidate);
}

function normalizeFolderPath(folderPath: string) {
  const trimmed = folderPath.trim().replace(/^['"]|['"]$/g, "");
  if (!path.isAbsolute(trimmed)) throw new Error("Enter an absolute folder path.");
  return path.resolve(trimmed);
}

function pathsOverlap(first: string, second: string) {
  const relative = path.relative(first, second);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function extensionAllowed(extension: string) {
  return imageExtensions.has(extension) || videoExtensions.has(extension);
}

function mimeTypeFor(extension: string) {
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".m4v": "video/x-m4v",
  };
  return mimeTypes[extension] ?? "application/octet-stream";
}

function defaultPostText(fileName: string) {
  const extension = path.extname(fileName);
  return path.basename(fileName, extension).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "New post";
}

function sourceKey(relativePath: string) {
  return relativePath.replace(/\\/g, "/").toLowerCase();
}

async function scanDirectory(connection: FolderConnection) {
  const settledFiles: ScannedFile[] = [];
  let skippedUnsettledFile = false;
  const configuredSettleMs = Number(process.env.FOLDER_FILE_SETTLE_MS ?? 1500);
  const settleMs = Number.isFinite(configuredSettleMs) ? Math.max(250, configuredSettleMs) : 1500;

  async function visit(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!extensionAllowed(extension)) continue;

      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat?.isFile()) continue;
      if (Date.now() - stat.mtimeMs < settleMs) {
        skippedUnsettledFile = true;
        continue;
      }

      settledFiles.push({
        absolutePath,
        relativePath: path.relative(connection.folderPath, absolutePath).replace(/\\/g, "/"),
        originalName: entry.name,
        mimeType: mimeTypeFor(extension),
        size: stat.size,
        fingerprint: `${stat.size}:${Math.trunc(stat.mtimeMs)}`,
      });
    }
  }

  await visit(connection.folderPath);
  return { files: settledFiles, skippedUnsettledFile };
}

function internalFileName(file: ScannedFile) {
  const extension = path.extname(file.originalName).toLowerCase();
  const safeBase = path.basename(file.originalName, extension)
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "folder-post";
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}${extension}`;
}

async function removeInternalFile(upload: PlatformUpload) {
  const target = path.resolve(uploadDir, upload.fileName);
  if (!target.startsWith(`${path.resolve(uploadDir)}${path.sep}`)) return;
  await fs.unlink(target).catch(() => undefined);
}

async function syncFolderConnectionNow(connectionId: string): Promise<FolderSyncResult> {
  const connection = await getFolderConnection(connectionId);
  if (!connection) throw new Error("Folder connection not found.");

  const result: FolderSyncResult = { connectionId, added: 0, updated: 0, removed: 0, retainedHistory: 0 };

  try {
    const folderStat = await fs.stat(connection.folderPath);
    if (!folderStat.isDirectory()) throw new Error("Connected path is not a folder.");

    const { files, skippedUnsettledFile } = await scanDirectory(connection);
    const currentFiles = new Map(files.map((file) => [sourceKey(file.relativePath), file]));
    const connectedUploads = (await listUploads(connection.platform, connection.accountId))
      .filter((upload) => upload.folderSource?.connectionId === connection.id);
    const activeUploads = new Map<string, PlatformUpload>();

    for (const upload of connectedUploads) {
      if (upload.folderSource?.present) activeUploads.set(sourceKey(upload.folderSource.relativePath), upload);
    }

    await fs.mkdir(uploadDir, { recursive: true });

    for (const [key, file] of currentFiles) {
      const existing = activeUploads.get(key);

      if (!existing) {
        const fileName = internalFileName(file);
        await fs.copyFile(file.absolutePath, path.join(uploadDir, fileName));
        const caption = defaultPostText(file.originalName);
        await createUpload(connection.accountId, {
          originalName: file.originalName,
          fileName,
          mimeType: file.mimeType,
          size: file.size,
          url: `/uploads/${fileName}`,
          title: caption,
          caption,
          folderSource: {
            connectionId: connection.id,
            relativePath: file.relativePath,
            fingerprint: file.fingerprint,
            present: true,
          },
        });
        result.added += 1;
        continue;
      }

      if (existing.folderSource?.fingerprint !== file.fingerprint && ["queued", "failed"].includes(existing.status)) {
        await fs.copyFile(file.absolutePath, path.join(uploadDir, existing.fileName));
        await updateFolderUploadFile(existing.id, {
          originalName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          fingerprint: file.fingerprint,
        });
        result.updated += 1;
      }
    }

    for (const upload of activeUploads.values()) {
      if (currentFiles.has(sourceKey(upload.folderSource!.relativePath))) continue;

      if (upload.status === "queued" || upload.status === "failed") {
        await deleteUpload(upload.id);
        await removeInternalFile(upload);
        result.removed += 1;
      } else if (upload.status === "posted") {
        await setFolderSourcePresent(upload.id, false);
        result.retainedHistory += 1;
      }
    }

    await updateFolderConnectionScan(connection.id);
    if (skippedUnsettledFile) queueFolderSync(connection.id, 2000);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Folder synchronization failed.";
    await updateFolderConnectionScan(connection.id, message);
    throw error;
  }
}

export function syncFolderConnection(connectionId: string) {
  const active = activeSyncs.get(connectionId);
  if (active) return active;

  const operation = syncFolderConnectionNow(connectionId).finally(() => activeSyncs.delete(connectionId));
  activeSyncs.set(connectionId, operation);
  return operation;
}

function queueFolderSync(connectionId: string, delay = 750) {
  const existing = debounceTimers.get(connectionId);
  if (existing) clearTimeout(existing);

  debounceTimers.set(connectionId, setTimeout(() => {
    debounceTimers.delete(connectionId);
    void syncFolderConnection(connectionId).catch((error) => {
      console.error(`Folder sync failed for ${connectionId}:`, error);
    });
  }, delay));
}

async function startWatcher(connection: FolderConnection) {
  watchers.get(connection.id)?.close();

  try {
    const watcher = watch(connection.folderPath, { recursive: true }, () => queueFolderSync(connection.id));
    watcher.on("error", (error) => {
      console.error(`Folder watcher error for ${connection.folderPath}:`, error);
      void updateFolderConnectionScan(connection.id, error.message);
    });
    watchers.set(connection.id, watcher);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not watch folder.";
    await updateFolderConnectionScan(connection.id, message);
  }
}

export async function connectPlatformFolder(accountId: string, requestedPath: string) {
  const account = await getPlatformAccount(accountId);
  if (!account) throw new Error("Publishing account not found.");
  const folderPath = normalizeFolderPath(requestedPath);
  const stat = await fs.stat(folderPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("Folder path does not exist or is not accessible.");
  if (pathsOverlap(folderPath, uploadDir) || pathsOverlap(uploadDir, folderPath)) {
    throw new Error("Choose a source folder outside the application's uploads folder.");
  }

  const existingConnection = (await listFolderConnections()).find((connection) => connection.accountId === accountId);
  const existingSync = existingConnection ? activeSyncs.get(existingConnection.id) : null;
  if (existingSync) await existingSync.catch(() => undefined);

  const connection = await upsertFolderConnection(accountId, folderPath);
  await startWatcher(connection);
  const sync = await syncFolderConnection(connection.id);
  return { connection: await getFolderConnection(connection.id), sync };
}

export async function disconnectPlatformFolder(connectionId: string) {
  const connection = await getFolderConnection(connectionId);
  if (!connection) return null;

  const activeSync = activeSyncs.get(connectionId);
  if (activeSync) await activeSync.catch(() => undefined);

  watchers.get(connectionId)?.close();
  watchers.delete(connectionId);
  const debounce = debounceTimers.get(connectionId);
  if (debounce) clearTimeout(debounce);
  debounceTimers.delete(connectionId);

  const uploads = (await listUploads(connection.platform, connection.accountId))
    .filter((upload) => upload.folderSource?.connectionId === connectionId && upload.folderSource.present);

  for (const upload of uploads) {
    if (upload.status === "queued" || upload.status === "failed") {
      await deleteUpload(upload.id);
      await removeInternalFile(upload);
    } else if (upload.status === "posted") {
      await setFolderSourcePresent(upload.id, false);
    }
  }

  return deleteFolderConnection(connectionId);
}

export async function startFolderSync() {
  const connections = await listFolderConnections();
  console.log(`Folder sync active for ${connections.length} connection(s).`);

  for (const connection of connections) {
    await startWatcher(connection);
    queueFolderSync(connection.id, 0);
  }

  if (!periodicScanTimer) {
    const configuredIntervalMs = Number(process.env.FOLDER_RESCAN_MS ?? 30000);
    const intervalMs = Number.isFinite(configuredIntervalMs) ? Math.max(5000, configuredIntervalMs) : 30000;
    periodicScanTimer = setInterval(() => {
      void listFolderConnections()
        .then((latestConnections) => {
          for (const connection of latestConnections) queueFolderSync(connection.id, 0);
        })
        .catch((error) => console.error("Periodic folder rescan failed:", error));
    }, intervalMs);
  }
}
