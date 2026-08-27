import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import type { ClaimedPublishingJob } from "./executor.ts";
import type { AutomationFileStore } from "./profile-store.ts";

export const INSTAGRAM_IMAGE_INPUT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/tiff",
]);

export const INSTAGRAM_VIDEO_INPUT_TYPES = new Set(["video/mp4", "video/quicktime"]);

export function instagramMediaTypeSupported(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  return INSTAGRAM_IMAGE_INPUT_TYPES.has(normalized) || INSTAGRAM_VIDEO_INPUT_TYPES.has(normalized);
}

export function originalInstagramMediaPaths(
  files: AutomationFileStore,
  job: Pick<ClaimedPublishingJob, "media">,
) {
  return job.media.map(media => {
    if (!instagramMediaTypeSupported(media.mimeType)) {
      throw new Error(`${media.fileName} uses an unsupported Instagram media type.`);
    }
    return files.mediaFilePath(media.storageKey);
  });
}

type PreparedInstagramMedia = {
  paths: string[];
  normalizedImages: number;
  cleanup: () => Promise<void>;
};

const MAX_OUTPUT_EDGE = 2_160;
const MIN_FEED_ASPECT_RATIO = 4 / 5;
const MAX_FEED_ASPECT_RATIO = 1.91;

function orientedDimensions(metadata: Metadata) {
  const width = metadata.width || 0;
  const height = metadata.pageHeight || metadata.height || 0;
  if (!width || !height) throw new Error("The image has no readable dimensions.");
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

function instagramCanvas(width: number, height: number) {
  const ratio = width / height;
  if (ratio > MAX_FEED_ASPECT_RATIO) {
    return { width, height: Math.ceil(width / MAX_FEED_ASPECT_RATIO) };
  }
  if (ratio < MIN_FEED_ASPECT_RATIO) {
    return { width: Math.ceil(height * MIN_FEED_ASPECT_RATIO), height };
  }
  return { width, height };
}

/**
 * Creates a compatibility fallback only after Instagram rejects the original
 * still image. Out-of-range shapes are padded, never cropped, so the complete
 * user image remains visible. Videos keep their original paths.
 */
export async function prepareInstagramFallbackMedia(
  files: AutomationFileStore,
  job: Pick<ClaimedPublishingJob, "media">,
): Promise<PreparedInstagramMedia> {
  const temporaryDirectory = await mkdtemp(path.join(files.temporaryRoot, "instagram-media-"));
  const preparedPaths: string[] = [];
  let normalizedImages = 0;
  try {
    for (const [index, media] of job.media.entries()) {
      const mimeType = media.mimeType.toLowerCase();
      const sourcePath = files.mediaFilePath(media.storageKey);
      if (INSTAGRAM_VIDEO_INPUT_TYPES.has(mimeType)) {
        preparedPaths.push(sourcePath);
        continue;
      }
      if (!INSTAGRAM_IMAGE_INPUT_TYPES.has(mimeType)) {
        throw new Error(`${media.fileName} uses an unsupported Instagram media type.`);
      }

      const source = sharp(sourcePath, { animated: false, failOn: "error", pages: 1 });
      const metadata = await source.metadata();
      const oriented = orientedDimensions(metadata);
      const scaled = scaledDimensions(oriented.width, oriented.height);
      const canvas = instagramCanvas(scaled.width, scaled.height);
      const left = Math.floor((canvas.width - scaled.width) / 2);
      const right = canvas.width - scaled.width - left;
      const top = Math.floor((canvas.height - scaled.height) / 2);
      const bottom = canvas.height - scaled.height - top;
      const destinationPath = path.join(temporaryDirectory, `item-${index + 1}.jpg`);

      await sharp(sourcePath, { animated: false, failOn: "error", pages: 1 })
        .rotate()
        .resize({
          width: scaled.width,
          height: scaled.height,
          fit: "fill",
          withoutEnlargement: true,
        })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .extend({
          top,
          bottom,
          left,
          right,
          background: { r: 255, g: 255, b: 255 },
        })
        .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toFile(destinationPath);
      preparedPaths.push(destinationPath);
      normalizedImages += 1;
    }
    return {
      paths: preparedPaths,
      normalizedImages,
      cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
