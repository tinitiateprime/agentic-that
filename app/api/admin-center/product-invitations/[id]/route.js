import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { retryAdminProductInvitation } from "@platform/server/admin-communications-store";

export async function PATCH(request, { params }) {
  try {
    const actor = await authorizeGlobalAdminApi();
    const { id } = await params;
    const input = await request.json();
    if (input.action !== "resend") {
      return Response.json({ error: "Choose resend." }, { status: 400 });
    }
    const result = await retryAdminProductInvitation(actor, id);
    if (result.error) {
      return Response.json({ error: `Product invitation failed again: ${result.error}`, delivery: result.delivery }, { status: 502 });
    }
    return Response.json({ ok: true, delivery: result.delivery });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to resend the product invitation." }, { status: 400 });
    }
  }
}
