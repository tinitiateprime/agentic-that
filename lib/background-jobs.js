import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

export class BackgroundJobError extends Error {
  status = 503;
  code = "BACKGROUND_WORKER_UNAVAILABLE";
}

const kinds = new Set(["instagram", "facebook", "growth-advisor", "website-studio"]);
let client;

export function backgroundJobMode(environment = process.env) {
  const mode = environment.BACKGROUND_JOB_MODE?.trim() || "auto";
  if (!["auto", "lambda", "request"].includes(mode)) throw new BackgroundJobError("BACKGROUND_JOB_MODE must be auto, lambda or request.");
  return mode === "auto" ? (environment.BACKGROUND_JOB_FUNCTION_NAME?.trim() ? "lambda" : "request") : mode;
}

export function validateBackgroundJob(job) {
  if (!job || job.version !== 1 || !kinds.has(job.kind)
    || typeof job.jobId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(job.jobId)) {
    throw new Error("Invalid background job.");
  }
  if (job.kind === "website-studio") {
    if (typeof job.jobToken !== "string" || !job.jobToken || job.jobToken.length > 1000) throw new Error("Invalid website job token.");
  } else if (typeof job.workspaceId !== "string" || !job.workspaceId || job.workspaceId.length > 200) {
    throw new Error("Invalid background workspace.");
  }
  return job;
}

export async function dispatchBackgroundJob(job, sender) {
  validateBackgroundJob(job);
  const functionName = process.env.BACKGROUND_JOB_FUNCTION_NAME?.trim();
  if (!functionName) throw new BackgroundJobError("The background worker is not configured.");
  const payload = Buffer.from(JSON.stringify(job));
  if (payload.length > 10_000) throw new Error("Background job payload is too large.");
  client ||= new LambdaClient({ region: process.env.BACKGROUND_JOB_REGION || process.env.AWS_REGION || "us-east-1" });
  const response = await (sender || client).send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: payload,
  }));
  if (response.StatusCode !== 202 || response.FunctionError) throw new BackgroundJobError("The background worker could not accept the job.");
}
