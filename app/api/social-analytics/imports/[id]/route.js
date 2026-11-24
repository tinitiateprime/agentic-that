import { accessErrorResponse, authorizeOpenServiceApi } from "@platform/server/access-control";
import { deleteAnalyticsImport } from "@platform/server/social-analytics-store";

// Removes a wrong upload and the numbers it brought in.
export async function DELETE(_request, { params }) {
  try {
    const principal = await authorizeOpenServiceApi();
    if (!principal.workspaceId) return Response.json({ error: "Join a company workspace to use Social Manager." }, { status: 403 });
    const { id } = await params;
    return Response.json(await deleteAnalyticsImport(principal, id));
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "The upload could not be removed." }, { status: 400 });
    }
  }
}
