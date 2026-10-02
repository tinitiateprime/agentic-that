export type BackgroundJob = {
  version: 1;
  kind: "instagram" | "facebook" | "growth-advisor" | "website-studio";
  jobId: string;
  workspaceId?: string;
  userId?: string;
  jobToken?: string;
};
export class BackgroundJobError extends Error { status: number; code: string; }
export function backgroundJobMode(environment?: Record<string, string | undefined>): "lambda" | "request";
export function validateBackgroundJob(job: unknown): BackgroundJob;
export function dispatchBackgroundJob(job: BackgroundJob, sender?: { send(command: unknown): Promise<{ StatusCode?: number; FunctionError?: string }> }): Promise<void>;
