import sharp from "sharp";
import { storeSupabaseJobArtifact } from "./supabase-job-control.js";

const MAX_PREVIEW_INPUT_BYTES = 1_500_000;
const MAX_PREVIEW_DIMENSION = 960;
const PREVIEW_QUALITY = 72;
const PREVIEW_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function decodePublishingPreviewInput(input) {
  if (!input || typeof input !== "object") return null;
  const mimeType = String(input.mimeType || "").trim().toLowerCase();
  const base64 = String(input.base64 || "").trim();
  if (!PREVIEW_MIME_TYPES.has(mimeType) || !base64 || base64.length > Math.ceil(MAX_PREVIEW_INPUT_BYTES * 4 / 3) + 8) {
    throw new Error("The publishing preview is invalid.");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("The publishing preview is invalid.");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_PREVIEW_INPUT_BYTES) throw new Error("The publishing preview is invalid.");
  return bytes;
}

export async function optimizePublishingPreviewBytes(inputBytes) {
  const bytes = Buffer.from(inputBytes || []);
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error("The publishing preview source is invalid.");
  return sharp(bytes, { animated: false, failOn: "error", limitInputPixels: 50_000_000, pages: 1 })
    .rotate()
    .resize({
      width: MAX_PREVIEW_DIMENSION,
      height: MAX_PREVIEW_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: PREVIEW_QUALITY, effort: 3, smartSubsample: true })
    .toBuffer();
}

function privatePreviewArtifact(artifact) {
  const { downloadUrl: _downloadUrl, ...privateArtifact } = artifact;
  return privateArtifact;
}

export async function storePublishingPreview({ workspaceId, fileName, originalName, inputBytes }) {
  const bytes = await optimizePublishingPreviewBytes(inputBytes);
  const previewFileName = `${fileName}.admin-preview.webp`;
  const artifact = await storeSupabaseJobArtifact(bytes, {
    workspaceId,
    fileName: previewFileName,
    originalName: `${originalName}.preview.webp`,
    mimeType: "image/webp",
  });
  return { bytes, artifact: privatePreviewArtifact(artifact) };
}

export async function storePublishingPreviewInput({ workspaceId, fileName, originalName, preview }) {
  const inputBytes = decodePublishingPreviewInput(preview);
  if (!inputBytes) return null;
  return storePublishingPreview({ workspaceId, fileName, originalName, inputBytes });
}

export const publishingMediaPreviewTestHelpers = {
  decodePublishingPreviewInput,
  maxPreviewDimension: MAX_PREVIEW_DIMENSION,
};
