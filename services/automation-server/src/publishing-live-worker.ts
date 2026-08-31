import { randomUUID } from "node:crypto";
import { mediaReferenceSchema, publishingPlatformOptionsSchema, socialPlatformSchema } from "./contracts.ts";
import type {
  ClaimedPublishingJob,
  PublishingDryRunResult,
  PublishingDryRunValidator,
  ServerPublishingExecutor,
} from "./executor.ts";
import { InstagramPreviewLoginRequiredError } from "./instagram-preview.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import { operationalLog } from "./operational-log.ts";
import type { AutomationJobStoreContract } from "./store-contracts.ts";

export class AutomationPublishingLiveWorker {
  private timer: NodeJS.Timeout | null = null;
  private activeController: AbortController | null = null;
  private activeTask: Promise<unknown> | null = null;
  private started = false;
  readonly workerId: string;

  constructor(
    private readonly store: AutomationJobStoreContract,
    private readonly validators: ReadonlyMap<string, PublishingDryRunValidator>,
    private readonly executors: ReadonlyMap<string, ServerPublishingExecutor>,
    private readonly pollMs: number,
    workerId = `live_${process.pid}_${randomUUID().replaceAll("-", "")}`,
    private readonly files?: AutomationFileStore,
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
    if (!completed) this.activeController?.abort(new Error("The live publishing worker exceeded its shutdown grace period."));
    await task.catch(() => undefined);
  }

