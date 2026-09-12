import { promises as fs } from "node:fs";
import path from "node:path";
import { publishingUploadDirectory } from "./runtime-paths.ts";

const sharedMediaEnabled = () => (
  process.env.DATA_STORE === "netlify-blobs"
  || process.env.NETLIFY === "true"
  || Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);

async function netlifyBlobStore(name: string) {
  const { getStore } = await import("@netlify/blobs");
  return getStore(name);
}

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
  await storePublishingMediaBytes(fileName, workspaceId, mimeType, bytes);
  return localPath;
}

export async function storePublishingMediaBytes(fileName: string, workspaceId: string, mimeType: string, bytes: Uint8Array) {
  const safeName = safeFileName(fileName);
  const localPath = path.join(publishingUploadDirectory(), safeName);
  if (!sharedMediaEnabled()) {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, bytes, { mode: 0o600 });
    return localPath;
  }
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await (await netlifyBlobStore("agentic-that-publishing-media")).set(mediaKey(workspaceId, fileName), payload, {
    metadata: { workspaceId, fileName, mimeType },
  });
  return localPath;
}

export async function readPublishingMedia(fileName: string, workspaceId: string) {
  const safeName = safeFileName(fileName);
  if (sharedMediaEnabled()) {
    const bytes = await (await netlifyBlobStore("agentic-that-publishing-media"))
      .get(mediaKey(workspaceId, safeName), { type: "arrayBuffer" });
    if (bytes) return Buffer.from(bytes);
  }
  return fs.readFile(path.join(publishingUploadDirectory(), safeName));
}

export async function readPublishingMediaRange(fileName: string, workspaceId: string, start: number, end: number) {
  const safeName = safeFileName(fileName);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new Error("The publishing media range is invalid.");
  }
  if (sharedMediaEnabled()) {
    const bytes = await (await netlifyBlobStore("agentic-that-publishing-media"))
      .get(mediaKey(workspaceId, safeName), { type: "arrayBuffer" });
    if (bytes) {
      const range = Buffer.from(bytes).subarray(start, end + 1);
      if (range.length !== end - start + 1) throw new Error("The publishing media range is incomplete.");
      return range;
    }
  }
  const handle = await fs.open(path.join(publishingUploadDirectory(), safeName), "r");
  try {
    const buffer = Buffer.alloc(end - start + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    if (bytesRead !== buffer.length) throw new Error("The publishing media range is incomplete.");
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
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
  const bytes = await (await netlifyBlobStore("agentic-that-publishing-media"))
    .get(mediaKey(workspaceId, safeName), { type: "arrayBuffer" });
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
    await (await netlifyBlobStore("agentic-that-publishing-media"))
      .delete(mediaKey(workspaceId, safeName))
      .catch(() => undefined);
  }
}
