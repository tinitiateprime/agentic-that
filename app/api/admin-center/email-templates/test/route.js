import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { sendInvitationTemplateTest } from "@platform/server/admin-communications-store";

export async function POST(request) {
  try {
    const actor = await authorizeGlobalAdminApi();
    const result = await sendInvitationTemplateTest(actor, await request.json());
    return Response.json({ ok: true, ...result });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to send the test email." }, { status: 400 });
    }
  }
}
