import { getCurrentUser } from "@whatsapp/lib/auth";
import { getBusiness, getContact } from "@whatsapp/lib/data";
import { recordInbound } from "@whatsapp/lib/wa/messaging";
import { credsForBusiness } from "@whatsapp/lib/tenant";

// DEV/DEMO ONLY: pretend the customer tapped a button (or sent text). With a
// real provider this path is the WATI webhook instead. Disabled unless the
// active provider is the mock, so it can't fabricate inbound traffic in prod.
export async function POST(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const creds = await credsForBusiness(user.business_id);
  if (creds.provider !== "mock") {
    return Response.json({ error: "Simulation disabled for live providers" }, { status: 400 });
  }

  const { contactId, text, buttonReply } = await req.json();
  const business = await getBusiness(user.business_id);
  const contact = await getContact(user.business_id, contactId);
  if (!contact) return Response.json({ error: "Contact not found" }, { status: 404 });
  if (!text?.trim()) return Response.json({ error: "text required" }, { status: 400 });

  const message = await recordInbound({
    business,
    contact,
    body: text.trim(),
    buttonReply: Boolean(buttonReply),
    provider: "mock",
  });
  return Response.json({ ok: true, message });
}
