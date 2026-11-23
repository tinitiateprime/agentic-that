import { accessErrorResponse, authorizeOpenServiceApi } from "@platform/server/access-control";
import { workspaceActivityReport } from "@platform/server/workspace-reports-store";

// Every member of a company can read its activity report.
export async function GET(request) {
  try {
    const principal = await authorizeOpenServiceApi();
    if (!principal.workspaceId) return Response.json({ error: "Join a company workspace to see reports." }, { status: 403 });
    const days = Number(new URL(request.url).searchParams.get("days") || 30);
    return Response.json(await workspaceActivityReport(principal, { days }));
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "The report could not be loaded." }, { status: 400 });
    }
  }
}
