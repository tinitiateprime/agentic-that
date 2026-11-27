import { accessErrorResponse, authorizeOpenServiceApi } from "@platform/server/access-control";
import { autoSyncState } from "@platform/server/social-analytics-sync";
import { inboxOverview, inboxTableMissing, saveReply, updateInboxItem } from "@platform/server/social-inbox-store";
import { inboxSources, refreshInboxCollections, updateInboxSource } from "@platform/server/social-inbox-collect";

// YouTube comment checks (newer migration): the inbox works without them.
async function withSources(principal, overview) {
  try {
    return { ...overview, sources: await inboxSources(principal.workspaceId) };
  } catch (error) {
    if (!inboxTableMissing(error)) console.error("Social inbox sources could not be read", error);
    return { ...overview, sources: null };
  }
}

async function refreshCollections(workspaceId) {
  try {
    await refreshInboxCollections(workspaceId);
  } catch (error) {
    if (!inboxTableMissing(error)) console.error("Social inbox checks could not be read", error);
  }
}

export const runtime = "nodejs";

async function companyPrincipal() {
  const principal = await authorizeOpenServiceApi();
  if (!principal.workspaceId) throw Object.assign(new Error("Join a company workspace to use Social Manager."), { status: 403 });
  return principal;
}

function failure(error) {
  if (inboxTableMissing(error)) return Response.json({ unavailable: true });
  try { return accessErrorResponse(error); } catch {
    return Response.json({ error: error instanceof Error ? error.message : "The inbox could not be loaded." }, { status: error?.status || 400 });
  }
}

// Every member of a company sees and works its inbox.
export async function GET() {
  try {
    const principal = await companyPrincipal();
    // Finished automatic updates bring new comments; add them first.
    await autoSyncState(principal.workspaceId);
    await refreshCollections(principal.workspaceId);
    return Response.json(await withSources(principal, await inboxOverview(principal)));
  } catch (error) {
    return failure(error);
  }
}

// { type: "item", id, action, assigneeId, snooze, timezoneOffsetMinutes, note }
// { type: "reply", id, title, body, remove }
// { type: "source", accountId, enabled, checkNow }
export async function POST(request) {
  try {
    const principal = await companyPrincipal();
    const body = await request.json().catch(() => ({}));
    if (body?.type === "reply") return Response.json(await withSources(principal, await saveReply(principal, body)));
    if (body?.type === "source") {
      await updateInboxSource(principal, { accountId: body.accountId, enabled: body.enabled !== false, checkNow: body.checkNow === true });
      return Response.json(await withSources(principal, await inboxOverview(principal)));
    }
    return Response.json(await withSources(principal, await updateInboxItem(principal, body || {})));
  } catch (error) {
    return failure(error);
  }
}
