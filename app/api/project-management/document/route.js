import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { getProjectDocument, projectRepositoryErrorResponse } from "@platform/server/project-management-repository";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await authorizeGlobalAdminApi();
    const params = new URL(request.url).searchParams;
    const document = await getProjectDocument(params.get("path") || "", { refresh: params.get("refresh") === "1" });
    return Response.json({ ok: true, document }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return projectRepositoryErrorResponse(error, "Unable to load this document.");
    }
  }
}
