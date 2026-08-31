import { randomUUID } from "node:crypto";
import { mediaReferenceSchema, publishingPlatformOptionsSchema, socialPlatformSchema } from "./contracts.ts";
import type {
  ClaimedPublishingJob,
  PublishingDryRunValidator,
  PublishingPreviewExecutor,
} from "./executor.ts";
import { InstagramPreviewLoginRequiredError, InstagramPreviewPreparationError } from "./instagram-preview.ts";
import type { AutomationJobStoreContract } from "./store-contracts.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import { operationalLog } from "./operational-log.ts";

export class AutomationPublishingPreviewWorker {
  private timer: NodeJS.Timeout | null = null;
  private activeController: AbortController | null = null;
  private activeTask: Promise<unknown> | null = null;
  private started = false;
  readonly workerId: string;

  constructor(
    private readonly store: AutomationJobStoreContract,
    private readonly files: AutomationFileStore,
    private readonly validators: ReadonlyMap<string, PublishingDryRunValidator>,
    private readonly executors: ReadonlyMap<string, PublishingPreviewExecutor>,
    private readonly pollMs: number,
    workerId = `preview_${process.pid}_${randomUUID().replaceAll("-", "")}`,
    private readonly jobTimeoutMs = 15 * 60_000,
    private readonly shutdownGraceMs = 120_000,
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
    const task = this.activeTask;
    if (!task) return;
    let completed = false;
    let graceTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      task.catch(() => undefined).then(() => { completed = true; }),
      new Promise<void>(resolve => { graceTimer = setTimeout(resolve, this.shutdownGraceMs); }),
    ]);
    if (graceTimer) clearTimeout(graceTimer);
    if (!completed) this.activeController?.abort(new Error("The publishing preview worker exceeded its shutdown grace period."));
    await task.catch(() => undefined);
  }

  async runOnce() {
    await this.store.quarantineExpiredPublishingJobs();
    const claimed = await this.store.claimDuePublishingJob(this.workerId, 180, "DRY_RUN", "INSTAGRAM_PREVIEW");
    if (!claimed) return null;
    if (claimed.fencingToken === null) throw new Error("The claimed preview job has no fencing token.");

    const controller = new AbortController();
    this.activeController = controller;
    const deadline = setTimeout(() => controller.abort(new Error("The publishing preview exceeded its execution deadline.")), this.jobTimeoutMs);
    deadline.unref();
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void Promise.resolve(this.store.heartbeatPublishingJob(claimed.id, this.workerId, claimed.fencingToken!, 180))
        .then(owned => {
          if (!owned) controller.abort(new Error("The Instagram preview lease was lost."));
        })
        .catch(error => controller.abort(error))
        .finally(() => { heartbeatRunning = false; });
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
        platformOptions: publishingPlatformOptionsSchema.parse(claimed.platformOptions),
        fencingToken: claimed.fencingToken,
      };
      const profile = await this.store.getPublishingProfileState(job.accountId);
      await this.files.prepareJobFiles(job.workspaceId, job.accountId, job.media, profile?.version);
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
          await this.store.recordPublishingProgress(
            job.id,
            this.workerId,
            job.fencingToken,
            "Local checks passed. Starting the private Instagram browser.",
          );
          const result = await executor.prepare(job, controller.signal, message => {
            void this.store.recordPublishingProgress(job.id, this.workerId, job.fencingToken, message);
          });
          checks.push(...result.checks);
          const savedProfile = await this.files.persistProfile(job.workspaceId, job.accountId);
          if (savedProfile) {
            if (!profile) throw new Error("The connected account has no browser profile metadata.");
            await this.store.recordPublishingProfileSaved({
              jobId: job.id,
              workerId: this.workerId,
              fencingToken: job.fencingToken,
              expectedVersion: profile.version,
              savedVersion: savedProfile.version,
              blobEtag: savedProfile.etag,
              contentSha256: savedProfile.contentSha256,
              encryptedSizeBytes: savedProfile.encryptedSizeBytes,
              encryptionKeyId: savedProfile.encryptionKeyId,
              encryptionKeyVersion: savedProfile.encryptionKeyVersion,
            });
          }
          screenshotKey = await this.files.storePublishingPreview(job.id, result.screenshot, job.workspaceId);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          loginRequired = error instanceof InstagramPreviewLoginRequiredError;
          if (error instanceof InstagramPreviewPreparationError && error.diagnosticScreenshot) {
            screenshotKey = await this.files.storePublishingPreview(job.id, error.diagnosticScreenshot, job.workspaceId);
          }
          const message = error instanceof Error ? error.message : "Unknown preview error.";
          issues.push(message.slice(0, 500));
        }
      }

      if (!await this.store.heartbeatPublishingJob(claimed.id, this.workerId, claimed.fencingToken, 180)) {
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
      clearTimeout(deadline);
      await this.files.discardPreparedProfile(claimed.accountId).catch(() => undefined);
      this.activeController = null;
    }
  }

  private async tick() {
    const startedAt = Date.now();
    this.activeTask = this.runOnce();
    try {
      const result = await this.activeTask;
      if (result) {
        const completed = result as { id: string; state: string };
        operationalLog("info", "publishing.preview_completed", {
          jobId: completed.id,
          state: completed.state,
          workerId: this.workerId,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (error) {
      operationalLog("error", "publishing.preview_worker_error", {
        workerId: this.workerId,
        durationMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.activeTask = null;
      if (this.started) {
        this.timer = setTimeout(() => { void this.tick(); }, this.pollMs);
        this.timer.unref();
      }
    }
  }
}
