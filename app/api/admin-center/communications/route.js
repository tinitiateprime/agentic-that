import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { adminCommunicationsSnapshot } from "@platform/server/admin-communications-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await authorizeGlobalAdminApi();
    return Response.json({ ok: true, ...(await adminCommunicationsSnapshot()) });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      console.error("Admin communications snapshot failed", error);
      return Response.json({ error: error instanceof Error ? error.message : "Unable to load Email Studio." }, { status: 500 });
    }
  }
}
