import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import {
  executeAutomatedWebsiteProject,
  failQueuedWebsiteProject,
  queueAutomatedWebsiteProject,
  websiteStudioSnapshot,
} from "@platform/server/website-studio-store";
import { WebsiteStudioError } from "@platform/server/website-studio-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function dispatchBackgroundGeneration(request, projectId, jobToken) {
  const runUrl = new URL(
    `/api/admin-center/website-studio/jobs/${encodeURIComponent(projectId)}/run`,
    request.url,
  );
  const response = await fetch(runUrl, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobToken }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new WebsiteStudioError(
      "The website was queued, but its background worker could not start. Retry the project.",
      "GENERATION_DISPATCH_FAILED",
      503,
    );
  }
}

export async function GET() {
  try {
    await authorizeGlobalAdminApi();
    return Response.json({ ok: true, ...(await websiteStudioSnapshot()) });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      console.error("AI Website Studio snapshot failed", error);
      return Response.json({ error: "Unable to load AI Website Studio." }, { status: 500 });
    }
  }
}
export async function POST(request) {
  let queued = null;
  try {
    const actor = await authorizeGlobalAdminApi();
    queued = await queueAutomatedWebsiteProject(actor, await request.json());

    if (process.env.NETLIFY === "true") {
      await dispatchBackgroundGeneration(request, queued.project.id, queued.jobToken);
      return Response.json({ ok: true, queued: true, project: queued.project }, { status: 202 });
    }

    const result = await executeAutomatedWebsiteProject(queued.project.id, queued.jobToken);
    if (!result || result.error) {
      throw new WebsiteStudioError(result?.error || "Website generation failed.", "GENERATION_FAILED", 502);
    }
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (queued?.project?.id && queued?.jobToken) {
      try { await failQueuedWebsiteProject(queued.project.id, queued.jobToken, error); } catch {}
    }
    try { return accessErrorResponse(error); } catch {
      console.error("AI Website Studio generation failed", error);
      return Response.json({
        error: error instanceof Error ? error.message : "Unable to generate the websites.",
        code: error?.code || "GENERATION_FAILED",
        projectId: error?.projectId || null,
      }, { status: Number(error?.status) >= 400 ? Number(error.status) : 500 });
    }
  }
}
