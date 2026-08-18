import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { createTempGroupFromUnread } from "@whatsapp/lib/data";

// Bundle every chat with unread replies into a temporary group, so the whole
// backlog can be broadcast to (or welcomed) in one place. The group is marked
// is_temp and expires after `ttlHours`, so these snapshots clean themselves up
// instead of accumulating next to real groups.
export async function POST(req) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");

  const { ttlHours } = await req.json().catch(() => ({}));
  const result = await createTempGroupFromUnread(user.business_id, {
    ttlHours: Number(ttlHours) > 0 ? Number(ttlHours) : undefined,
  });
  if (!result) return Response.json({ error: "Nothing unread to group" }, { status: 400 });

  return Response.json({
    ok: true,
    id: result.group.id,
    name: result.group.name,
    expiresAt: result.group.expires_at,
    memberCount: result.memberCount,
    newCount: result.newCount,
  });
}
