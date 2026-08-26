import { stat } from "node:fs/promises";
import type { ClaimedPublishingJob, PublishingDryRunResult, PublishingDryRunValidator, PublishingProfileState } from "./executor.ts";
import type { AutomationFileStore } from "./profile-store.ts";

const TYPES = new Set(["image/jpeg", "image/png", "video/mp4", "video/quicktime"]);

export class LinkedInPublishingDryRunValidator implements PublishingDryRunValidator {
  readonly platform = "linkedin" as const;
  constructor(private readonly files: AutomationFileStore) {}

  async validate(job: ClaimedPublishingJob, profile: PublishingProfileState | null, signal: AbortSignal): Promise<PublishingDryRunResult> {
    signal.throwIfAborted();
    const checks: string[] = [];
    const issues: string[] = [];
    if (job.platform !== "linkedin") issues.push("The job is not assigned to LinkedIn.");
    else checks.push("LinkedIn platform assignment is valid.");
    if (!profile?.lastSavedAt || profile.version < 1) issues.push("The LinkedIn account does not have a verified saved browser session.");
    else checks.push(`Saved browser profile version ${profile.version} is available.`);
    if (!job.caption.trim()) issues.push("LinkedIn requires post text.");
    if (job.caption.length > 3_000) issues.push("LinkedIn post text must be 3,000 characters or fewer.");
    else checks.push("Post text is within the LinkedIn limit.");
    if (job.media.length > 1) issues.push("LinkedIn server publishing currently supports at most one media file.");
    for (const media of job.media) {
      const type = media.mimeType.toLowerCase();
      if (!TYPES.has(type)) { issues.push(`${media.fileName} uses an unsupported LinkedIn media type.`); continue; }
      if (!await this.files.mediaFileExists(media.storageKey)) { issues.push(`${media.fileName} is missing from isolated server media storage.`); continue; }
      const size = (await stat(this.files.mediaFilePath(media.storageKey))).size;
      if (size < 1) issues.push(`${media.fileName} cannot be empty.`);
      else checks.push(`${media.fileName} is present in isolated media storage.`);
    }
    checks.push("Dry-run mode has no browser launch or Post-button code path.");
    return { valid: issues.length === 0, checks, issues };
  }
}
