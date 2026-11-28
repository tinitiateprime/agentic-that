import crypto from "node:crypto";
import { getSql } from "@whatsapp/lib/db";
import { recordInbound } from "@whatsapp/lib/wa/messaging";
import { applyReaction, recordCallEvent, resolveOrCreateContact } from "@whatsapp/lib/data";
import { resolveTenantsByWabaId } from "@whatsapp/lib/tenant";
import { describeMetaStatusError, withFailureNote } from "@whatsapp/lib/wa/meta-status";
import { inboundMediaFromMeta, metaMessageText } from "@whatsapp/lib/wa/media";

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
  // reliable tenant key. A WABA connected to several workspaces is delivered
  // to each of them; unknown WABA ids are ACKed and dropped.
  for (const entry of payload.entry || []) {
    for (const business of await businessesForEntry(sql, entry)) {
      await processEntry(sql, business, entry);
    }
  }

  return Response.json({ ok: true });
}

function validMetaSignature(rawBody, signature) {
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  // Local fixtures remain usable, but deployed webhooks always fail closed.
  if (!appSecret) return process.env.NODE_ENV !== "production" && process.env.NETLIFY !== "true";
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature || "")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const receivedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

// entry[].id -> every tenant that has that WhatsApp Business Account connected.
// Falls back to the single-tenant deployment (first business) only while no
// WABA has been onboarded into whatsapp_accounts yet, so the pre-SaaS install
// keeps working until its env account is imported.
async function businessesForEntry(sql, entry) {
  const tenants = await resolveTenantsByWabaId(entry?.id);
  if (tenants.length) return tenants.map((tenant) => tenant.business);

  if (process.env.NODE_ENV === "production" || process.env.NETLIFY === "true") return [];
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM whatsapp_accounts`;
  if (n > 0) return []; // onboarded SaaS: an unknown WABA is not ours

  const [business] = await sql`SELECT * FROM businesses ORDER BY id LIMIT 1`;
  return business ? [business] : [];
}

async function processEntry(sql, business, entry) {
  const resolveContact = (rawNumber, profileName) =>
    resolveOrCreateContact(business.id, rawNumber, profileName);

  for (const change of entry.changes || []) {
    const value = change.value || {};
    // Which of the business's numbers this event belongs to — kept on every row
    // so replies/callbacks go out from the same number.
    const phoneNumberId = value.metadata?.phone_number_id || null;

    // Delivery receipts update the outbound row already shown in the CRM. A
    // failed receipt also carries Meta's reason; keep it on the message so the
    // chat says why, not just "failed".
    for (const status of value.statuses || []) {
      if (!status.id || !status.status) continue;
      const newStatus = String(status.status).toLowerCase();
      const [row] = await sql`
        UPDATE messages
           SET status = ${newStatus}
         WHERE business_id = ${business.id}
           AND (provider = 'meta' OR provider IS NULL)
           AND provider_id = ${status.id}
        RETURNING id, body`;
      if (row && newStatus === "failed") {
        const reason = describeMetaStatusError(status.errors);
        console.warn(`Meta delivery failed for message ${row.id}: ${reason}`);
        await sql`
          UPDATE messages SET body = ${withFailureNote(row.body, reason)}
           WHERE id = ${row.id}`;
      }
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

      // Documents, photos, voice notes, videos and stickers arrive as a Meta
      // media id; it's stored on the message and the file is fetched from Meta
      // when someone opens it. Captions/file names become the message text.
      const media = buttonText ? null : inboundMediaFromMeta(msg);
      const body = buttonText || msg.text?.body || metaMessageText(msg, media);

      await recordInbound({
        business,
        contact,
        body,
        providerId: msg.id || null,
        buttonReply: Boolean(buttonText),
        phoneNumberId,
        provider: "meta",
        media,
      });
    }
  }
}
