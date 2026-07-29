import { getCurrentUser } from "@whatsapp/lib/auth";
import { getSql } from "@whatsapp/lib/db";
import { credsForProvider, upsertAccount } from "@whatsapp/lib/tenant";
import { watiGetContacts } from "@whatsapp/lib/wa/provider";

// Settings -> WATI onboarding. Credentials are verified live before the
// encrypted account row is created or updated.
export async function PATCH(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const existing = await credsForProvider(user.business_id, "wati");
  const serviceUrl = String(body.apiUrl || existing?.serviceUrl || "").trim().replace(/\/$/, "");
  const accessToken = String(body.accessToken || existing?.accessToken || "").trim();
  const webhookSecret = String(body.webhookSecret || existing?.webhookVerifyToken || "").trim();

  let parsed;
  try {
    parsed = new URL(serviceUrl);
  } catch {
    return Response.json({ error: "Enter a valid WATI API endpoint URL" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || !accessToken || !webhookSecret) {
    return Response.json(
      { error: "A secure API endpoint, access token, and webhook secret are required" },
      { status: 400 }
    );
  }

  let contacts;
  try {
    contacts = await watiGetContacts(
      { pageSize: 1 },
      { provider: "wati", serviceUrl, accessToken }
    );
  } catch (err) {
    return Response.json({ error: `Couldn't verify with WATI: ${err.message}` }, { status: 400 });
  }

  try {
    await upsertAccount({
      businessId: user.business_id,
      wabaId: `wati:${user.business_id}`,
      accessToken,
      webhookVerifyToken: webhookSecret,
      provider: "wati",
      onboardingSource: "settings",
      status: "active",
      serviceUrl,
    });
  } catch (err) {
    return Response.json({ error: err.message || "Could not save the WATI connection" }, { status: 400 });
  }

  if (body.makeActive) {
    const sql = await getSql();
    await sql`
      UPDATE businesses
         SET active_wa_provider = 'wati', provider = 'wati', onboarded_at = COALESCE(onboarded_at, now())
       WHERE id = ${user.business_id}`;
  }

  return Response.json({
    ok: true,
    contactCheck: contacts.length,
    webhookSecured: Boolean(webhookSecret),
  });
}
