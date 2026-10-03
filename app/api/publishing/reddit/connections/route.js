import { accessErrorResponse, authorizeApiCapability, principalHasAccess } from "@platform/server/access-control";
import { listCentralAccounts, setCentralAccountApiConnection } from "@platform/server/publishing-central-store";
import { disconnectRedditConnection, redditConnectionConfiguration, redditConnectionSummaries } from "@platform/server/reddit-publishing";

export const dynamic = "force-dynamic";

async function redditActor(level) {
  const actor = await authorizeApiCapability(level === "configure" ? "publishing.accounts.configure" : "publishing.view");
  if (!principalHasAccess(actor, "publishing.reddit", level)) {
    throw Object.assign(new Error(`Your role does not include ${level} access to publishing.reddit.`), { status: 403 });
  }
  return actor;
}

function fail(error) {
  try { return accessErrorResponse(error); } catch {
    return Response.json({ message: error instanceof Error ? error.message : "The Reddit connection request failed." }, { status: Number(error?.status) || 500 });
  }
}

export async function GET() {
  try {
    const actor = await redditActor("view");
    const { configured } = redditConnectionConfiguration();
    return Response.json({ configured, connections: configured ? await redditConnectionSummaries(actor.workspaceId) : [] });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request) {
  try {
    const actor = await redditActor("configure");
    const accountId = new URL(request.url).searchParams.get("accountId") || "";
    const account = (await listCentralAccounts(actor.workspaceId, "reddit")).find((item) => item.id === accountId);
    if (!account) return Response.json({ message: "Reddit account was not found." }, { status: 404 });
    await disconnectRedditConnection(actor.workspaceId, accountId);
    return Response.json(await setCentralAccountApiConnection(actor.workspaceId, accountId, { connected: false }));
  } catch (error) {
    return fail(error);
  }
}
