import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { getBusiness, getContact, getMessage } from "@whatsapp/lib/data";
import { reactToMessage } from "@whatsapp/lib/wa/messaging";

// Add or remove a reaction on one inbound message. The message, contact, and
// business lookups are all scoped to the authenticated AgenticThat workspace.
export async function POST(req) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");

  const body = await req.json().catch(() => null);
  const messageId = Number(body?.messageId);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    return Response.json({ error: "A valid messageId is required." }, { status: 400 });
  }
  if (body?.emoji != null && typeof body.emoji !== "string") {
    return Response.json({ error: "Reaction must be an emoji or an empty string." }, { status: 400 });
  }

  const business = await getBusiness(user.business_id);
  if (!business) return Response.json({ error: "WhatsApp workspace not found." }, { status: 404 });
  const target = await getMessage(user.business_id, messageId);
  if (!target) return Response.json({ error: "Message not found." }, { status: 404 });
  const contact = await getContact(user.business_id, target.contact_id);
  if (!contact) return Response.json({ error: "Contact not found." }, { status: 404 });

  try {
    const message = await reactToMessage({
      business,
      contact,
      targetMessage: target,
      emoji: body.emoji || null,
    });
    return Response.json({ ok: true, message });
  } catch (error) {
    return Response.json({ error: error.message || "Reaction failed." }, { status: 400 });
  }
}
