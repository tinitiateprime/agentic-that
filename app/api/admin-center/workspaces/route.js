import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { createWorkspace } from "@platform/server/admin-center-store";

export async function POST(request) {
  try {
    const actor = await authorizeGlobalAdminApi();
    return Response.json({ ok: true, workspace: await createWorkspace(actor, await request.json()) }, { status: 201 });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to create workspace." }, { status: 400 });
    }
  }
}
