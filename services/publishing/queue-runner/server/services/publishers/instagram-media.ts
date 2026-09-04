import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";

export const INSTAGRAM_IMAGE_INPUT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/tiff",
]);

const MAX_OUTPUT_EDGE = 2_160;
const MIN_FEED_ASPECT_RATIO = 4 / 5;
const MAX_FEED_ASPECT_RATIO = 1.91;

function orientedDimensions(metadata: Metadata) {
  const width = metadata.width || 0;
  const height = metadata.pageHeight || metadata.height || 0;
  if (!width || !height) throw new Error("The Instagram image has no readable dimensions.");
  return metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

function scaledDimensions(width: number, height: number) {
  const scale = Math.min(1, MAX_OUTPUT_EDGE / width, MAX_OUTPUT_EDGE / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function instagramImageCanvas(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("The Instagram image has no readable dimensions.");
  }
  const ratio = width / height;
  if (ratio > MAX_FEED_ASPECT_RATIO) return { width, height: Math.ceil(width / MAX_FEED_ASPECT_RATIO) };
  if (ratio < MIN_FEED_ASPECT_RATIO) return { width: Math.ceil(height * MIN_FEED_ASPECT_RATIO), height };
  return { width, height };
}

export async function prepareInstagramMedia(filePath: string, mimeType: string) {
  const normalizedMimeType = String(mimeType || "").toLowerCase();
  if (normalizedMimeType.startsWith("video/")) {
    return { filePath, normalized: false, cleanup: async () => {} };
  }
  if (!INSTAGRAM_IMAGE_INPUT_TYPES.has(normalizedMimeType) && !normalizedMimeType.startsWith("image/")) {
    throw new Error("Instagram needs a supported image or video file.");
  }

  const source = sharp(filePath, { animated: false, failOn: "error", pages: 1 });
  const metadata = await source.metadata();
  const oriented = orientedDimensions(metadata);
  const scaled = scaledDimensions(oriented.width, oriented.height);
  const canvas = instagramImageCanvas(scaled.width, scaled.height);
  const keepsOriginalFormat = normalizedMimeType === "image/jpeg" || normalizedMimeType === "image/png";
  const needsResize = scaled.width !== oriented.width || scaled.height !== oriented.height;
  const needsPadding = canvas.width !== scaled.width || canvas.height !== scaled.height;
  if (keepsOriginalFormat && !needsResize && !needsPadding) {
    return { filePath, normalized: false, cleanup: async () => {} };
  }

  const temporaryDirectory = await mkdtemp(path.join(path.dirname(filePath), ".instagram-media-"));
  const destinationPath = path.join(temporaryDirectory, "instagram-ready.jpg");
  try {
    const left = Math.floor((canvas.width - scaled.width) / 2);
    const right = canvas.width - scaled.width - left;
    const top = Math.floor((canvas.height - scaled.height) / 2);
    const bottom = canvas.height - scaled.height - top;
    await sharp(filePath, { animated: false, failOn: "error", pages: 1 })
      .rotate()
      .resize({
        width: scaled.width,
        height: scaled.height,
        fit: "fill",
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .extend({ top, bottom, left, right, background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toFile(destinationPath);
    return {
      filePath: destinationPath,
      normalized: true,
      cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
