import { accessErrorResponse, authorizeOpenServiceApi } from "@platform/server/access-control";
import { autoSyncState, runSyncNow, saveSyncSource } from "@platform/server/social-analytics-sync";

export const runtime = "nodejs";

async function companyPrincipal() {
  const principal = await authorizeOpenServiceApi();
  if (!principal.workspaceId) throw Object.assign(new Error("Join a company workspace to use Social Manager."), { status: 403 });
  return principal;
}

function failure(error) {
  try { return accessErrorResponse(error); } catch {
    return Response.json({ error: error instanceof Error ? error.message : "Automatic updates could not be changed." }, { status: error?.status || 400 });
  }
}

// Status of the automatic Instagram / Facebook updates.
export async function GET() {
  try {
    const principal = await companyPrincipal();
    return Response.json({ autoSync: await autoSyncState(principal.workspaceId) });
  } catch (error) {
    return failure(error);
  }
}

// { action: "save", platform, profileUrl, enabled, timezoneOffsetMinutes } or { action: "run" }.
export async function POST(request) {
  try {
    const principal = await companyPrincipal();
    const body = await request.json().catch(() => ({}));
    const autoSync = body?.action === "run"
      ? await runSyncNow(principal)
      : await saveSyncSource(principal, {
        platform: String(body?.platform || ""),
        profileUrl: String(body?.profileUrl || ""),
        enabled: body?.enabled !== false,
        timezoneOffsetMinutes: Number(body?.timezoneOffsetMinutes) || 0,
      });
    return Response.json({ autoSync });
  } catch (error) {
    return failure(error);
  }
}
