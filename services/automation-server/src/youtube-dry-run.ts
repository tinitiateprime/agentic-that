import { stat } from "node:fs/promises";
import type {
  ClaimedPublishingJob,
  PublishingDryRunResult,
  PublishingDryRunValidator,
  PublishingProfileState,
} from "./executor.ts";
import type { AutomationFileStore } from "./profile-store.ts";

const TYPES = new Set(["image/jpeg", "image/png", "video/mp4", "video/quicktime"]);

export class YouTubePublishingDryRunValidator implements PublishingDryRunValidator {
  readonly platform = "youtube" as const;

  constructor(private readonly files: AutomationFileStore) {}

  async validate(
    job: ClaimedPublishingJob,
    profile: PublishingProfileState | null,
    signal: AbortSignal,
  ): Promise<PublishingDryRunResult> {
    signal.throwIfAborted();
    const checks: string[] = [];
    const issues: string[] = [];
    if (job.platform !== "youtube") issues.push("The job is not assigned to YouTube.");
    else checks.push("YouTube platform assignment is valid.");
    if (!profile?.lastSavedAt || profile.version < 1) {
      issues.push("The YouTube account does not have a verified saved browser session.");
    } else {
      checks.push(`Saved browser profile version ${profile.version} is available.`);
    }
    if (job.media.length > 1) issues.push("YouTube server publishing currently supports at most one media file.");
    if (job.caption.length > 5_000) issues.push("YouTube post text or video description must be 5,000 characters or fewer.");
    else checks.push("YouTube text is within the 5,000-character limit.");

    const media = job.media[0];
    const video = Boolean(media?.mimeType.toLowerCase().startsWith("video/"));
    if (!video && !job.caption.trim()) issues.push("YouTube Community posts require post text.");
    if (video) {
      const options = job.platformOptions.youtube;
      if (!options) {
        issues.push("YouTube videos require an explicit title, audience classification, and visibility selection.");
      } else {
        checks.push(`YouTube audience is explicitly set to ${options.audience.replaceAll("_", " ")}.`);
        checks.push(`YouTube visibility is explicitly set to ${options.visibility}.`);
      }
    }

    for (const item of job.media) {
      const type = item.mimeType.toLowerCase();
      if (!TYPES.has(type)) {
        issues.push(`${item.fileName} uses an unsupported YouTube media type.`);
        continue;
      }
      if (!await this.files.mediaFileExists(item.storageKey)) {
        issues.push(`${item.fileName} is missing from isolated server media storage.`);
        continue;
      }
      const size = (await stat(this.files.mediaFilePath(item.storageKey))).size;
      const limit = 250 * 1024 * 1024;
      if (size < 1 || size > limit) issues.push(`${item.fileName} must be between 1 byte and 250 MB.`);
      else checks.push(`${item.fileName} is present in isolated media storage.`);
    }
    checks.push("Dry-run mode has no browser launch or final-action code path.");
    return { valid: issues.length === 0, checks, issues };
  }
}
