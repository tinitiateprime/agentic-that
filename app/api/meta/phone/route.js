import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { metaGetPhoneNumberStatus, metaConfigured } from "@whatsapp/lib/wa/provider";
import { credsForBusiness } from "@whatsapp/lib/tenant";

// Live status for a Meta phone number: ?id=<Phone Number ID> (defaults to
// META_PHONE_NUMBER_ID if omitted).
export async function GET(req) {
  const user = await getCurrentUser();
  if (!user) return whatsappAccessErrorResponse("view");
  const creds = await credsForBusiness(user.business_id);

  if (!metaConfigured(creds)) {
    return Response.json({ error: "Meta isn't configured — set META_ACCESS_TOKEN in .env.local." }, { status: 400 });
  }

  const phoneNumberId = new URL(req.url).searchParams.get("id") || process.env.META_PHONE_NUMBER_ID;
  if (!phoneNumberId) return Response.json({ error: "Enter a Phone Number ID" }, { status: 400 });

  try {
    const status = await metaGetPhoneNumberStatus({ phoneNumberId, creds });
    return Response.json({ ok: true, status });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
