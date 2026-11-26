import { accessErrorResponse, authorizeOpenServiceApi } from "@platform/server/access-control";
import { importAnalyticsFile, MAX_IMPORT_BYTES, socialAnalyticsReport } from "@platform/server/social-analytics-store";
import { AnalyticsImportError } from "@platform/social-analytics/parse-export";
import { autoSyncState } from "@platform/server/social-analytics-sync";

export const runtime = "nodejs";

async function companyPrincipal() {
  const principal = await authorizeOpenServiceApi();
  if (!principal.workspaceId) throw Object.assign(new Error("Join a company workspace to use Social Manager."), { status: 403 });
  return principal;
}

function failure(error) {
  if (error instanceof AnalyticsImportError) return Response.json({ error: error.message }, { status: 422 });
  try { return accessErrorResponse(error); } catch {
    return Response.json({ error: error instanceof Error ? error.message : "Social analytics could not be loaded." }, { status: error?.status || 400 });
  }
}

// Every member of a company can see its analytics.
export async function GET(request) {
  try {
    const principal = await companyPrincipal();
    const query = new URL(request.url).searchParams;
    const days = query.get("days") === "all" ? "all" : Number(query.get("days") || 30);
    const autoSync = await autoSyncState(principal.workspaceId);
    return Response.json({ ...(await socialAnalyticsReport(principal, { days, platform: query.get("platform") || "all" })), autoSync });
  } catch (error) {
    return failure(error);
  }
}

// Upload an analytics export (CSV, XLSX, or YouTube Studio's zip).
export async function POST(request) {
  try {
    const principal = await companyPrincipal();
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return Response.json({ error: "Choose an analytics file to upload." }, { status: 400 });
    if (file.size > MAX_IMPORT_BYTES) return Response.json({ error: "The file is larger than 5 MB. Export a shorter date range." }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await importAnalyticsFile(principal, { fileName: file.name, bytes, platform: String(form.get("platform") || "") });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
