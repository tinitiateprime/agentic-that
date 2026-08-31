import { randomUUID } from "node:crypto";
import { scrapingInputSchema, scrapingPlatformSchema } from "./contracts.ts";
import { operationalLog } from "./operational-log.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import type { AutomationJobStoreContract } from "./store-contracts.ts";

export interface ServerScrapingExecutor {
  execute(input: unknown, signal: AbortSignal): Promise<unknown>;
}

export class InstagramServerScrapingExecutor implements ServerScrapingExecutor {
  async execute(input: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    const value = scrapingInputSchema.parse(input);
    const moduleUrl = new URL("../../scraping/instagram/src/scraper.ts", import.meta.url).href;
    const scraper = await import(moduleUrl) as { runInstagramScrape(input: unknown): Promise<unknown> };
    const result = await scraper.runInstagramScrape(value);
    signal.throwIfAborted();
    return result;
  }
}

export class FacebookServerScrapingExecutor implements ServerScrapingExecutor {
  async execute(input: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    const value = scrapingInputSchema.parse(input);
    const moduleUrl = new URL("../../scraping/facebook/src/scraper.ts", import.meta.url).href;
    const scraper = await import(moduleUrl) as { runFacebookScrape(input: unknown): Promise<unknown> };
    const result = await scraper.runFacebookScrape(value);
    signal.throwIfAborted();
    return result;
  }
}

export class AutomationScrapingWorker {
  private timer: NodeJS.Timeout | null = null;
  private activeTask: Promise<unknown> | null = null;
  private activeController: AbortController | null = null;
  private started = false;
  readonly workerId: string;

  constructor(
    private readonly store: AutomationJobStoreContract,
    private readonly files: AutomationFileStore,
    private readonly executors: ReadonlyMap<string, ServerScrapingExecutor>,
    private readonly pollMs: number,
    private readonly jobTimeoutMs: number,
    private readonly shutdownGraceMs: number,
    workerId = `scrape_${process.pid}_${randomUUID().replaceAll("-", "")}`,
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
    if (!completed) this.activeController?.abort(new Error("The scraping worker exceeded its shutdown grace period."));
    await task.catch(() => undefined);
  }

  async runOnce() {
    await this.store.quarantineExpiredScrapingJobs();
    const claimed = await this.store.claimDueScrapingJob(this.workerId, 600);
    if (!claimed) return null;
    if (claimed.fencingToken === null) throw new Error("The claimed scraping job has no fencing token.");
    const controller = new AbortController();
    this.activeController = controller;
    const deadline = setTimeout(() => controller.abort(new Error("The scraping job exceeded its execution deadline.")), this.jobTimeoutMs);
    deadline.unref();
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void Promise.resolve(this.store.heartbeatScrapingJob(claimed.id, this.workerId, claimed.fencingToken!, 600))
        .then(owned => {
          if (!owned) controller.abort(new Error("The scraping lease was lost."));
        })
        .catch(error => controller.abort(error))
        .finally(() => { heartbeatRunning = false; });
    }, 30_000);
    heartbeat.unref();
    try {
      const platform = scrapingPlatformSchema.parse(claimed.platform);
      const executor = this.executors.get(platform);
      if (!executor) {
        return await this.store.finishScrapingJob({
          jobId: claimed.id,
          workerId: this.workerId,
          fencingToken: claimed.fencingToken,
          state: "FAILED",
          errorCode: "SCRAPING_EXECUTOR_MISSING",
          errorMessage: `No server scraping executor is registered for ${platform}.`,
        });
      }
      try {
        const result = await executor.execute(claimed.input, controller.signal);
        const resultKey = await this.files.storeScrapingResult(claimed.workspaceId, claimed.id, result);
        return await this.store.finishScrapingJob({
          jobId: claimed.id,
          workerId: this.workerId,
          fencingToken: claimed.fencingToken,
          state: "COMPLETE",
          resultKey,
        });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        return await this.store.finishScrapingJob({
          jobId: claimed.id,
          workerId: this.workerId,
          fencingToken: claimed.fencingToken,
          state: "FAILED",
          errorCode: "SCRAPING_EXECUTION_FAILED",
          errorMessage: (error instanceof Error ? error.message : "Unknown scraping error.").slice(0, 1_000),
        });
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
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
        operationalLog("info", "scraping.job_completed", {
          jobId: completed.id,
          state: completed.state,
          workerId: this.workerId,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (error) {
      operationalLog("error", "scraping.worker_error", {
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
