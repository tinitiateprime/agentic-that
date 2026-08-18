import { accessErrorResponse, authorizeApiCapability } from "@platform/server/access-control";
import { removeWorkspaceMember, updateWorkspaceMember } from "@platform/server/workspace-team-store";

function failure(error) {
  try { return accessErrorResponse(error); } catch {
    return Response.json({ error: error instanceof Error ? error.message : "The member operation failed." }, { status: 400 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const principal = await authorizeApiCapability("workspace.team.manage");
    const { id } = await params;
    return Response.json({ member: await updateWorkspaceMember(principal, id, await request.json()) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request, { params }) {
  try {
    const principal = await authorizeApiCapability("workspace.team.manage");
    const { id } = await params;
    return Response.json(await removeWorkspaceMember(principal, id));
  } catch (error) {
    return failure(error);
  }
}
