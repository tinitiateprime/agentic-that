import { getCurrentPlatformUser } from "@platform/server/auth-store";
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

  const user = await getCurrentPlatformUser();
  if (!user) return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await context.params;
  const job = await jobStore.getJob(id);
  if (!job || job.userId !== user.id) {
    return Response.json({ error: "AI job not found.", code: "AI_JOB_NOT_FOUND" }, { status: 404 });
  }
  const completed = await executeGrowthAdvisorJob(id, { store: jobStore });
  if (!completed) {
    return Response.json({ error: "AI job not found.", code: "AI_JOB_NOT_FOUND" }, { status: 404 });
  }
  return Response.json({ ok: true, ...growthAdvisorJobPayload(completed) }, {
    headers: { "Cache-Control": "no-store" }
  });
}
