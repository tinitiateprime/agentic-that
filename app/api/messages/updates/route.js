import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { listBusinessMessagesAfter, listBusinessReactionUpdates } from "@whatsapp/lib/data";

// Polled by the Message center — returns every message (any contact) newer
// than ?afterId, so one request keeps all on-screen chats current. afterId=0
// returns the full history (used by the Refresh button). Reaction changes are
// returned separately because they update an older message in place.
export async function GET(req) {
  const user = await getCurrentUser();
  if (!user) return whatsappAccessErrorResponse("view");

  const params = new URL(req.url).searchParams;
  const afterId = Number(params.get("afterId") || 0);
  const rawSince = params.get("reactionsSince");
  const reactionsSince = rawSince && !Number.isNaN(Date.parse(rawSince))
    ? new Date(rawSince).toISOString()
    : new Date(0).toISOString();
  const messages = await listBusinessMessagesAfter(user.business_id, afterId);
  const { reactions, cursor: reactionCursor } = await listBusinessReactionUpdates(
    user.business_id,
    reactionsSince
  );
  return Response.json({ messages, reactions, reactionCursor });
}
