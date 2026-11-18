// Holds one video on this computer while the AI apps try to take the whole file.
// It is private to the Companion and removed as soon as the AI apps have finished.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// The largest video any connected AI app accepts (Gemini: 2 GB).
export const MAX_STAGED_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const KEEP_UNUSED_MS = 60 * 60 * 1000;
const EXTENSIONS: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv", "video/x-msvideo": "avi" };

export type StagedVideo = { id: string; file: string; sizeBytes: number };

let current: (StagedVideo & { folder: string; timer: NodeJS.Timeout }) | null = null;

export function stagedVideoExtension(contentType = "") {
  return EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()] || null;
}

/** Forgets the video and deletes its file. */
export async function removeStagedVideo(id: string) {
  if (current?.id !== id) return;
  const { folder, timer } = current;
  clearTimeout(timer);
  current = null;
  await fsp.rm(folder, { recursive: true, force: true }).catch(() => undefined);
}

/** Saves the video, replacing any earlier one that was never used. */
export async function stageVideo(body: Readable, extension: string, signal?: AbortSignal): Promise<StagedVideo> {
  if (current) await removeStagedVideo(current.id);
  const id = randomUUID();
  const folder = path.join(os.tmpdir(), "agenticthat-social-seo", id);
  await fsp.mkdir(folder, { recursive: true });
  const file = path.join(folder, `post-video.${extension}`);
  try {
    await pipeline(body, fs.createWriteStream(file), { signal });
  } catch (error) {
    await fsp.rm(folder, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  const { size } = await fsp.stat(file);
  const timer = setTimeout(() => { void removeStagedVideo(id); }, KEEP_UNUSED_MS);
  timer.unref?.();
  current = { id, file, sizeBytes: size, folder, timer };
  return { id, file, sizeBytes: size };
}

export function stagedVideo(id: string): StagedVideo | null {
  return current?.id === id ? { id, file: current.file, sizeBytes: current.sizeBytes } : null;
}
