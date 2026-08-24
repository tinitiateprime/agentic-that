import { randomUUID } from "node:crypto";
import { mediaReferenceSchema, socialPlatformSchema } from "./contracts.ts";
import type {
  ClaimedPublishingJob,
  PublishingDryRunValidator,
  PublishingPreviewExecutor,
} from "./executor.ts";
import { InstagramPreviewLoginRequiredError, InstagramPreviewPreparationError } from "./instagram-preview.ts";
import type { AutomationJobStore } from "./job-store.ts";
import type { AutomationFileStore } from "./profile-store.ts";

export class AutomationPublishingPreviewWorker {
  private timer: NodeJS.Timeout | null = null;
  private activeController: AbortController | null = null;
  private activeTask: Promise<unknown> | null = null;
  private started = false;
  readonly workerId: string;

  constructor(
    private readonly store: AutomationJobStore,
    private readonly files: AutomationFileStore,
    private readonly validators: ReadonlyMap<string, PublishingDryRunValidator>,
    private readonly executors: ReadonlyMap<string, PublishingPreviewExecutor>,
    private readonly pollMs: number,
    workerId = `preview_${process.pid}_${randomUUID().replaceAll("-", "")}`,
  ) {
    this.workerId = workerId;
  }

  start() {
    if (this.started) return;
    this.started = true;
    void this.tick();
  }

  async stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.activeController?.abort(new Error("The publishing preview worker is stopping."));
    await this.activeTask?.catch(() => undefined);
  }

  async runOnce() {
    this.store.quarantineExpiredPublishingJobs();
    const claimed = this.store.claimDuePublishingJob(this.workerId, 180, "DRY_RUN", "INSTAGRAM_PREVIEW");
    if (!claimed) return null;
    if (claimed.fencingToken === null) throw new Error("The claimed preview job has no fencing token.");

    const controller = new AbortController();
    this.activeController = controller;
    const heartbeat = setInterval(() => {
      try {
        const owned = this.store.heartbeatPublishingJob(claimed.id, this.workerId, claimed.fencingToken!, 180);
        if (!owned) controller.abort(new Error("The Instagram preview lease was lost."));
      } catch (error) {
        controller.abort(error);
      }
    }, 30_000);
    heartbeat.unref();

    try {
      const platform = socialPlatformSchema.parse(claimed.platform);
      const media = mediaReferenceSchema.array().parse(claimed.media);
      const job: ClaimedPublishingJob = {
        id: claimed.id,
        workspaceId: claimed.workspaceId,
        accountId: claimed.accountId,
        platform,
        executionMode: claimed.executionMode,
        validationStage: claimed.validationStage,
        caption: claimed.caption,
        media,
        fencingToken: claimed.fencingToken,
      };
      const profile = this.store.getPublishingProfileState(job.accountId);
      const validator = this.validators.get(platform);
      const executor = this.executors.get(platform);
      const checks: string[] = [];
      const issues: string[] = [];
      let screenshotKey: string | undefined;
      let loginRequired = false;

      if (!validator) {
        issues.push(`No local validator is registered for ${platform}.`);
      } else {
        const preflight = await validator.validate(job, profile, controller.signal);
        checks.push(...preflight.checks);
        issues.push(...preflight.issues);
      }

      if (!issues.length && !executor) {
        issues.push(`No preview executor is registered for ${platform}.`);
      } else if (!issues.length && executor) {
        try {
          this.store.recordPublishingProgress(
            job.id,
            this.workerId,
            job.fencingToken,
            "Local checks passed. Starting the private Instagram browser.",
          );
          const result = await executor.prepare(job, controller.signal, message => {
            this.store.recordPublishingProgress(job.id, this.workerId, job.fencingToken, message);
          });
          checks.push(...result.checks);
          screenshotKey = await this.files.storePublishingPreview(job.id, result.screenshot);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          loginRequired = error instanceof InstagramPreviewLoginRequiredError;
          if (error instanceof InstagramPreviewPreparationError && error.diagnosticScreenshot) {
            screenshotKey = await this.files.storePublishingPreview(job.id, error.diagnosticScreenshot);
          }
          const message = error instanceof Error ? error.message : "Unknown preview error.";
          issues.push(message.slice(0, 500));
        }
      }

      if (!this.store.heartbeatPublishingJob(claimed.id, this.workerId, claimed.fencingToken, 180)) {
        throw new Error("The Instagram preview lease was lost before completion.");
      }
      return this.store.completePublishingPreview({
        jobId: claimed.id,
        workerId: this.workerId,
        fencingToken: claimed.fencingToken,
        valid: issues.length === 0 && Boolean(screenshotKey),
        checks,
        issues,
        screenshotKey,
        loginRequired,
      });
    } finally {
      clearInterval(heartbeat);
      this.activeController = null;
    }
  }

  private async tick() {
    this.activeTask = this.runOnce();
    try {
      await this.activeTask;
    } catch (error) {
      process.stderr.write(`Publishing preview worker error: ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      this.activeTask = null;
      if (this.started) {
        this.timer = setTimeout(() => { void this.tick(); }, this.pollMs);
        this.timer.unref();
      }
    }
  }
}
