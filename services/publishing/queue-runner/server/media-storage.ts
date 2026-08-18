import { promises as fs } from "node:fs";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { publishingUploadDirectory } from "./runtime-paths.js";

const sharedMediaEnabled = () => (
  process.env.DATA_STORE === "netlify-blobs"
  || process.env.NETLIFY === "true"
  || Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);

function safeFileName(fileName: string) {
  const base = path.basename(String(fileName || ""));
  if (!base || base !== fileName) throw new Error("The publishing media filename is invalid.");
  return base;
}

function mediaKey(workspaceId: string, fileName: string) {
  return `workspaces/${encodeURIComponent(workspaceId)}/media/${encodeURIComponent(safeFileName(fileName))}`;
}

export async function storePublishingMedia(fileName: string, workspaceId: string, mimeType: string) {
  const localPath = path.join(publishingUploadDirectory(), safeFileName(fileName));
  if (!sharedMediaEnabled()) return localPath;
  const bytes = await fs.readFile(localPath);
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await getStore("agentic-that-publishing-media").set(mediaKey(workspaceId, fileName), payload, {
    metadata: { workspaceId, fileName, mimeType },
  });
  return localPath;
}

export async function readPublishingMedia(fileName: string, workspaceId: string) {
  const safeName = safeFileName(fileName);
  if (sharedMediaEnabled()) {
    const bytes = await getStore("agentic-that-publishing-media").get(mediaKey(workspaceId, safeName), { type: "arrayBuffer" });
    if (bytes) return Buffer.from(bytes);
  }
  return fs.readFile(path.join(publishingUploadDirectory(), safeName));
}

export async function ensurePublishingMediaLocal(fileName: string, workspaceId: string) {
  const safeName = safeFileName(fileName);
  const localPath = path.join(publishingUploadDirectory(), safeName);
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    if (!sharedMediaEnabled()) throw new Error(`Publishing media ${safeName} is missing.`);
  }
  const bytes = await getStore("agentic-that-publishing-media").get(mediaKey(workspaceId, safeName), { type: "arrayBuffer" });
  if (!bytes) throw new Error(`Publishing media ${safeName} is missing from shared storage.`);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  const temporary = `${localPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, Buffer.from(bytes), { flag: "wx", mode: 0o600 });
  await fs.rename(temporary, localPath).catch(async (error) => {
    await fs.unlink(temporary).catch(() => undefined);
    try { await fs.access(localPath); } catch { throw error; }
  });
  return localPath;
}

export async function deletePublishingMedia(fileName: string, workspaceId: string) {
  const safeName = safeFileName(fileName);
  await fs.unlink(path.join(publishingUploadDirectory(), safeName)).catch(() => undefined);
  if (sharedMediaEnabled()) {
    await getStore("agentic-that-publishing-media").delete(mediaKey(workspaceId, safeName)).catch(() => undefined);
  }
}
