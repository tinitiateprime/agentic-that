import { accessErrorResponse, assertPrincipalCapability, authorizeApiAccess } from "@platform/server/access-control";
import { phoneFrontDeskIntegrationsEnabled } from "@platform/server/phone-front-desk-store";
import { createGoogleAuthorization } from "@platform/server/phone-front-desk-google";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await assertPrincipalCapability(await authorizeApiAccess("messaging.ai-phone-front-desk", "configure"), "messaging.configure");
    if (!phoneFrontDeskIntegrationsEnabled()) return Response.json({ error: "Google connections are not enabled." }, { status: 404 });
    const kind = new URL(request.url).searchParams.get("kind");
    const authorization = createGoogleAuthorization(kind, request.url);
    const cookie = Buffer.from(JSON.stringify({ kind, state: authorization.state, verifier: authorization.verifier, workspaceId: actor.workspaceId, userId: actor.userId })).toString("base64url");
    return new Response(null, {
      status: 302,
      headers: {
        location: authorization.url,
        "set-cookie": `pfd_google_oauth=${cookie}; Path=/api/phone-front-desk/google/callback; HttpOnly; SameSite=Lax; Max-Age=600${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Google connection could not start." }, { status: Number(error?.status) || 500 });
    }
  }
}
