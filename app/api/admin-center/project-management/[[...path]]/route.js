import { createProjectWorkspaceHandler } from "@project-workspace/embedded/server";
import {
  accessErrorResponse,
  authorizeGlobalAdminApi,
} from "@platform/server/access-control";
import {
  hydrateProjectWorkspaceData,
  persistProjectWorkspaceData,
  projectWorkspaceDataDirectory,
} from "@platform/server/project-workspace-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const apiBasePath = "/api/admin-center/project-management";
const dataDirectory = projectWorkspaceDataDirectory();
const workspaceHandler = createProjectWorkspaceHandler({
  apiBasePath,
  dataDirectory,
  getIdentity: async () => {
    const principal = await authorizeGlobalAdminApi();
    return {
      userId: principal.userId,
      tenantId: "agentic-that-global-admin-center",
      canManageRepositories: true,
    };
  },
});

async function handle(request) {
  try {
    await authorizeGlobalAdminApi();
    await hydrateProjectWorkspaceData(dataDirectory);
    const response = await workspaceHandler(request);
    await persistProjectWorkspaceData(dataDirectory);
    return response;
  } catch (error) {
    try {
      return accessErrorResponse(error);
    } catch {
      console.error("Admin project management request failed", error);
      return Response.json(
        { message: "Project management could not complete the request." },
        { status: 500 },
      );
    }
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
