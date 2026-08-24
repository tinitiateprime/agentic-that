import type { PublishingJobState, SocialPlatform } from "./contracts.ts";

export type ClaimedPublishingJob = {
  id: string;
  workspaceId: string;
  accountId: string;
  platform: SocialPlatform;
  caption: string;
  media: Array<{ storageKey: string; fileName: string; mimeType: string }>;
  fencingToken: number;
};

export type PublishingExecutionResult = {
  state: Extract<PublishingJobState, "PUBLISHED" | "FAILED" | "LOGIN_REQUIRED" | "UNCERTAIN">;
  platformPostId?: string;
  platformPostUrl?: string;
  errorCode?: string;
  errorMessage?: string;
};

// Platform browser implementations will be moved behind this boundary one at a
// time. The current Companion publishers are deliberately not imported here,
// so adding this service cannot change the production execution path.
export interface ServerPublishingExecutor {
  readonly platform: SocialPlatform;
  publish(job: ClaimedPublishingJob, signal: AbortSignal): Promise<PublishingExecutionResult>;
}
