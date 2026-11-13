import { accessErrorResponse, authorizeOpenServiceApi } from "@platform/server/access-control";
import { signServiceAccessToken } from "@/lib/service-access-token.js";

export const dynamic = "force-dynamic";

// A five-minute token that lets this user's Companion use their connected AI accounts
// for Social SEO. Social SEO is open to every signed-in, active user.
export async function POST() {
  try {
    const principal = await authorizeOpenServiceApi();
    const token = signServiceAccessToken({
      audience: "social-seo",
      subject: principal.userId,
      workspaceId: principal.workspaceId || `user:${principal.userId}`,
      grants: { "seo.social-seo": "operate" },
      capabilities: ["seo.generate"],
      name: principal.name,
      email: principal.email,
    });
    return Response.json({ ok: true, token, expiresInSeconds: 300 });
  } catch (error) {
    try {
      return accessErrorResponse(error);
    } catch {
      console.error("Social SEO companion token failed", error);
      return Response.json({ error: "Unable to connect to the Companion." }, { status: 500 });
    }
  }
}
