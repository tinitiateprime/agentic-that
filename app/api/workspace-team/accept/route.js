import { platformSessionCookieHeader } from "@platform/server/auth-store";
import { acceptWorkspaceInvitation } from "@platform/server/workspace-team-store";

export async function POST(request) {
  try {
    const { token, name, password } = await request.json();
    const accepted = await acceptWorkspaceInvitation({ token, name, password });
    const response = Response.json({ ok: true, user: accepted.user });
    response.headers.append("Set-Cookie", platformSessionCookieHeader(accepted.token));
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to accept this invitation." }, { status: 400 });
  }
}
