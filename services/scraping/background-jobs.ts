export class InProcessBackgroundJobs {
  private readonly jobs = new Map<string, {
    key: string;
    operation: () => Promise<unknown>;
    onError: (error: unknown) => void;
  }>();
  private readonly queue: Array<{
    key: string;
    operation: () => Promise<unknown>;
    onError: (error: unknown) => void;
  }> = [];
  private running = 0;

  constructor(private readonly concurrency = 1) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("Background job concurrency must be a positive integer.");
    }
  }

  start(key: string, operation: () => Promise<unknown>, onError: (error: unknown) => void = () => {}) {
    if (this.jobs.has(key)) return false;
    const job = { key, operation, onError };
    this.jobs.set(key, job);
    this.queue.push(job);
    queueMicrotask(() => this.drain());
    return true;
  }

  has(key: string) {
    return this.jobs.has(key);
  }

  get size() {
    return this.jobs.size;
  }

  get queued() {
    return this.queue.length;
  }

  get active() {
    return this.running;
  }

  private drain() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.running += 1;
      Promise.resolve()
        .then(job.operation)
        .catch((error) => {
          try {
            job.onError(error);
          } catch {
            // Operational logging must never turn a handled background failure
            // into an unhandled promise rejection.
          }
        })
        .finally(() => {
          this.running -= 1;
          if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
          this.drain();
        });
    }
  }
}
