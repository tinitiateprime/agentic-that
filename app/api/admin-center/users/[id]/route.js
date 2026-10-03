import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { updateAdminUser } from "@platform/server/admin-center-store";

export async function PATCH(request, { params }) {
  try {
    const actor = await authorizeGlobalAdminApi();
    const { id } = await params;
    return Response.json({ ok: true, user: await updateAdminUser(actor, id, await request.json()) });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to update user." }, { status: 400 });
    }
  }
}
