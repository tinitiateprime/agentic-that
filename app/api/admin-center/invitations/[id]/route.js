import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import {
  cancelAdminWorkspaceInvitation,
  retryAdminWorkspaceInvitation,
} from "@platform/server/admin-communications-store";

export async function PATCH(request, { params }) {
  try {
    const actor = await authorizeGlobalAdminApi();
    const { id } = await params;
    const input = await request.json();
    if (input.action === "cancel") {
      return Response.json({ ok: true, delivery: await cancelAdminWorkspaceInvitation(actor, id) });
    }
    if (input.action === "resend") {
      const result = await retryAdminWorkspaceInvitation(actor, id);
      if (result.error) {
        return Response.json({ error: `Invitation email failed again: ${result.error}`, delivery: result.delivery }, { status: 502 });
      }
      return Response.json({ ok: true, delivery: result.delivery });
    }
    return Response.json({ error: "Choose resend or cancel." }, { status: 400 });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to update the invitation." }, { status: 400 });
    }
  }
}
