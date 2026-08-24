import { randomUUID } from "node:crypto";
import { mediaReferenceSchema, socialPlatformSchema } from "./contracts.ts";
import type { ClaimedPublishingJob, PublishingDryRunValidator } from "./executor.ts";
import type { AutomationJobStore } from "./job-store.ts";

export class AutomationPublishingDryRunWorker {
  private timer: NodeJS.Timeout | null = null;
  private activeController: AbortController | null = null;
  private activeTask: Promise<unknown> | null = null;
  private started = false;
  readonly workerId: string;

  constructor(
    private readonly store: AutomationJobStore,
    private readonly validators: ReadonlyMap<string, PublishingDryRunValidator>,
    private readonly pollMs: number,
    workerId = `dryrun_${process.pid}_${randomUUID().replaceAll("-", "")}`,
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
    this.activeController?.abort(new Error("The dry-run worker is stopping."));
    await this.activeTask?.catch(() => undefined);
  }

  async runOnce() {
    this.store.quarantineExpiredPublishingJobs();
    const claimed = this.store.claimDuePublishingJob(this.workerId, 60, "DRY_RUN");
    if (!claimed) return null;
    if (claimed.fencingToken === null) throw new Error("The claimed dry-run job has no fencing token.");

    const controller = new AbortController();
    this.activeController = controller;
    const heartbeat = setInterval(() => {
      const owned = this.store.heartbeatPublishingJob(claimed.id, this.workerId, claimed.fencingToken!, 60);
      if (!owned) controller.abort(new Error("The dry-run publishing lease was lost."));
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
        fencingToken: claimed.fencingToken,
      };
      const validator = this.validators.get(platform);
      const profile = this.store.getPublishingProfileState(claimed.accountId);
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
      if (!this.store.heartbeatPublishingJob(claimed.id, this.workerId, claimed.fencingToken, 60)) {
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
      this.activeController = null;
    }
  }

  private async tick() {
    this.activeTask = this.runOnce();
    try {
      await this.activeTask;
    } catch (error) {
      process.stderr.write(`Publishing dry-run worker error: ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      this.activeTask = null;
      if (this.started) {
        this.timer = setTimeout(() => { void this.tick(); }, this.pollMs);
        this.timer.unref();
      }
    }
  }
}
