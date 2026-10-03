import { accessErrorResponse, authorizeApiCapability } from "@platform/server/access-control";
import { cancelWorkspaceInvitation, resendWorkspaceInvitation } from "@platform/server/workspace-team-store";

export async function PATCH(request, { params }) {
  try {
    const principal = await authorizeApiCapability("workspace.team.manage");
    const { id } = await params;
    const input = await request.json();
    const invitation = input.action === "resend"
      ? await resendWorkspaceInvitation(principal, id)
      : input.action === "cancel"
        ? await cancelWorkspaceInvitation(principal, id)
        : null;
    if (!invitation) return Response.json({ error: "Choose resend or cancel." }, { status: 400 });
    const origin = new URL(request.url).origin;
    return Response.json({
      invitation: invitation.token
        ? { ...invitation, acceptUrl: `${origin}/join-workspace?token=${encodeURIComponent(invitation.token)}` }
        : invitation,
    });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "The invitation operation failed." }, { status: 400 });
    }
  }
}
