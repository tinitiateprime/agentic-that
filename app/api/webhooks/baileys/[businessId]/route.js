import { getSql } from "@whatsapp/lib/db";
import { recordInbound } from "@whatsapp/lib/wa/messaging";
import { resolveOrCreateContact, recordCallEvent } from "@whatsapp/lib/data";
import { decryptSecret } from "@whatsapp/lib/crypto";

// A Baileys connection service (see ../../baileys-wa-app) POSTs inbound
// messages AND call events here. Point its CRM_INBOUND_URL at:
//   https://<crm-host>/api/webhooks/baileys/<businessId>
// Body: { type: "message", from, name, text, providerId, timestamp } or
//       { type: "call", callId, from, isVideo, status, duration }, header x-api-secret.
//
// Unlike Meta (routed by WABA id in the payload), one Baileys number is one
// business, so the business is named directly in the URL; the header is what
// actually authenticates the call.

// Baileys only observes call signaling (it's a linked device, not the phone
// carrying the audio) — its status is already the final outcome, so this just
// maps onto the {event, metaStatus} vocabulary recordCallEvent/deriveCallStatus
// (built for Meta) already understand, reusing the same calls table and the
// existing missed-call alert (Contacts > Calls tab) with no changes there.
const CALL_STATUS_TO_EVENT = {
  ringing: { event: "call_created", metaStatus: null },
  missed: { event: "terminate", metaStatus: "FAILED" },
  completed: { event: "terminate", metaStatus: "COMPLETED" },
};

async function handleCall(business, payload) {
  const mapped = CALL_STATUS_TO_EVENT[payload.status];
  if (!mapped || !payload.callId) return;

  const contact = await resolveOrCreateContact(business.id, payload.from, null);
  if (!contact) return;

  await recordCallEvent({
    businessId: business.id,
    contactId: contact.id,
    callId: payload.callId,
    direction: "in", // Baileys can't place outbound calls
    event: mapped.event,
    metaStatus: mapped.metaStatus,
    phoneNumberId: null,
    startTime: null,
    endTime: null,
    duration: Number(payload.duration) || 0,
  });
}

export async function POST(req, { params }) {
  const { businessId } = await params;
  const id = Number(businessId);
  if (!Number.isInteger(id)) return Response.json({ error: "not found" }, { status: 404 });

  const sql = await getSql();
  const [business] = await sql`SELECT * FROM businesses WHERE id = ${id}`;
  if (!business) return Response.json({ error: "not found" }, { status: 404 });

  const [account] = await sql`
    SELECT * FROM whatsapp_accounts WHERE business_id = ${id} AND provider = 'baileys' LIMIT 1`;
  const expectedSecret = account
    ? decryptSecret(account.access_token)
    : (process.env.BAILEYS_API_SECRET || "").trim() || null;
  if (!expectedSecret) {
    return Response.json({ error: "webhook secret is not configured" }, { status: 503 });
  }
  if (req.headers.get("x-api-secret") !== expectedSecret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload) return Response.json({ ok: true }); // ack malformed pings

  if (payload.type === "call") {
    await handleCall(business, payload);
    return Response.json({ ok: true });
  }

  if (!payload.from || !payload.text) return Response.json({ ok: true });

  const contact = await resolveOrCreateContact(business.id, payload.from, payload.name);
  if (!contact) return Response.json({ ok: true });

  await recordInbound({
    business,
    contact,
    body: payload.text,
    providerId: payload.providerId || null,
    provider: "baileys",
  });

  return Response.json({ ok: true });
}
