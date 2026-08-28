import { randomUUID } from "node:crypto";
import type {
  ClaimedTelegramPost,
  MultiUserStore,
  TelegramPostDelivery,
} from "./store.ts";

export type TelegramScheduledSendResult = {
  recipient: string;
  messageId: string;
  sentAt: string;
};

export type TelegramScheduledPostExecutor = (
  post: ClaimedTelegramPost,
  delivery: TelegramPostDelivery,
) => Promise<TelegramScheduledSendResult>;

export class TelegramPostScheduler {
  private static readonly LEASE_HEARTBEAT_MS = 30_000;
  private readonly workerId = `telegram_scheduler_${randomUUID().replaceAll("-", "")}`;
  private readonly running = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(
    private readonly store: MultiUserStore,
    private readonly execute: TelegramScheduledPostExecutor,
    private readonly pollMs = 2_000,
    private readonly concurrency = 4,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
      throw new Error("Telegram scheduler concurrency must be between 1 and 16.");
    }
  }

  start() {
    if (this.timer || this.stopping) return;
    this.timer = setInterval(() => this.pump(), this.pollMs);
    this.timer.unref();
    this.pump();
  }

  wake() {
    this.pump();
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([...this.running]);
  }

  async runOnce() {
    const post = await this.store.claimDuePost(this.workerId);
    if (!post) return null;

    let delivery: TelegramPostDelivery | null;
    while ((delivery = await this.store.claimNextPostDelivery(post.id, this.workerId))) {
      try {
        const sent = await this.executeWithLease(post, delivery);
        await this.store.recordMessage({
          accountId: post.accountId,
          direction: "outbound",
          recipient: sent.recipient,
          text: post.body,
          telegramMessageId: sent.messageId,
          createdAt: sent.sentAt,
        });
        await this.store.completePostDelivery(post.id, this.workerId, delivery.id, {
          status: "Sent",
          sentAt: sent.sentAt,
          telegramMessageId: sent.messageId,
        });
      } catch (error) {
        await this.store.completePostDelivery(post.id, this.workerId, delivery.id, {
          status: "Failed",
          error: error instanceof Error ? error.message : "Telegram scheduled delivery failed.",
        });
      }
    }

    return this.store.finishClaimedPost(post.id, this.workerId);
  }

  private async executeWithLease(post: ClaimedTelegramPost, delivery: TelegramPostDelivery) {
    await this.store.renewPostLease(post.id, this.workerId);
    const heartbeat = setInterval(() => {
      void this.store.renewPostLease(post.id, this.workerId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown lease renewal error.";
        console.error(`Telegram scheduled post ${post.id} lease renewal failed: ${message}`);
      });
    }, TelegramPostScheduler.LEASE_HEARTBEAT_MS);
    heartbeat.unref();
    try {
      return await this.execute(post, delivery);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private pump() {
    if (this.stopping) return;
    while (this.running.size < this.concurrency) {
      let task: Promise<void>;
      task = this.runOnce()
        .then((post) => {
          if (post) {
            console.log(`Telegram scheduled post ${post.id} finished with status ${post.status}.`);
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Unknown scheduler error.";
          console.error(`Telegram scheduled post worker failed: ${message}`);
        })
        .finally(() => {
          this.running.delete(task);
        });
      this.running.add(task);
    }
  }
}
