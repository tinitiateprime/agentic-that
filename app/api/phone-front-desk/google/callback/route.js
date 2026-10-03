import crypto from "node:crypto";
import { accessErrorResponse, assertPrincipalCapability, authorizeApiAccess } from "@platform/server/access-control";
import { phoneFrontDeskIntegrationsEnabled } from "@platform/server/phone-front-desk-store";
import { exchangeGoogleCode, saveGoogleConnection } from "@platform/server/phone-front-desk-google";

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
  const url = new URL("/phone-front-desk", request.url);
  url.searchParams.set("google", outcome);
  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      "set-cookie": `pfd_google_oauth=; Path=/api/phone-front-desk/google/callback; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
      "cache-control": "no-store",
    },
  });
}

export async function GET(request) {
  try {
    const actor = await assertPrincipalCapability(await authorizeApiAccess("messaging.ai-phone-front-desk", "configure"), "messaging.configure");
    if (!phoneFrontDeskIntegrationsEnabled()) return finish(request, "disabled");
    let pending;
    try { pending = JSON.parse(Buffer.from(cookieValue(request, "pfd_google_oauth"), "base64url").toString("utf8")); }
    catch { return finish(request, "expired"); }
    const query = new URL(request.url).searchParams;
    if (!sameSecret(pending.state, query.get("state")) || pending.workspaceId !== actor.workspaceId || pending.userId !== actor.userId) {
      return finish(request, "expired");
    }
    if (query.get("error")) return finish(request, "denied");
    const grant = await exchangeGoogleCode(pending.kind, query.get("code"), pending.verifier, request.url);
    await saveGoogleConnection(actor.workspaceId, pending.kind, grant);
    return finish(request, pending.kind === "calendar" ? "calendar-connected" : "mail-connected");
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      console.error("AI Phone Front Desk Google connection failed", { status: Number(error?.status) || 500, message: error instanceof Error ? error.message : "Unknown error" });
      return finish(request, "failed");
    }
  }
}
