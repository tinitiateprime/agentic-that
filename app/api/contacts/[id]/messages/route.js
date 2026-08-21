import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { getContact, listMessagesAfter, listContactReactionUpdates } from "@whatsapp/lib/data";

// Polled by the open chat window to pick up new messages (e.g. an inbound
// webhook reply) without a full page reload. ?afterId=<last known message id>.
export async function GET(req, { params }) {
  const user = await getCurrentUser();
  if (!user) return whatsappAccessErrorResponse("view");

  const { id } = await params;
  const contact = await getContact(user.business_id, id);
  if (!contact) return Response.json({ error: "Contact not found" }, { status: 404 });

  const query = new URL(req.url).searchParams;
  const afterId = Number(query.get("afterId") || 0);
  const rawSince = query.get("reactionsSince");
  const reactionsSince = rawSince && !Number.isNaN(Date.parse(rawSince))
    ? new Date(rawSince).toISOString()
    : new Date(0).toISOString();
  const messages = await listMessagesAfter(contact.id, afterId);
  const update = await listContactReactionUpdates(user.business_id, contact.id, reactionsSince);
  return Response.json({ messages, reactions: update.reactions, reactionCursor: update.cursor });
}
