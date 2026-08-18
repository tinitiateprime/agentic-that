import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { publishingUploadDirectory } from "./runtime-paths.js";

export type PublishingExecutionLease = {
  uploadId: string;
  workspaceId: string;
  token: string;
  ownerId: string;
  expiresAt: string;
  etag?: string;
};

const distributedStoreEnabled = () => (
  process.env.DATA_STORE === "netlify-blobs"
  || process.env.NETLIFY === "true"
  || Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);

function safePart(value: string) {
  const normalized = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!normalized) throw new Error("A publishing lease identifier is required.");
  return normalized;
}

function leaseKey(workspaceId: string, uploadId: string) {
  return `leases/${encodeURIComponent(workspaceId)}/${encodeURIComponent(uploadId)}`;
}

function localLeasePath(workspaceId: string, uploadId: string) {
  return path.join(publishingUploadDirectory(), ".execution-leases", `${safePart(workspaceId)}-${safePart(uploadId)}.json`);
}

export async function claimPublishingExecution(
  uploadId: string,
  workspaceId: string,
  ownerId: string,
  leaseMs = 30 * 60_000,
) {
  const lease: PublishingExecutionLease = {
    uploadId,
    workspaceId,
    ownerId,
    token: crypto.randomBytes(24).toString("base64url"),
    expiresAt: new Date(Date.now() + leaseMs).toISOString(),
  };
  if (distributedStoreEnabled()) {
    const store = getStore("agentic-that-publishing-execution-leases");
    const key = leaseKey(workspaceId, uploadId);
    const current = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    if (!current) {
      const created = await store.setJSON(key, lease, { onlyIfNew: true });
      return created.modified ? { ...lease, etag: created.etag } : null;
    }
    const expiresAt = Date.parse(String(current.data?.expiresAt || ""));
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return null;
    const replaced = await store.setJSON(key, lease, { onlyIfMatch: current.etag });
    return replaced.modified ? { ...lease, etag: replaced.etag } : null;
  }

  const filePath = localLeasePath(workspaceId, uploadId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.writeFile(filePath, JSON.stringify(lease), { flag: "wx", mode: 0o600 });
      return lease;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      const existing = await fs.readFile(filePath, "utf8").then(JSON.parse).catch(() => null);
      if (existing && Date.parse(existing.expiresAt) > Date.now()) return null;
      await fs.unlink(filePath).catch(() => undefined);
    }
  }
  return null;
}

export async function releasePublishingExecution(lease: PublishingExecutionLease) {
  if (distributedStoreEnabled()) {
    const store = getStore("agentic-that-publishing-execution-leases");
    const key = leaseKey(lease.workspaceId, lease.uploadId);
    const current = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    if (!current || current.data?.token !== lease.token) return false;
    const released = await store.setJSON(key, { ...current.data, expiresAt: new Date(0).toISOString() }, { onlyIfMatch: current.etag });
    return released.modified;
  }
  const filePath = localLeasePath(lease.workspaceId, lease.uploadId);
  const current = await fs.readFile(filePath, "utf8").then(JSON.parse).catch(() => null);
  if (!current || current.token !== lease.token) return false;
  await fs.unlink(filePath).catch(() => undefined);
  return true;
}
