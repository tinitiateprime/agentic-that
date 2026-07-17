import { getSql } from "@/lib/db";
import { recordInbound } from "@/lib/wa/messaging";
import { normalizeWaNumber } from "@/lib/wa/provider";

// Meta WhatsApp Cloud API posts events here. Configure in Meta for Developers >
// WhatsApp > Configuration > Webhook:
//   Callback URL:  https://<your-host>/api/webhooks/meta
//   Verify token:  the value of META_WEBHOOK_VERIFY_TOKEN
// Subscribe to the "messages" field.
//
// Meta first calls GET to verify the callback, then POSTs the WhatsApp Business
// Account payload for every event afterwards.

export function GET(req) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge, { status: 200 });
  }
  return Response.json({ error: "forbidden" }, { status: 403 });
}

export async function POST(req) {
  const payload = await req.json().catch(() => null);
  if (!payload) return Response.json({ ok: true });

  const sql = await getSql();
  const [business] = await sql`SELECT * FROM businesses ORDER BY id LIMIT 1`;
  if (!business) return Response.json({ ok: true });

  const changes = payload.entry?.flatMap((e) => e.changes || []) || [];
  for (const change of changes) {
    const value = change.value || {};
    const messages = value.messages || [];
    if (!messages.length) continue;

    // Keep the receiving sender number on every row so replies can use it.
    const phoneNumberId = value.metadata?.phone_number_id || null;

    for (const msg of messages) {
      const waId = normalizeWaNumber(msg.from || "");
      if (!waId) continue;

      const contactRows = await sql`SELECT * FROM contacts WHERE business_id = ${business.id}`;
      let contact = contactRows.find((c) => normalizeWaNumber(c.phone) === waId);

      const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;

      if (!contact) {
        const name = profileName || `+${waId}`;
        [contact] = await sql`
          INSERT INTO contacts (business_id, name, phone)
          VALUES (${business.id}, ${name}, ${`+${waId}`})
          RETURNING *`;
      } else if (profileName && normalizeWaNumber(contact.name) === waId) {
        await sql`UPDATE contacts SET name = ${profileName} WHERE id = ${contact.id}`;
        contact = { ...contact, name: profileName };
      }

      const buttonText =
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        msg.button?.text ||
        null;

      const body = buttonText || msg.text?.body || `(unsupported message: ${msg.type})`;

      await recordInbound({
        business,
        contact,
        body,
        providerId: msg.id || null,
        buttonReply: Boolean(buttonText),
        phoneNumberId,
      });
    }
  }

  return Response.json({ ok: true });
}
