import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { adminPublishingMonitoringSnapshot } from "@platform/server/admin-center-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await authorizeGlobalAdminApi();
    return Response.json({ ok: true, ...(await adminPublishingMonitoringSnapshot()) });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      console.error("Publishing monitor snapshot failed", error);
      return Response.json({ error: "Unable to load publishing activity." }, { status: 500 });
    }
  }
}
