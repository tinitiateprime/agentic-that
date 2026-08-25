import { randomUUID } from "node:crypto";
import { mediaReferenceSchema, socialPlatformSchema } from "./contracts.ts";
import type {
  ClaimedPublishingJob,
  PublishingDryRunResult,
  PublishingDryRunValidator,
  ServerPublishingExecutor,
} from "./executor.ts";
import { InstagramPreviewLoginRequiredError } from "./instagram-preview.ts";
import type { AutomationJobStore } from "./job-store.ts";

export class AutomationPublishingLiveWorker {
  private timer: NodeJS.Timeout | null = null;
  private activeController: AbortController | null = null;
  private activeTask: Promise<unknown> | null = null;
  private started = false;
  readonly workerId: string;

  constructor(
    private readonly store: AutomationJobStore,
    private readonly validators: ReadonlyMap<string, PublishingDryRunValidator>,
    private readonly executors: ReadonlyMap<string, ServerPublishingExecutor>,
    private readonly pollMs: number,
    workerId = `live_${process.pid}_${randomUUID().replaceAll("-", "")}`,
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
    this.activeController?.abort(new Error("The live publishing worker is stopping."));
    await this.activeTask?.catch(() => undefined);
  }

  async runOnce() {
    this.store.quarantineExpiredPublishingJobs();
    const claimed = this.store.claimDuePublishingJob(this.workerId, 360, "LIVE", "LOCAL");
    if (!claimed) return null;
    if (claimed.fencingToken === null) throw new Error("The claimed live job has no fencing token.");

    const controller = new AbortController();
    this.activeController = controller;
    const heartbeat = setInterval(() => {
      try {
        const owned = this.store.heartbeatPublishingJob(claimed.id, this.workerId, claimed.fencingToken!, 360);
        if (!owned) controller.abort(new Error("The live publishing lease was lost."));
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
        this.store.recordPublishingProgress(job.id, this.workerId, job.fencingToken, "Live preflight passed.");
        const result = await executor.publish(
          job,
          controller.signal,
          async () => {
            this.store.markPublishingFinalActionStarting(job.id, this.workerId, job.fencingToken);
            finalActionStarted = true;
          },
          message => this.store.recordPublishingProgress(job.id, this.workerId, job.fencingToken, message),
        );
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
      this.activeController = null;
    }
  }

  private async tick() {
    this.activeTask = this.runOnce();
    try {
      await this.activeTask;
    } catch (error) {
      process.stderr.write(`Live publishing worker error: ${error instanceof Error ? error.message : String(error)}\n`);
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
    store: AutomationJobStore,
    validators: ReadonlyMap<string, PublishingDryRunValidator>,
    executors: ReadonlyMap<string, ServerPublishingExecutor>,
    pollMs: number,
    workerCount: number,
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
