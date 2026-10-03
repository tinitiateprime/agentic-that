import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { getProjectAsset, projectRepositoryErrorResponse } from "@platform/server/project-management-repository";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await authorizeGlobalAdminApi();
    const asset = await getProjectAsset(new URL(request.url).searchParams.get("path") || "");
    return new Response(asset.body, {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        // Repository SVGs are untrusted; never let one run script if opened directly.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return projectRepositoryErrorResponse(error, "Unable to load this image.");
    }
  }
}
