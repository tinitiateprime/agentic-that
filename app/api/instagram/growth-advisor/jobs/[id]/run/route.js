import {
  accessErrorResponse,
  authorizeApiAccess
} from "@platform/server/access-control";
import {
  executeGrowthAdvisorJob,
  GrowthAdvisorJobStore,
  growthAdvisorJobPayload
} from "@instagram/src/growth-advisor-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const jobStore = new GrowthAdvisorJobStore();

export async function POST(_request, context) {
  if (process.env.NETLIFY === "true") {
    return Response.json({
      error: "The AI background route is unavailable.",
      code: "AI_BACKGROUND_ROUTE_UNAVAILABLE"
    }, { status: 503 });
  }

  let principal;
  try {
    principal = await authorizeApiAccess("scraping.instagram", "operate");
  } catch (error) {
    return accessErrorResponse(error);
  }
  const { id } = await context.params;
  const job = await jobStore.getJob(id);
  const isLegacyOwner = job?.workspaceId === job?.userId && job?.userId === principal.userId;
  if (!job || (job.workspaceId !== principal.workspaceId && !isLegacyOwner)) {
    return Response.json({ error: "AI job not found.", code: "AI_JOB_NOT_FOUND" }, { status: 404 });
  }
  const completed = await executeGrowthAdvisorJob(id, {
    store: jobStore,
    workspaceId: principal.workspaceId,
    userId: principal.userId
  });
  if (!completed) {
    return Response.json({ error: "AI job not found.", code: "AI_JOB_NOT_FOUND" }, { status: 404 });
  }
  return Response.json({ ok: true, ...growthAdvisorJobPayload(completed) }, {
    headers: { "Cache-Control": "no-store" }
  });
}
