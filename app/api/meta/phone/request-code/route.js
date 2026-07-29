import { getCurrentUser } from "@whatsapp/lib/auth";
import { metaRequestVerificationCode, metaConfigured } from "@whatsapp/lib/wa/provider";
import { credsForBusiness } from "@whatsapp/lib/tenant";

// Kicks off Meta's SMS/voice verification for a phone number id (Meta then
// sends a code to that number's carrier connection).
export async function POST(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const creds = await credsForBusiness(user.business_id);

  if (!metaConfigured(creds)) {
    return Response.json({ error: "Meta isn't configured — set META_ACCESS_TOKEN in .env.local." }, { status: 400 });
  }

  const { phoneNumberId, codeMethod } = await req.json();
  if (!phoneNumberId) return Response.json({ error: "Enter a Phone Number ID" }, { status: 400 });

  try {
    await metaRequestVerificationCode({ phoneNumberId, codeMethod: codeMethod || "SMS", creds });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
