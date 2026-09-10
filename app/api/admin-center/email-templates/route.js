import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { createInvitationTemplate } from "@platform/server/admin-communications-store";

export async function POST(request) {
  try {
    const actor = await authorizeGlobalAdminApi();
    const template = await createInvitationTemplate(actor, await request.json());
    return Response.json({ ok: true, template }, { status: 201 });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to create the template." }, { status: 400 });
    }
  }
}
