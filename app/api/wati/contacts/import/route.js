import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { watiGetContacts, watiConfigured, normalizeWaNumber } from "@whatsapp/lib/wa/provider";
import { importContacts } from "@whatsapp/lib/data";
import { credsForProvider } from "@whatsapp/lib/tenant";

// Import WATI contacts into the CRM. Body: { phones?: string[] }
//   - no phones  -> import all new contacts
//   - phones[]   -> import just those numbers
export async function POST(req) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");
  const creds = await credsForProvider(user.business_id, "wati");
  if (!watiConfigured(creds)) {
    return Response.json({ error: "WATI isn't configured." }, { status: 400 });
  }

  const { phones } = await req.json().catch(() => ({}));

  let contacts;
  try {
    contacts = await watiGetContacts({ pageSize: 100 }, creds);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }

  if (Array.isArray(phones) && phones.length > 0) {
    const wanted = new Set(phones.map(normalizeWaNumber));
    contacts = contacts.filter((c) => wanted.has(normalizeWaNumber(c.phone)));
  }

  const result = await importContacts(user.business_id, contacts);
  return Response.json({ ok: true, ...result });
}
