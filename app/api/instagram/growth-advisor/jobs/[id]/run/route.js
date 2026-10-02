import { backgroundJobMode, dispatchBackgroundJob } from "../../../../../../../lib/background-jobs.js";
import {
  accessErrorResponse,
  authorizeApiCapability
} from "@platform/server/access-control";
import {
  executeGrowthAdvisorJob,
  GrowthAdvisorJobStore,
  growthAdvisorJobPayload
} from "@instagram/src/growth-advisor-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const jobStore = new GrowthAdvisorJobStore();

export async function POST(_request, context) {

  let principal;
  try {
    principal = await authorizeApiCapability("scraping.analyze");
  } catch (error) {
    return accessErrorResponse(error);
  }
  const { id } = await context.params;
  const job = await jobStore.getJob(id);
  const isLegacyOwner = job?.workspaceId === job?.userId && job?.userId === principal.userId;
  if (!job || (job.workspaceId !== principal.workspaceId && !isLegacyOwner)) {
    return Response.json({ error: "AI job not found.", code: "AI_JOB_NOT_FOUND" }, { status: 404 });
  }
  const mode = backgroundJobMode();
  if (process.env.NODE_ENV === "production" && mode === "lambda") {
    try {
      if (job.status === "pending") await dispatchBackgroundJob({ version: 1, kind: "growth-advisor", jobId: id, workspaceId: principal.workspaceId, userId: principal.userId });
      return Response.json({ ok: true, executionMode: "lambda", ...growthAdvisorJobPayload(job) }, { status: 202, headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "The AI background worker could not start.", code: "BACKGROUND_WORKER_UNAVAILABLE" }, { status: 503 });
    }
  }
  const completed = await executeGrowthAdvisorJob(id, {
    store: jobStore,
    workspaceId: principal.workspaceId,
    userId: principal.userId,
    requestMode: process.env.NODE_ENV === "production" && mode === "request"
  });
  if (!completed) {
    return Response.json({ error: "AI job not found.", code: "AI_JOB_NOT_FOUND" }, { status: 404 });
  }
  return Response.json({ ok: true, executionMode: "request", ...growthAdvisorJobPayload(completed) }, {
    headers: { "Cache-Control": "no-store" }
  });
}
