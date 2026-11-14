import { accessErrorResponse, authorizeOpenServiceApi } from "@platform/server/access-control";
import { signServiceAccessToken } from "@/lib/service-access-token.js";

export const dynamic = "force-dynamic";

// The shared Telegram app identity (my.telegram.org), when this deployment has
// one; otherwise the user enters their own when connecting Telegram.
function telegramApp() {
  const apiId = Number(process.env.TELEGRAM_API_ID || "");
  const apiHash = String(process.env.TELEGRAM_API_HASH || "").trim();
  return Number.isInteger(apiId) && apiId > 0 && /^[a-f0-9]{32}$/i.test(apiHash) ? { apiId, apiHash } : null;
}

// A five-minute token that lets this user's Companion manage their contacts and
// their WhatsApp, Telegram and Discord groups. Open to every signed-in, active user.
export async function POST() {
  try {
    const principal = await authorizeOpenServiceApi();
    const token = signServiceAccessToken({
      audience: "group-manager",
      subject: principal.userId,
      workspaceId: principal.workspaceId || `user:${principal.userId}`,
      grants: { "messaging.group-manager": "operate" },
      capabilities: ["groups.manage"],
      name: principal.name,
      email: principal.email,
    });
    return Response.json({ ok: true, token, expiresInSeconds: 300, telegramApp: telegramApp() });
  } catch (error) {
    try {
      return accessErrorResponse(error);
    } catch {
      console.error("Group Manager companion token failed", error);
      return Response.json({ error: "Unable to connect to the Companion." }, { status: 500 });
    }
  }
}
