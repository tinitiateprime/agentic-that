import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { listBusinessMessagesAfter } from "@whatsapp/lib/data";

// Polled by the Message center — returns every message (any contact) newer
// than ?afterId, so one request keeps all on-screen chats current. afterId=0
// returns the full history (used by the Refresh button).
export async function GET(req) {
  const user = await getCurrentUser();
  if (!user) return whatsappAccessErrorResponse("view");

  const afterId = Number(new URL(req.url).searchParams.get("afterId") || 0);
  const messages = await listBusinessMessagesAfter(user.business_id, afterId);
  return Response.json({ messages });
}
