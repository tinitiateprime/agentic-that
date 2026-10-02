import { accessErrorResponse, assertPrincipalCapability, authorizeApiAccess } from "@platform/server/access-control";
import { advanceWebsiteRequestJob } from "@platform/server/website-studio-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(_request, context) {
  try {
    const actor = await assertPrincipalCapability(await authorizeApiAccess("website.ai-website-studio", "operate"), "website.generate");
    const { id } = await context.params;
    return Response.json({ ok: true, ...await advanceWebsiteRequestJob(actor, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: Number(error?.status) === 404 ? "Website project not found." : "Unable to advance website generation." }, { status: Number(error?.status) === 404 ? 404 : 500 });
    }
  }
}
