import { recordInbound } from "@whatsapp/lib/wa/messaging";
import { applyReaction, resolveOrCreateContact } from "@whatsapp/lib/data";
import { getSql } from "@whatsapp/lib/db";
import { resolveTenantByWatiWebhookSecret } from "@whatsapp/lib/tenant";

// WATI posts events here. Configure the URL in WATI dashboard:
//   https://<your-host>/api/webhooks/wati?token=<WATI_WEBHOOK_SECRET>
// (the ?token guard is optional — only enforced if WATI_WEBHOOK_SECRET is set.)
//
// We care about inbound customer messages (eventType "message", owner=false),
// including interactive button taps, which WATI delivers as interactiveButtonReply
// / listReply, or as type "button".
export async function POST(req) {
  const token = new URL(req.url).searchParams.get("token");
  const envSecret = (process.env.WATI_WEBHOOK_SECRET || "").trim();
  const tenant = token ? await resolveTenantByWatiWebhookSecret(token) : null;

  // A tenant-specific secret routes directly to that workspace. Keep the old
  // env-secret/first-business fallback for the original single-tenant install.
  if (token && !tenant && token !== envSecret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload) return Response.json({ ok: true }); // ack malformed pings

  // Only process inbound customer messages. owner=true is the business's own echo.
  const eventType = payload.eventType || payload.type;
  const isReaction = payload.type === "reaction" || eventType === "reaction" || Boolean(payload.reaction);
  if (payload.owner === true) return Response.json({ ok: true });
  if (eventType && !isReaction && !["message", "button", "interactive"].includes(eventType)) {
    return Response.json({ ok: true });
  }

  const sql = await getSql();
  let business = tenant?.business || null;
  if (!business) {
    const [{ secured }] = await sql`
      SELECT COUNT(*)::int AS secured FROM whatsapp_accounts
       WHERE provider = 'wati' AND webhook_verify_token IS NOT NULL`;
    if (!token && (envSecret || secured > 0)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    [business] = await sql`SELECT * FROM businesses ORDER BY id LIMIT 1`;
  }
  if (!business) return Response.json({ ok: true });

  if (isReaction) {
    const reaction = payload.reaction && typeof payload.reaction === "object"
      ? payload.reaction
      : null;
    const providerId =
      reaction?.messageId ||
      reaction?.message_id ||
      payload.reactionMessageId ||
      payload.replyContextId ||
      payload.whatsappMessageId ||
      payload.id ||
      null;
    const rawEmoji = reaction
      ? reaction.emoji
      : typeof payload.reaction === "string"
        ? payload.reaction
        : payload.text;
    await applyReaction({
      businessId: business.id,
      provider: "wati",
      providerId,
      emoji: typeof rawEmoji === "string" ? rawEmoji : null,
    });
    return Response.json({ ok: true });
  }

  const contact = await resolveOrCreateContact(
    business.id,
    payload.waId || payload.from || payload.phone || "",
    payload.senderName || payload.profileName
  );
  if (!contact) return Response.json({ ok: true });

  // Was it a button / list tap?
  const buttonText =
    payload.interactiveButtonReply?.text ||
    payload.listReply?.title ||
    payload.buttonReply?.text ||
    (payload.type === "button" ? payload.text : null);

  const rawBody = buttonText || payload.text || payload.data;
  const body =
    typeof rawBody === "string"
      ? rawBody
      : rawBody
        ? JSON.stringify(rawBody)
        : `(unsupported message: ${payload.type || "unknown"})`;

  await recordInbound({
    business,
    contact,
    body,
    providerId: payload.whatsappMessageId || payload.id || null,
    buttonReply: Boolean(buttonText),
    provider: "wati",
  });

  return Response.json({ ok: true });
}

// WATI verifies some setups with a GET; respond OK.
export function GET() {
  return Response.json({ ok: true, service: "wati-webhook" });
}
