import { getCurrentPrincipal } from "@platform/server/access-control";
import { listAccountWorkspaces, switchAccountWorkspace } from "@platform/server/workspace-team-store";

async function signedInPrincipal() {
  const principal = await getCurrentPrincipal();
  if (!principal || principal.status !== "active") {
    throw Object.assign(new Error("Sign in to continue."), { status: 401 });
  }
  return principal;
}

function failure(error) {
  return Response.json(
    { error: error instanceof Error ? error.message : "The workspace request failed." },
    { status: error?.status || 400 },
  );
}

export async function GET() {
  try {
    return Response.json(await listAccountWorkspaces(await signedInPrincipal()));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request) {
  try {
    const principal = await signedInPrincipal();
    const { workspaceId } = await request.json();
    return Response.json({ workspace: await switchAccountWorkspace(principal, workspaceId) });
  } catch (error) {
    return failure(error);
  }
}
