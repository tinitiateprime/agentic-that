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

function normalizedPublicRequest(request) {
  const originHeader = request.headers.get("origin")?.trim();
  if (!originHeader) return request;

  let browserOrigin;
  try {
    browserOrigin = new URL(originHeader).origin;
  } catch {
    return request;
  }

  const allowedOrigins = new Set();
  const configuredPublicUrl = process.env.PLATFORM_PUBLIC_URL?.trim();
  if (configuredPublicUrl) {
    try { allowedOrigins.add(new URL(configuredPublicUrl).origin); } catch { /* validated by production config */ }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = request.headers.get("host")?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  for (const host of [forwardedHost, requestHost].filter(Boolean)) {
    try { allowedOrigins.add(new URL(`${forwardedProtocol}://${host}`).origin); } catch { /* ignore malformed proxy headers */ }
  }

  if (!allowedOrigins.has(browserOrigin)) return request;
  const publicUrl = new URL(request.url);
  const originUrl = new URL(browserOrigin);
  publicUrl.protocol = originUrl.protocol;
  publicUrl.host = originUrl.host;
  return publicUrl.origin === new URL(request.url).origin
    ? request
    : new Request(publicUrl, request);
}

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
    const response = await workspaceHandler(normalizedPublicRequest(request));
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
