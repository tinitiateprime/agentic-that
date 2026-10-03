import crypto from "node:crypto";
import { accessErrorResponse, authorizeApiCapability, principalHasAccess } from "@platform/server/access-control";
import { setCentralAccountApiConnection } from "@platform/server/publishing-central-store";
import { completeRedditConnection } from "@platform/server/reddit-publishing";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function cookieValue(request, key) {
  const value = request.headers.get("cookie") || "";
  const pair = value.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${key}=`));
  return pair ? pair.slice(key.length + 1) : "";
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function finish(request, outcome) {
  const url = new URL("/config-manager", request.url);
  url.searchParams.set("service", "publishing");
  url.searchParams.set("platform", "reddit");
  url.searchParams.set("reddit", outcome);
  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      "set-cookie": `reddit_publishing_oauth=; Path=/api/publishing/reddit/callback; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
      "cache-control": "no-store",
    },
  });
}

export async function GET(request) {
  try {
    const actor = await authorizeApiCapability("publishing.accounts.configure");
    if (!principalHasAccess(actor, "publishing.reddit", "configure")) return finish(request, "denied");
    let pending;
    try { pending = JSON.parse(Buffer.from(cookieValue(request, "reddit_publishing_oauth"), "base64url").toString("utf8")); }
    catch { return finish(request, "expired"); }
    const query = new URL(request.url).searchParams;
    if (!sameSecret(pending.state, query.get("state")) || pending.workspaceId !== actor.workspaceId || pending.userId !== actor.userId) {
      return finish(request, "expired");
    }
    // Zernio appends connected=reddit&accountId=… on success, error=… on failure.
    if (query.get("error")) return finish(request, query.get("error") === "oauth_denied" ? "denied" : "failed");
    if (query.get("connected") !== "reddit" || !query.get("accountId")) return finish(request, "failed");
    const connection = await completeRedditConnection(actor.workspaceId, pending.accountId, query.get("accountId"));
    await setCentralAccountApiConnection(actor.workspaceId, pending.accountId, { connected: true, username: connection.username });
    return finish(request, "connected");
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      console.error("Reddit publishing connection failed", { status: Number(error?.status) || 500, message: error instanceof Error ? error.message : "Unknown error" });
      return finish(request, "failed");
    }
  }
}
