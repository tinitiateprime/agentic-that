type CompanionScrapingPlatform = "instagram" | "facebook";

type PendingTask<T = unknown> = {
  id: string;
  platform: CompanionScrapingPlatform;
  signal?: AbortSignal;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  abort: () => void;
};

const pending: PendingTask[] = [];
let active: { id: string; platform: CompanionScrapingPlatform; startedAt: string } | null = null;
let publishingBusy = () => false;
let retryTimer: NodeJS.Timeout | null = null;
let pumping = false;

function cancellationError() {
  return new DOMException("Companion scraping was cancelled.", "AbortError");
}

function schedulePump(delay = 0) {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void pump();
  }, delay);
}

async function pump() {
  if (pumping || active) return;
  pumping = true;
  try {
    while (pending[0]?.signal?.aborted) {
      const cancelled = pending.shift();
      cancelled?.signal?.removeEventListener("abort", cancelled.abort);
      cancelled?.reject(cancellationError());
    }
    const next = pending[0];
    if (!next) return;
    let shouldWaitForPublishing = false;
    try {
      shouldWaitForPublishing = publishingBusy();
    } catch {
      shouldWaitForPublishing = false;
    }
    if (shouldWaitForPublishing) {
      schedulePump(250);
      return;
    }

    pending.shift();
    next.signal?.removeEventListener("abort", next.abort);
    if (next.signal?.aborted) {
      next.reject(cancellationError());
      schedulePump();
      return;
    }
    active = { id: next.id, platform: next.platform, startedAt: new Date().toISOString() };
    try {
      next.resolve(await next.run());
    } catch (error) {
      next.reject(error);
    } finally {
      active = null;
      schedulePump();
    }
  } finally {
    pumping = false;
  }
}

export function runCompanionScrapingTask<T>(
  platform: CompanionScrapingPlatform,
  id: string,
  run: () => Promise<T>,
  signal?: AbortSignal,
) {
  return new Promise<T>((resolve, reject) => {
    const task: PendingTask<T> = {
      id,
      platform,
      signal,
      run,
      resolve,
      reject,
      abort: () => {
        const index = pending.indexOf(task as PendingTask);
        if (index >= 0) pending.splice(index, 1);
        reject(cancellationError());
        schedulePump();
      },
    };
    if (signal?.aborted) {
      reject(cancellationError());
      return;
    }
    signal?.addEventListener("abort", task.abort, { once: true });
    pending.push(task as PendingTask);
    schedulePump();
  });
}

export function setCompanionPublishingBusyProvider(provider: (() => boolean) | null) {
  publishingBusy = provider || (() => false);
  schedulePump();
}

export function companionResourceSchedulerState() {
  return {
    active: active ? { ...active } : null,
    queued: pending.map((task, index) => ({
      id: task.id,
      platform: task.platform,
      position: index + 1,
    })),
    concurrency: 1,
    publishingPriority: true,
  };
}

export function resetCompanionResourceSchedulerForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The Companion resource scheduler can only be reset in tests.");
  }
  for (const task of pending.splice(0)) {
    task.signal?.removeEventListener("abort", task.abort);
    task.reject(cancellationError());
  }
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  publishingBusy = () => false;
}
