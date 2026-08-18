import { getSql } from "@whatsapp/lib/db";
import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { credsForProvider } from "@whatsapp/lib/tenant";

export async function PATCH(req) {
  const user = await getCurrentUser("configure");
  if (!user) return whatsappAccessErrorResponse("configure");
  const { name, admin_number, currency, active_wa_provider } = await req.json();
  const sql = await getSql();
  const [biz] = await sql`SELECT * FROM businesses WHERE id = ${user.business_id}`;
  const nextProvider = active_wa_provider === undefined
    ? biz.active_wa_provider
    : String(active_wa_provider || "").toLowerCase();
  if (nextProvider && !["meta", "wati", "mock"].includes(nextProvider)) {
    return Response.json({ error: "Unsupported messaging provider" }, { status: 400 });
  }
  if (nextProvider && nextProvider !== "mock") {
    const configured = await credsForProvider(user.business_id, nextProvider);
    if (!configured) {
      return Response.json({ error: `Connect ${nextProvider === "meta" ? "Meta" : "WATI"} before making it active` }, { status: 400 });
    }
  }
  await sql`
    UPDATE businesses
       SET name = ${name?.trim() || biz.name},
           admin_number = ${admin_number?.trim() || biz.admin_number},
           currency = ${currency?.trim() || biz.currency},
           provider = ${nextProvider || biz.provider},
           active_wa_provider = ${nextProvider}
     WHERE id = ${user.business_id}`;
  return Response.json({ ok: true });
}
