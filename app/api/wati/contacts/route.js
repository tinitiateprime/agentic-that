import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { watiGetContacts, watiConfigured, normalizeWaNumber } from "@whatsapp/lib/wa/provider";
import { existingPhoneSet } from "@whatsapp/lib/data";
import { credsForProvider } from "@whatsapp/lib/tenant";

// Returns the business's primary contacts pulled live from WATI, each flagged
// with whether it already exists in the CRM (inCrm).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return whatsappAccessErrorResponse("view");
  const creds = await credsForProvider(user.business_id, "wati");

  if (!watiConfigured(creds)) {
    return Response.json({
      configured: false,
      contacts: [],
      error:
        "WATI isn't configured yet. Add WATI_API_URL (with your tenant id) and WATI_ACCESS_TOKEN to .env.local, then refresh.",
    });
  }

  try {
    const contacts = await watiGetContacts({ pageSize: 100 }, creds);
    const have = await existingPhoneSet(user.business_id);
    const annotated = contacts.map((c) => ({
      ...c,
      inCrm: have.has(normalizeWaNumber(c.phone)),
    }));
    return Response.json({ configured: true, count: annotated.length, contacts: annotated });
  } catch (err) {
    return Response.json({ configured: true, contacts: [], error: err.message }, { status: 502 });
  }
}
