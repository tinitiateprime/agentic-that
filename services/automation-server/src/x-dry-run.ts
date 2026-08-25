import { stat } from "node:fs/promises";
import type { ClaimedPublishingJob, PublishingDryRunResult, PublishingDryRunValidator, PublishingProfileState } from "./executor.ts";
import type { AutomationFileStore } from "./profile-store.ts";

const TYPES = new Set(["image/jpeg", "image/png", "video/mp4", "video/quicktime"]);

export class XPublishingDryRunValidator implements PublishingDryRunValidator {
  readonly platform = "x" as const;
  constructor(private readonly files: AutomationFileStore) {}

  async validate(job: ClaimedPublishingJob, profile: PublishingProfileState | null, signal: AbortSignal): Promise<PublishingDryRunResult> {
    signal.throwIfAborted();
    const checks: string[] = [];
    const issues: string[] = [];
    if (job.platform !== "x") issues.push("The job is not assigned to X.");
    else checks.push("X platform assignment is valid.");
    if (!profile?.lastSavedAt || profile.version < 1) issues.push("The X account does not have a verified saved browser session.");
    else checks.push(`Saved browser profile version ${profile.version} is available.`);
    if (!job.caption.trim()) issues.push("X requires post text.");
    if (job.caption.length > 280) issues.push("X posts must be 280 characters or fewer for the standard server workflow.");
    else checks.push("Post text is within the standard X limit.");
    if (job.media.length > 1) issues.push("Initial X server publishing supports at most one media file.");
    for (const media of job.media) {
      const type = media.mimeType.toLowerCase();
      if (!TYPES.has(type)) { issues.push(`${media.fileName} uses an unsupported X media type.`); continue; }
      if (!await this.files.mediaFileExists(media.storageKey)) { issues.push(`${media.fileName} is missing from isolated server media storage.`); continue; }
      const size = (await stat(this.files.mediaFilePath(media.storageKey))).size;
      const limit = type.startsWith("video/") ? 250 * 1024 * 1024 : 25 * 1024 * 1024;
      if (size < 1 || size > limit) issues.push(`${media.fileName} must be between 1 byte and ${limit / 1024 / 1024} MB.`);
      else checks.push(`${media.fileName} is present in isolated media storage.`);
    }
    checks.push("Dry-run mode has no browser launch or Post-button code path.");
    return { valid: issues.length === 0, checks, issues };
  }
}
