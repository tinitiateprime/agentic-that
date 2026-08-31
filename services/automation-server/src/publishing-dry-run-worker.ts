import { randomUUID } from "node:crypto";
import { mediaReferenceSchema, publishingPlatformOptionsSchema, socialPlatformSchema } from "./contracts.ts";
import type { ClaimedPublishingJob, PublishingDryRunValidator } from "./executor.ts";
import type { AutomationJobStoreContract } from "./store-contracts.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import { operationalLog } from "./operational-log.ts";

export class AutomationPublishingDryRunWorker {
  private timer: NodeJS.Timeout | null = null;
  private activeController: AbortController | null = null;
  private activeTask: Promise<unknown> | null = null;
  private started = false;
  readonly workerId: string;

  constructor(
    private readonly store: AutomationJobStoreContract,
    private readonly validators: ReadonlyMap<string, PublishingDryRunValidator>,
    private readonly pollMs: number,
    workerId = `dryrun_${process.pid}_${randomUUID().replaceAll("-", "")}`,
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
    if (!completed) this.activeController?.abort(new Error("The dry-run worker exceeded its shutdown grace period."));
    await task.catch(() => undefined);
  }

  async runOnce() {
    await this.store.quarantineExpiredPublishingJobs();
    const claimed = await this.store.claimDuePublishingJob(this.workerId, 60, "DRY_RUN");
    if (!claimed) return null;
    if (claimed.fencingToken === null) throw new Error("The claimed dry-run job has no fencing token.");

    const controller = new AbortController();
    this.activeController = controller;
    const deadline = setTimeout(() => controller.abort(new Error("The publishing dry-run exceeded its execution deadline.")), this.jobTimeoutMs);
    deadline.unref();
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void Promise.resolve(this.store.heartbeatPublishingJob(claimed.id, this.workerId, claimed.fencingToken!, 60))
        .then(owned => {
          if (!owned) controller.abort(new Error("The dry-run publishing lease was lost."));
        })
        .catch(error => controller.abort(error))
        .finally(() => { heartbeatRunning = false; });
    }, 20_000);
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
      const validator = this.validators.get(platform);
      const profile = await this.store.getPublishingProfileState(claimed.accountId);
      await this.files?.prepareJobFiles(job.workspaceId, job.accountId, job.media, profile?.version);
      let result;
      if (!validator) {
        result = { valid: false, checks: [], issues: [`No dry-run validator is registered for ${platform}.`] };
      } else {
        try {
          result = await validator.validate(job, profile, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          const message = error instanceof Error ? error.message : "Unknown validation error.";
          result = { valid: false, checks: [], issues: [`Dry-run validator failed: ${message.slice(0, 500)}`] };
        }
      }
      if (!await this.store.heartbeatPublishingJob(claimed.id, this.workerId, claimed.fencingToken, 60)) {
        throw new Error("The dry-run publishing lease was lost before completion.");
      }
      return this.store.completePublishingDryRun({
        jobId: claimed.id,
        workerId: this.workerId,
        fencingToken: claimed.fencingToken,
        ...result,
      });
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
        operationalLog("info", "publishing.dry_run_completed", {
          jobId: completed.id,
          state: completed.state,
          workerId: this.workerId,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (error) {
      operationalLog("error", "publishing.dry_run_worker_error", {
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
