import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type CentralJobArtifactPart = {
  index: number;
  offset: number;
  byteSize: number;
  sha256?: string;
  downloadUrl: string;
};

export type CentralJobArtifact = {
  bucket: string;
  path: string;
  fileName: string;
  mimeType?: string;
  byteSize?: number;
  sha256?: string;
  downloadUrl?: string;
  parts?: CentralJobArtifactPart[];
  expiresAt?: string;
};

function authorizedDownloadUrl(value: string, supabaseUrl: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== supabaseUrl) {
    throw new Error("The private media download URL is invalid.");
  }
  return url;
}

export function validateCentralArtifactParts(artifact: CentralJobArtifact) {
  const parts = Array.isArray(artifact.parts) ? artifact.parts : [];
  if (!parts.length || parts.length > 1000) throw new Error("The private media part list is invalid.");
  let expectedOffset = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.index !== index || part.offset !== expectedOffset || !Number.isInteger(part.byteSize) || part.byteSize < 1 || part.byteSize > 5 * 1024 * 1024) {
      throw new Error("The private media part list is invalid.");
    }
    expectedOffset += part.byteSize;
  }
  if (artifact.byteSize && expectedOffset !== artifact.byteSize) throw new Error("The private media part sizes do not match the file.");
  return parts;
}

async function fetchBytes(downloadUrl: string, supabaseUrl: string, fetchImplementation: typeof fetch) {
  const response = await fetchImplementation(authorizedDownloadUrl(downloadUrl, supabaseUrl));
  if (!response.ok) throw new Error(`Private media download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("The publishing media file is empty.");
  return bytes;
}

export async function downloadCentralArtifact({
  artifact,
  fileName,
  localPath,
  supabaseUrl,
  fetchImplementation = fetch,
}: {
  artifact: CentralJobArtifact | null | undefined;
  fileName: string;
  localPath: string;
  supabaseUrl: string;
  fetchImplementation?: typeof fetch;
}) {
  const safeName = path.basename(String(fileName || ""));
  if (!safeName || safeName !== fileName) throw new Error("The publishing media filename is invalid.");
  if (!artifact || artifact.fileName !== safeName) throw new Error("This publishing job has no authorized private media download.");
  const temporary = `${localPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  try {
    if (artifact.parts?.length) {
      const parts = validateCentralArtifactParts(artifact);
      const output = await fs.open(temporary, "wx", 0o600);
      const fullHash = createHash("sha256");
      let totalBytes = 0;
      try {
        for (const part of parts) {
          const bytes = await fetchBytes(part.downloadUrl, supabaseUrl, fetchImplementation);
          if (bytes.length !== part.byteSize) throw new Error("A private media part has the wrong size.");
          if (part.sha256 && createHash("sha256").update(bytes).digest("hex") !== part.sha256) {
            throw new Error("A private media part failed its integrity check.");
          }
          await output.writeFile(bytes);
          fullHash.update(bytes);
          totalBytes += bytes.length;
        }
      } finally {
        await output.close();
      }
      if (artifact.byteSize && totalBytes !== artifact.byteSize) throw new Error("The publishing media file has the wrong size.");
      if (artifact.sha256 && fullHash.digest("hex") !== artifact.sha256) throw new Error("The publishing media integrity check failed.");
    } else {
      if (!artifact.downloadUrl) throw new Error("This publishing job has no authorized private media download.");
      const bytes = await fetchBytes(artifact.downloadUrl, supabaseUrl, fetchImplementation);
      if (artifact.byteSize && bytes.length !== artifact.byteSize) throw new Error("The publishing media file has the wrong size.");
      if (artifact.sha256 && createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
        throw new Error("The publishing media integrity check failed.");
      }
      await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    }
    await fs.rename(temporary, localPath);
    return localPath;
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}
