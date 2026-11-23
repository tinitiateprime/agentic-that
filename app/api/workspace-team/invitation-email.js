import { platformAuthLink, sendWorkspaceInvitationEmail } from "@platform/server/auth-email";
import { workspaceInvitationEmailDetails } from "@platform/server/workspace-team-store";

// Email the invitation and keep the copyable link as a fallback. A delivery
// failure never undoes the invitation; the owner can copy the link instead.
export async function withInvitationEmail(principal, invitation) {
  const acceptUrl = platformAuthLink("/join-workspace", invitation.token);
  try {
    const details = await workspaceInvitationEmailDetails(principal, invitation.roleIds);
    await sendWorkspaceInvitationEmail(invitation.email, invitation.token, {
      ...details,
      idempotencyKey: `workspace-invitation:${invitation.id}:${invitation.updatedAt}`,
    });
    return { ...invitation, acceptUrl, emailSent: true };
  } catch (error) {
    console.error("Workspace invitation email failed", error instanceof Error ? error.message : error);
    return {
      ...invitation,
      acceptUrl,
      emailSent: false,
      emailError: error instanceof Error ? error.message : "The invitation email could not be sent.",
    };
  }
}
