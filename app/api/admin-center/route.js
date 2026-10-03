import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { adminCenterSnapshot } from "@platform/server/admin-center-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await authorizeGlobalAdminApi();
    return Response.json({ ok: true, ...(await adminCenterSnapshot()) });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      console.error("Admin Center snapshot failed", error);
      return Response.json({ error: "Unable to load Admin Center." }, { status: 500 });
    }
  }
}
