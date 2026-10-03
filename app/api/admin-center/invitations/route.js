import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { sendAdminWorkspaceInvitation } from "@platform/server/admin-communications-store";

export async function POST(request) {
  try {
    const actor = await authorizeGlobalAdminApi();
    const result = await sendAdminWorkspaceInvitation(actor, await request.json());
    if (result.error) {
      return Response.json({ error: `Invitation created, but email delivery failed: ${result.error}`, delivery: result.delivery }, { status: 502 });
    }
    return Response.json({ ok: true, delivery: result.delivery }, { status: 201 });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to send the invitation." }, { status: 400 });
    }
  }
}
