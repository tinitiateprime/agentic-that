import { getSql } from "@/lib/db";
import { recordInbound } from "@/lib/wa/messaging";
import { normalizeWaNumber } from "@/lib/wa/provider";

// WATI posts events here. Configure the URL in WATI dashboard:
//   https://<your-host>/api/webhooks/wati?token=<WATI_WEBHOOK_SECRET>
// (the ?token guard is optional — only enforced if WATI_WEBHOOK_SECRET is set.)
//
// We care about inbound customer messages (eventType "message", owner=false),
// including interactive button taps, which WATI delivers as interactiveButtonReply
// / listReply, or as type "button".
export async function POST(req) {
  const secret = process.env.WATI_WEBHOOK_SECRET;
  if (secret) {
    const token = new URL(req.url).searchParams.get("token");
    if (token !== secret) return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload) return Response.json({ ok: true }); // ack malformed pings

  // Only process inbound customer messages. owner=true is the business's own echo.
  const eventType = payload.eventType || payload.type;
  if (payload.owner === true) return Response.json({ ok: true });
  if (eventType && !["message", "button", "interactive"].includes(eventType)) {
    return Response.json({ ok: true });
  }

  // Single-tenant deploy: route to the (first) business.
  const sql = await getSql();
  const [business] = await sql`SELECT * FROM businesses ORDER BY id LIMIT 1`;
  if (!business) return Response.json({ ok: true });

  const waId = normalizeWaNumber(payload.waId || payload.from || payload.phone || "");
  if (!waId) return Response.json({ ok: true });

  // Match an existing contact by normalized number, or auto-create one.
  const contactRows = await sql`SELECT * FROM contacts WHERE business_id = ${business.id}`;
  let contact = contactRows.find((c) => normalizeWaNumber(c.phone) === waId);

  if (!contact) {
    const name = payload.senderName || payload.profileName || `+${waId}`;
    [contact] = await sql`
      INSERT INTO contacts (business_id, name, phone)
      VALUES (${business.id}, ${name}, ${`+${waId}`})
      RETURNING *`;
  }

  // Was it a button / list tap?
  const buttonText =
    payload.interactiveButtonReply?.text ||
    payload.listReply?.title ||
    (payload.type === "button" ? payload.text : null);

  const body = buttonText || payload.text || payload.data || "(unsupported message)";

  await recordInbound({
    business,
    contact,
    body,
    providerId: payload.whatsappMessageId || payload.id || null,
    buttonReply: Boolean(buttonText),
  });

  return Response.json({ ok: true });
}

// WATI verifies some setups with a GET; respond OK.
export function GET() {
  return Response.json({ ok: true, service: "wati-webhook" });
}
