import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { updateIdentityReview } from "@platform/server/admin-center-store";

export async function PATCH(request, { params }) {
  try {
    const actor = await authorizeGlobalAdminApi();
    const { id } = await params;
    return Response.json({ ok: true, review: await updateIdentityReview(actor, id, await request.json()) });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to update identity review." }, { status: 400 });
    }
  }
}
