import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { updateInvitationTemplate } from "@platform/server/admin-communications-store";

export async function PATCH(request, { params }) {
  try {
    const actor = await authorizeGlobalAdminApi();
    const { id } = await params;
    const template = await updateInvitationTemplate(actor, id, await request.json());
    return Response.json({ ok: true, template });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to update the template." }, { status: 400 });
    }
  }
}
