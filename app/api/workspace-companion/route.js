import { accessErrorResponse, authorizeApiCapability } from "@platform/server/access-control";
import {
  getWorkspaceCompanion,
  registerWorkspaceCompanion,
  removeWorkspaceCompanion,
} from "@platform/server/workspace-companion-store";

function failure(error) {
  try {
    return accessErrorResponse(error);
  } catch {
    return Response.json({ error: error instanceof Error ? error.message : "The Companion operation failed." }, { status: 400 });
  }
}

export async function GET() {
  try {
    const principal = await authorizeApiCapability("publishing.view");
    return Response.json({ companion: await getWorkspaceCompanion(principal.workspaceId) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request) {
  try {
    const principal = await authorizeApiCapability("publishing.accounts.configure");
    return Response.json({
      companion: await registerWorkspaceCompanion(principal, await request.json()),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE() {
  try {
    const principal = await authorizeApiCapability("publishing.accounts.configure");
    return Response.json(await removeWorkspaceCompanion(principal));
  } catch (error) {
    return failure(error);
  }
}
