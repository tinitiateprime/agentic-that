import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { getProjectTree, projectRepositoryErrorResponse } from "@platform/server/project-management-repository";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await authorizeGlobalAdminApi();
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    return Response.json({ ok: true, ...(await getProjectTree({ refresh })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return projectRepositoryErrorResponse(error, "Unable to load the project repository.");
    }
  }
}
