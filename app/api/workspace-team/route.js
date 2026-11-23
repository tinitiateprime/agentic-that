import { accessErrorResponse, authorizeApiCapability } from "@platform/server/access-control";
import { inviteWorkspaceMember, workspaceTeamSnapshot } from "@platform/server/workspace-team-store";
import { withInvitationEmail } from "./invitation-email";

function failure(error) {
  try {
    return accessErrorResponse(error);
  } catch {
    return Response.json({ error: error instanceof Error ? error.message : "The team operation failed." }, { status: 400 });
  }
}

export async function GET() {
  try {
    const principal = await authorizeApiCapability("workspace.team.manage");
    return Response.json(await workspaceTeamSnapshot(principal));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request) {
  try {
    const principal = await authorizeApiCapability("workspace.team.manage");
    const invitation = await inviteWorkspaceMember(principal, await request.json());
    return Response.json({ invitation: await withInvitationEmail(principal, invitation) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
