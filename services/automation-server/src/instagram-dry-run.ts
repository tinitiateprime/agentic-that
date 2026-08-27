import type {
  ClaimedPublishingJob,
  PublishingDryRunResult,
  PublishingDryRunValidator,
  PublishingProfileState,
} from "./executor.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import { open, stat } from "node:fs/promises";
import sharp from "sharp";
import {
  INSTAGRAM_IMAGE_INPUT_TYPES,
  instagramMediaTypeSupported,
} from "./instagram-media.ts";

const IMAGE_FORMATS: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "heif",
  "image/tiff": "tiff",
};

async function videoContainerLooksValid(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead >= 12 && header.toString("ascii", 4, 12).includes("ftyp");
  } finally {
    await handle.close();
  }
}

export class InstagramPublishingDryRunValidator implements PublishingDryRunValidator {
  readonly platform = "instagram" as const;

  constructor(private readonly files: AutomationFileStore) {}

  async validate(
    job: ClaimedPublishingJob,
    profile: PublishingProfileState | null,
    signal: AbortSignal,
  ): Promise<PublishingDryRunResult> {
    signal.throwIfAborted();
    const checks: string[] = [];
    const issues: string[] = [];

    if (job.platform !== "instagram") issues.push("The job is not assigned to Instagram.");
    else checks.push("Instagram platform assignment is valid.");

    if (!profile?.lastSavedAt || profile.version < 1) {
      issues.push("The Instagram account does not have a verified saved browser session.");
    } else {
      checks.push(`Saved browser profile version ${profile.version} is available.`);
      try {
        if (!(await stat(this.files.profileDirectory(job.accountId))).isDirectory()) {
          issues.push("The isolated Instagram browser profile directory is unavailable.");
        } else {
          checks.push("The isolated Instagram browser profile directory is available.");
        }
      } catch {
        issues.push("The isolated Instagram browser profile directory is unavailable.");
      }
    }

    if (job.caption.length > 2_200) issues.push("Instagram captions must be 2,200 characters or fewer.");
    else checks.push("Caption length is within the Instagram limit.");

    if (job.media.length < 1 || job.media.length > 10) {
      issues.push("Instagram publishing requires between 1 and 10 media files.");
    }

    for (const media of job.media) {
      signal.throwIfAborted();
      const mimeType = media.mimeType.toLowerCase();
      if (!instagramMediaTypeSupported(mimeType)) {
        issues.push(`${media.fileName} uses an unsupported Instagram media type.`);
        continue;
      }
      if (!await this.files.mediaFileExists(media.storageKey)) {
        issues.push(`${media.fileName} is missing from isolated server media storage.`);
        continue;
      }
      const filePath = this.files.mediaFilePath(media.storageKey);
      const fileStats = await stat(filePath);
      if (fileStats.size < 1) {
        issues.push(`${media.fileName} cannot be empty.`);
        continue;
      }
      if (INSTAGRAM_IMAGE_INPUT_TYPES.has(mimeType)) {
        try {
          const metadata = await sharp(filePath).metadata();
          const expectedFormat = IMAGE_FORMATS[mimeType];
          if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
            issues.push(`${media.fileName} does not match its declared image type.`);
            continue;
          }
          checks.push(`${media.fileName} is a valid ${metadata.width}x${metadata.height} ${expectedFormat.toUpperCase()} image.`);
        } catch {
          issues.push(`${media.fileName} is not a readable image.`);
          continue;
        }
      } else if (!await videoContainerLooksValid(filePath)) {
        issues.push(`${media.fileName} is not a recognizable MP4/QuickTime container.`);
        continue;
      } else {
        checks.push(`${media.fileName} has a recognizable MP4/QuickTime container.`);
      }
      checks.push(`${media.fileName} is present in isolated media storage.`);
    }

    if (job.media.length >= 1 && job.media.length <= 10 && issues.every(issue => !/media files/i.test(issue))) {
      checks.push("Instagram media count is within the supported range.");
    }
    checks.push("Dry-run mode has no browser launch or Share-button code path.");
    return { valid: issues.length === 0, checks, issues };
  }
}
