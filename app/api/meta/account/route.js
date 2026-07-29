import { getCurrentUser } from "@whatsapp/lib/auth";
import { getSql } from "@whatsapp/lib/db";
import { updateMetaAccount, syncNumbers } from "@whatsapp/lib/tenant";
import { metaListPhoneNumbers } from "@whatsapp/lib/wa/provider";

// Settings -> "WhatsApp connection" -> Meta panel. Point an already-onboarded
// business at a different WABA/token (new Meta app, rotated credentials,
// etc.) without hand-editing the database or relying on env vars, which only
// apply to a business with no account row at all.
export async function PATCH(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { wabaId, accessToken, appId, appSecret, apiVersion } = await req.json();
  if (!wabaId?.trim() || !accessToken?.trim()) {
    return Response.json({ error: "WABA id and access token are required" }, { status: 400 });
  }

  // Verify against Meta's live API before writing anything — a bad token/id
  // should never overwrite a working configuration.
  let liveNumbers;
  try {
    liveNumbers = await metaListPhoneNumbers({
      accessToken: accessToken.trim(),
      wabaId: wabaId.trim(),
      apiVersion: apiVersion?.trim() || "v21.0",
    });
  } catch (err) {
    return Response.json({ error: `Couldn't verify with Meta: ${err.message}` }, { status: 400 });
  }
  if (!liveNumbers.length) {
    return Response.json(
      { error: "Meta accepted these credentials but this WABA has no phone numbers on it." },
      { status: 400 }
    );
  }

  let account;
  try {
    account = await updateMetaAccount(user.business_id, {
      wabaId: wabaId.trim(),
      accessToken: accessToken.trim(),
      appId: appId?.trim(),
      appSecret: appSecret?.trim(),
      apiVersion: apiVersion?.trim(),
    });
  } catch (err) {
    const claimed = /already connected|unique|duplicate/i.test(String(err?.message));
    return Response.json(
      { error: claimed ? "This WhatsApp Business Account is already connected to another workspace." : err.message },
      { status: claimed ? 409 : 400 }
    );
  }
  let numbers;
  try {
    numbers = await syncNumbers(account.id, liveNumbers, { defaultPhoneNumberId: liveNumbers[0].id });
  } catch (err) {
    const conflict = /already connected/i.test(String(err?.message));
    return Response.json({ error: err.message || "Could not save these phone numbers" }, { status: conflict ? 409 : 400 });
  }
  const sql = await getSql();
  await sql`
    UPDATE businesses
       SET provider = 'meta',
           active_wa_provider = CASE
             WHEN active_wa_provider IS NULL OR active_wa_provider = 'mock' THEN 'meta'
             ELSE active_wa_provider
           END,
           onboarded_at = COALESCE(onboarded_at, now())
     WHERE id = ${user.business_id}`;

  return Response.json({ ok: true, numbers });
}
