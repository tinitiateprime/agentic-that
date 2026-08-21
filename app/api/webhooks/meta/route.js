import crypto from "node:crypto";
import { getSql } from "@whatsapp/lib/db";
import { recordInbound } from "@whatsapp/lib/wa/messaging";
import { applyReaction, recordCallEvent, resolveOrCreateContact } from "@whatsapp/lib/data";
import { resolveTenantByWabaId } from "@whatsapp/lib/tenant";

// Meta WhatsApp Cloud API posts events here. Configure in Meta for Developers >
// WhatsApp > Configuration > Webhook:
//   Callback URL:  https://<your-host>/api/webhooks/meta
//   Verify token:  the value of META_WEBHOOK_VERIFY_TOKEN
// Subscribe to the "messages" field, and to "calls" for the Calling API
// (call_created / connect / terminate events → the calls log + missed alerts).
//
// Meta first calls GET to verify the callback (hub.challenge handshake), then
// POSTs the WhatsApp Business Account payload for every event afterwards.

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
  const rawBody = await req.text();
  if (!validMetaSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || "null");
  } catch {
    return Response.json({ ok: true });
  }
  if (!payload) return Response.json({ ok: true }); // ack malformed pings

  const sql = await getSql();

  // Multi-tenant routing: one app = one callback URL, so every customer's
  // events arrive here. Meta puts the WABA id in entry[].id — that's the only
  // reliable tenant key. Unknown WABA ids are ACKed and dropped (never fanned
  // out to another tenant).
  for (const entry of payload.entry || []) {
    const business = await businessForEntry(sql, entry);
    if (!business) continue;
    await processEntry(sql, business, entry);
  }

  return Response.json({ ok: true });
}

function validMetaSignature(rawBody, signature) {
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  // Keep local/sample payloads usable until an app secret is configured. In a
  // live setup the supplied secret makes the signature mandatory.
  if (!appSecret) return true;
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature || "")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const receivedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

// entry[].id -> the tenant that owns that WhatsApp Business Account.
// Falls back to the single-tenant deployment (first business) only while no
// WABA has been onboarded into whatsapp_accounts yet, so the pre-SaaS install
// keeps working until its env account is imported.
async function businessForEntry(sql, entry) {
  const tenant = await resolveTenantByWabaId(entry?.id);
  if (tenant) return tenant.business;

  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM whatsapp_accounts`;
  if (n > 0) return null; // onboarded SaaS: an unknown WABA is not ours

  const [business] = await sql`SELECT * FROM businesses ORDER BY id LIMIT 1`;
  return business || null;
}

async function processEntry(sql, business, entry) {
  const resolveContact = (rawNumber, profileName) =>
    resolveOrCreateContact(business.id, rawNumber, profileName);

  for (const change of entry.changes || []) {
    const value = change.value || {};
    // Which of the business's numbers this event belongs to — kept on every row
    // so replies/callbacks go out from the same number.
    const phoneNumberId = value.metadata?.phone_number_id || null;

    // Delivery receipts update the outbound row already shown in the CRM.
    for (const status of value.statuses || []) {
      if (!status.id || !status.status) continue;
      await sql`
        UPDATE messages
           SET status = ${String(status.status).toLowerCase()}
         WHERE business_id = ${business.id}
           AND (provider = 'meta' OR provider IS NULL)
           AND provider_id = ${status.id}`;
    }

    // ── Call events (field: "calls") ───────────────────────────────────────
    // One call emits several events (call_created → connect → terminate), all
    // sharing a call id; recordCallEvent upserts so the row converges on the
    // final outcome (completed / missed).
    for (const call of value.calls || []) {
      const businessInitiated = call.direction === "BUSINESS_INITIATED";
      // The customer is whichever side isn't us.
      const customerNumber = businessInitiated ? call.to : call.from;
      const profileName = value.contacts?.find((c) => c.wa_id === customerNumber)?.profile?.name;
      const contact = await resolveContact(customerNumber, profileName);
      if (!contact) continue;

      await recordCallEvent({
        businessId: business.id,
        contactId: contact.id,
        callId: call.id,
        direction: businessInitiated ? "out" : "in",
        event: call.event,
        metaStatus: call.status,
        phoneNumberId,
        startTime: call.start_time ? new Date(Number(call.start_time) * 1000) : null,
        endTime: call.end_time ? new Date(Number(call.end_time) * 1000) : null,
        duration: Number(call.duration) || 0,
      });
    }

    // ── Inbound messages (field: "messages") ──────────────────────────────
    // Inbound message objects are separate from the delivery receipts above.
    for (const msg of value.messages || []) {
      if (msg.type === "reaction") {
        await applyReaction({
          businessId: business.id,
          provider: "meta",
          providerId: msg.reaction?.message_id,
          emoji: msg.reaction?.emoji || null,
        });
        continue;
      }

      const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
      const contact = await resolveContact(msg.from, profileName);
      if (!contact) continue;

      // Interactive button/list taps carry their label in msg.interactive.*;
      // legacy quick-reply buttons carry it in msg.button.text.
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
        provider: "meta",
      });
    }
  }
}
