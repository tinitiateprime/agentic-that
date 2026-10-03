import crypto from "node:crypto";
import { accessErrorResponse, authorizeApiCapability, principalHasAccess } from "@platform/server/access-control";
import { listCentralAccounts } from "@platform/server/publishing-central-store";
import { createRedditAuthorization } from "@platform/server/reddit-publishing";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await authorizeApiCapability("publishing.accounts.configure");
    if (!principalHasAccess(actor, "publishing.reddit", "configure")) {
      return Response.json({ message: "Your role does not include configure access to publishing.reddit." }, { status: 403 });
    }
    const accountId = new URL(request.url).searchParams.get("accountId") || "";
    const account = (await listCentralAccounts(actor.workspaceId, "reddit")).find((item) => item.id === accountId);
    if (!account) return Response.json({ message: "Add the Reddit account in Config Manager first." }, { status: 404 });
    // Zernio hosts the Reddit sign-in and returns to our callback with this
    // state, which must match the cookie set here for the same user.
    const state = crypto.randomBytes(32).toString("base64url");
    const authorization = await createRedditAuthorization({ workspaceId: actor.workspaceId, accountId, state, requestUrl: request.url });
    const cookie = Buffer.from(JSON.stringify({ state, accountId, workspaceId: actor.workspaceId, userId: actor.userId })).toString("base64url");
    return new Response(null, {
      status: 302,
      headers: {
        location: authorization.url,
        "set-cookie": `reddit_publishing_oauth=${cookie}; Path=/api/publishing/reddit/callback; HttpOnly; SameSite=Lax; Max-Age=600${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ message: error instanceof Error ? error.message : "The Reddit connection could not start." }, { status: Number(error?.status) || 500 });
    }
  }
}
