import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";

export const YOUTUBE_COMMUNITY_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const YOUTUBE_COMMUNITY_IMAGE_OPTIMIZE_BYTES = 8 * 1024 * 1024;
const YOUTUBE_COMMUNITY_IMAGE_MAX_EDGE = 2_560;

export const YOUTUBE_COMMUNITY_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function orientedDimensions(metadata: Metadata) {
  const width = metadata.width || 0;
  const height = metadata.pageHeight || metadata.height || 0;
  if (!width || !height) throw new Error("The YouTube Community image has no readable dimensions.");
  return metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

export function youtubeCommunityImageNeedsOptimization(byteSize: number, width: number, height: number) {
  return byteSize > YOUTUBE_COMMUNITY_IMAGE_OPTIMIZE_BYTES
    || width > YOUTUBE_COMMUNITY_IMAGE_MAX_EDGE
    || height > YOUTUBE_COMMUNITY_IMAGE_MAX_EDGE;
}

export function youtubeCommunityImagePreviewTimeout(byteSize: number) {
  const megabytes = Math.max(1, Math.ceil(byteSize / (1024 * 1024)));
  return Math.min(240_000, Math.max(90_000, 60_000 + (megabytes * 12_000)));
}

export async function prepareYouTubeCommunityMedia(filePath: string, mimeType: string) {
  const normalizedMimeType = String(mimeType || "").toLowerCase();
  if (!YOUTUBE_COMMUNITY_IMAGE_TYPES.has(normalizedMimeType)) {
    throw new Error("YouTube Community posts need a JPG, PNG, GIF, or WEBP image.");
  }

  const sourceStats = await stat(filePath);
  if (!sourceStats.isFile()) throw new Error("The YouTube Community image is not a file.");
  if (sourceStats.size > YOUTUBE_COMMUNITY_IMAGE_MAX_BYTES) {
    throw new Error("YouTube Community images must be 16 MB or smaller.");
  }

  const metadata = await sharp(filePath, { animated: normalizedMimeType === "image/gif", failOn: "error" }).metadata();
  const dimensions = orientedDimensions(metadata);
  const shouldOptimize = normalizedMimeType !== "image/gif"
    && youtubeCommunityImageNeedsOptimization(sourceStats.size, dimensions.width, dimensions.height);
  if (!shouldOptimize) {
    return {
      filePath,
      normalized: false,
      byteSize: sourceStats.size,
      sourceByteSize: sourceStats.size,
      width: dimensions.width,
      height: dimensions.height,
      cleanup: async () => {},
    };
  }

  const temporaryDirectory = await mkdtemp(path.join(path.dirname(filePath), ".youtube-community-media-"));
  const destinationPath = path.join(temporaryDirectory, "youtube-community-ready.jpg");
  try {
    const result = await sharp(filePath, { animated: false, failOn: "error", pages: 1 })
      .rotate()
      .resize({
        width: YOUTUBE_COMMUNITY_IMAGE_MAX_EDGE,
        height: YOUTUBE_COMMUNITY_IMAGE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toFile(destinationPath);
    const outputStats = await stat(destinationPath);
    return {
      filePath: destinationPath,
      normalized: true,
      byteSize: outputStats.size,
      sourceByteSize: sourceStats.size,
      width: result.width,
      height: result.height,
      cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
