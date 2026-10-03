import { accessErrorResponse, authorizeApiCapability } from "@platform/server/access-control";
import { inviteWorkspaceMember, workspaceTeamSnapshot } from "@platform/server/workspace-team-store";

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
    const origin = new URL(request.url).origin;
    return Response.json({
      invitation: {
        ...invitation,
        acceptUrl: `${origin}/join-workspace?token=${encodeURIComponent(invitation.token)}`,
      },
    }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
