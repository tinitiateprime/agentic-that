import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { deleteRole, updateRole } from "@platform/server/admin-center-store";

export async function PATCH(request, { params }) {
  try {
    const actor = await authorizeGlobalAdminApi();
    const { id } = await params;
    return Response.json({ ok: true, role: await updateRole(actor, id, await request.json()) });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to update role." }, { status: 400 });
    }
  }
}

export async function DELETE(_request, { params }) {
  try {
    const actor = await authorizeGlobalAdminApi();
    const { id } = await params;
    return Response.json(await deleteRole(actor, id));
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to delete role." }, { status: 400 });
    }
  }
}