  async runOnce() {
    await this.store.quarantineExpiredPublishingJobs();
    const claimed = await this.store.claimDuePublishingJob(this.workerId, 360, "LIVE", "LOCAL");
    if (!claimed) return null;
    if (claimed.fencingToken === null) throw new Error("The claimed live job has no fencing token.");

    const controller = new AbortController();
    this.activeController = controller;
    const deadline = setTimeout(() => controller.abort(new Error("The live publishing job exceeded its execution deadline.")), this.jobTimeoutMs);
    deadline.unref();
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void Promise.resolve(this.store.heartbeatPublishingJob(claimed.id, this.workerId, claimed.fencingToken!, 360))
        .then(owned => {
          if (!owned) controller.abort(new Error("The live publishing lease was lost."));
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
      await this.files?.prepareJobFiles(job.workspaceId, job.accountId, job.media, profile?.version);
      let profileSaveAttempted = false;
      const savePreparedProfile = async () => {
        if (profileSaveAttempted) return;
        profileSaveAttempted = true;
        const saved = await this.files?.persistProfile(job.workspaceId, job.accountId);
        if (saved) {
          if (!profile) throw new Error("The connected account has no browser profile metadata.");
          await this.store.recordPublishingProfileSaved({
            jobId: job.id,
            workerId: this.workerId,
            fencingToken: job.fencingToken,
            expectedVersion: profile.version,
            savedVersion: saved.version,
            blobEtag: saved.etag,
            contentSha256: saved.contentSha256,
            encryptedSizeBytes: saved.encryptedSizeBytes,
            encryptionKeyId: saved.encryptionKeyId,
            encryptionKeyVersion: saved.encryptionKeyVersion,
          });
        }
      };
      const validator = this.validators.get(platform);
      const executor = this.executors.get(platform);
      if (!validator) {
        return this.store.finishPublishingJob({
          jobId: job.id,
          workerId: this.workerId,
          fencingToken: job.fencingToken,
          state: "FAILED",
          errorCode: "LIVE_VALIDATOR_MISSING",
          errorMessage: `No live publishing validator is registered for ${platform}.`,
        });
      }
      let preflight: PublishingDryRunResult;
      try {
        preflight = await validator.validate(job, profile, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        const message = error instanceof Error ? error.message : "Unknown live preflight error.";
        return this.store.finishPublishingJob({
          jobId: job.id,
          workerId: this.workerId,
          fencingToken: job.fencingToken,
          state: "FAILED",
          errorCode: "LIVE_PREFLIGHT_ERROR",
          errorMessage: message.slice(0, 1_000),
        });
      }
      if (!preflight.valid) {
        return this.store.finishPublishingJob({
          jobId: job.id,
          workerId: this.workerId,
          fencingToken: job.fencingToken,
          state: "FAILED",
          errorCode: "LIVE_PREFLIGHT_FAILED",
          errorMessage: `Live publishing preflight failed: ${preflight.issues.join(" ")}`.slice(0, 1_000),
        });
      }
      if (!executor) {
        return this.store.finishPublishingJob({
          jobId: job.id,
          workerId: this.workerId,
          fencingToken: job.fencingToken,
          state: "FAILED",
          errorCode: "LIVE_EXECUTOR_MISSING",
          errorMessage: `No live publishing executor is registered for ${platform}.`,
        });
      }

      let finalActionStarted = false;
      try {
        await this.store.recordPublishingProgress(job.id, this.workerId, job.fencingToken, "Live preflight passed.");
        const result = await executor.publish(
          job,
          controller.signal,
          async () => {
            await this.store.markPublishingFinalActionStarting(job.id, this.workerId, job.fencingToken);
            finalActionStarted = true;
          },
          message => { void this.store.recordPublishingProgress(job.id, this.workerId, job.fencingToken, message); },
        );
        await savePreparedProfile();
        if (!finalActionStarted && result.state === "LOGIN_REQUIRED") {
          return this.store.finishPublishingJob({
            jobId: job.id,
            workerId: this.workerId,
            fencingToken: job.fencingToken,
            state: "LOGIN_REQUIRED",
            errorCode: result.errorCode || "LIVE_LOGIN_REQUIRED",
            errorMessage: result.errorMessage || `Reconnect the ${platform} account.`,
          });
        }
        if (!finalActionStarted) {
          return this.store.finishPublishingJob({
            jobId: job.id,
            workerId: this.workerId,
            fencingToken: job.fencingToken,
            state: "FAILED",
            errorCode: "LIVE_FINAL_ACTION_NOT_RECORDED",
            errorMessage: `The ${platform} executor returned without recording its final publish action.`,
          });
        }
        if (result.state === "FAILED") {
          return this.store.finishPublishingJob({
            jobId: job.id,
            workerId: this.workerId,
            fencingToken: job.fencingToken,
            state: "FAILED",
            errorCode: result.errorCode || "LIVE_PLATFORM_REJECTED",
            errorMessage: result.errorMessage || `${platform} rejected the final publish action.`,
          });
        }
        if (result.state !== "PUBLISHED") {
          return this.store.finishPublishingJob({
            jobId: job.id,
            workerId: this.workerId,
            fencingToken: job.fencingToken,
            state: "UNCERTAIN",
            errorCode: "LIVE_RESULT_UNCERTAIN",
            errorMessage: result.errorMessage || `${platform} submitted the final action without a verified published result.`,
          });
        }
        return this.store.finishPublishingJob({
          jobId: job.id,
          workerId: this.workerId,
          fencingToken: job.fencingToken,
          ...result,
        });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        try {
          await savePreparedProfile();
        } catch (profileError) {
          const profileMessage = profileError instanceof Error ? profileError.message : "Unknown profile storage error.";
          return await this.store.finishPublishingJob({
            jobId: job.id,
            workerId: this.workerId,
            fencingToken: job.fencingToken,
            state: finalActionStarted ? "UNCERTAIN" : "FAILED",
            errorCode: finalActionStarted ? "LIVE_PROFILE_SAVE_UNCERTAIN" : "LIVE_PROFILE_SAVE_FAILED",
            errorMessage: `Browser profile could not be saved: ${profileMessage}`.slice(0, 1_000),
          });
        }
        const loginRequired = error instanceof InstagramPreviewLoginRequiredError;
        const state = loginRequired ? "LOGIN_REQUIRED" : finalActionStarted ? "UNCERTAIN" : "FAILED";
        const message = error instanceof Error ? error.message : "Unknown live publishing error.";
        return this.store.finishPublishingJob({
          jobId: job.id,
          workerId: this.workerId,
          fencingToken: job.fencingToken,
          state,
          errorCode: loginRequired
            ? "LIVE_LOGIN_REQUIRED"
            : finalActionStarted ? "LIVE_RESULT_UNCERTAIN" : "LIVE_PUBLISH_FAILED",
          errorMessage: message.slice(0, 1_000),
        });
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      await this.files?.discardPreparedProfile(claimed.accountId).catch(() => undefined);
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
        operationalLog("info", "publishing.job_completed", {
          jobId: completed.id,
          state: completed.state,
          workerId: this.workerId,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (error) {
      operationalLog("error", "publishing.worker_error", {
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

export class AutomationPublishingLiveWorkerPool {
  readonly workers: readonly AutomationPublishingLiveWorker[];

  constructor(
    store: AutomationJobStoreContract,
    validators: ReadonlyMap<string, PublishingDryRunValidator>,
    executors: ReadonlyMap<string, ServerPublishingExecutor>,
    pollMs: number,
    workerCount: number,
    files?: AutomationFileStore,
    jobTimeoutMs = 15 * 60_000,
    shutdownGraceMs = 120_000,
  ) {
    if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 8) {
      throw new Error("The live publishing worker pool must contain between 1 and 8 workers.");
    }
    const poolId = `live_pool_${process.pid}_${randomUUID().replaceAll("-", "")}`;
    this.workers = Array.from({ length: workerCount }, (_, index) => new AutomationPublishingLiveWorker(
      store,
      validators,
      executors,
      pollMs,
      `${poolId}_${index + 1}`,
      files,
      jobTimeoutMs,
      shutdownGraceMs,
    ));
  }

  get size() {
    return this.workers.length;
  }

  start() {
    for (const worker of this.workers) worker.start();
  }

  async stop() {
    await Promise.all(this.workers.map(worker => worker.stop()));
  }

  async runOnce() {
    return Promise.all(this.workers.map(worker => worker.runOnce()));
  }
}
