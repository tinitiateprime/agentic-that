import {
  accessErrorResponse,
  getCurrentPrincipal,
  issueServiceToken,
} from "@platform/server/access-control";

export async function POST(request) {
  try {
    const principal = await getCurrentPrincipal();
    const body = await request.json();
    const audience = String(body?.audience || "").trim();
    const token = await issueServiceToken(principal, audience);
    return Response.json({ ok: true, token, expiresInSeconds: 300 });
  } catch (error) {
    try {
      return accessErrorResponse(error);
    } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to issue service token." }, { status: 400 });
    }
  }
}
