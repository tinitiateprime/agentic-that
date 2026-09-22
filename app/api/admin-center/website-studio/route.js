import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import {
  createAutomatedWebsiteProject,
  websiteStudioSnapshot,
} from "@platform/server/website-studio-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  try {
    const actor = await authorizeGlobalAdminApi();
    const result = await createAutomatedWebsiteProject(actor, await request.json());
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
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
