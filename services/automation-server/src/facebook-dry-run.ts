import { stat } from "node:fs/promises";
import type { PublishingDryRunResult, PublishingDryRunValidator, PublishingProfileState, ClaimedPublishingJob } from "./executor.ts";
import type { AutomationFileStore } from "./profile-store.ts";

const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "video/mp4", "video/quicktime"]);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

export class FacebookPublishingDryRunValidator implements PublishingDryRunValidator {
  readonly platform = "facebook" as const;

  constructor(private readonly files: AutomationFileStore) {}

  async validate(job: ClaimedPublishingJob, profile: PublishingProfileState | null, signal: AbortSignal): Promise<PublishingDryRunResult> {
    signal.throwIfAborted();
    const checks: string[] = [];
    const issues: string[] = [];
    if (job.platform !== "facebook") issues.push("The job is not assigned to Facebook.");
    else checks.push("Facebook platform assignment is valid.");
    if (!profile?.lastSavedAt || profile.version < 1) issues.push("The Facebook account does not have a verified saved browser session.");
    else checks.push(`Saved browser profile version ${profile.version} is available.`);
    if (!job.caption.trim() && !job.media.length) issues.push("Facebook requires post text or media.");
    if (job.media.length > 1) issues.push("Initial Facebook server publishing supports at most one media file.");
    for (const media of job.media) {
      signal.throwIfAborted();
      const mimeType = media.mimeType.toLowerCase();
      if (!SUPPORTED_MEDIA_TYPES.has(mimeType)) {
        issues.push(`${media.fileName} uses an unsupported Facebook media type.`);
        continue;
      }
      if (!await this.files.mediaFileExists(media.storageKey)) {
        issues.push(`${media.fileName} is missing from isolated server media storage.`);
        continue;
      }
      const size = (await stat(this.files.mediaFilePath(media.storageKey))).size;
      const limit = mimeType.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (size < 1 || size > limit) issues.push(`${media.fileName} must be between 1 byte and ${limit / 1024 / 1024} MB.`);
      else checks.push(`${media.fileName} is present in isolated media storage.`);
    }
    checks.push("Dry-run mode has no browser launch or Post-button code path.");
    return { valid: issues.length === 0, checks, issues };
  }
}
