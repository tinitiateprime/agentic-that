import { getCurrentPlatformUser } from "@platform/server/auth-store";
import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { getSql } from "@whatsapp/lib/db";
import { credsForProvider, listTenantNumbers } from "@whatsapp/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const platformUser = await getCurrentPlatformUser();
  if (!platformUser) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceUser = await getCurrentUser();
  if (!workspaceUser) return whatsappAccessErrorResponse("view");

  const sql = await getSql();
  const [business] = await sql`
    SELECT name, provider, active_wa_provider, onboarded_at
      FROM businesses WHERE id = ${workspaceUser.business_id}`;

  const [meta, wati, numbers] = await Promise.all([
    credsForProvider(workspaceUser.business_id, "meta"),
    credsForProvider(workspaceUser.business_id, "wati"),
    listTenantNumbers(workspaceUser.business_id),
  ]);
  const metaReady = Boolean(meta?.accessToken && (meta?.defaultPhoneNumberId || numbers.length));
  const watiReady = Boolean(wati?.accessToken && wati?.serviceUrl);
  const connected = metaReady || watiReady;
  const activeProvider = String(business?.active_wa_provider || business?.provider || "").toLowerCase();

  return Response.json({
    ok: true,
    workspace: {
      name: business?.name || platformUser.businessName || "My workspace",
    },
    whatsapp: {
      connected,
      onboarded: Boolean(business?.onboarded_at),
      provider: connected ? (activeProvider === "wati" && watiReady ? "wati" : metaReady ? "meta" : "wati") : null,
      senderCount: numbers.length,
    },
  });
}
