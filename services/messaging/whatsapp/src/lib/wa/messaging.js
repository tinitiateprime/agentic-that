import { getSql } from "../db.js";
import { getProvider, normalizeWaNumber } from "./provider.js";
import { credsForBusiness, credsForProvider } from "../tenant.js";
import { lastInboundProvider } from "../data.js";

// Contacts created before we knew their real name (e.g. via Quick Send, or a
// cold broadcast) are stored with name = their own phone number as a
// placeholder. Sending that back to them as "{{name}}" looks like a bug ("Hi
// +91987654321,") — treat it the same as no name at all.
function displayName(contact) {
  const name = contact?.name || "";
  if (!name) return "there";
  if (normalizeWaNumber(name) === normalizeWaNumber(contact?.phone)) return "there";
  return name;
}

// Substitute {{name}}, {{business}}, {{catalog}} into a template body.
export function renderTemplate(body, { contact, business, catalogUrl } = {}) {
  return String(body)
    .replaceAll("{{name}}", displayName(contact))
    .replaceAll("{{business}}", business?.name || "")
    .replaceAll("{{catalog}}", catalogUrl || "");
}

// Which provider to send THIS contact through: whichever channel they last
// messaged in on (so Meta, WATI, and Baileys contacts can all be live at
// once, each replied to on the right number/app), falling back to the
// business's Settings-configured active provider for contacts with no inbound
// history yet (or whose channel isn't configured at all).
async function resolveProviderForContact(business, contact) {
  const preferred = await lastInboundProvider(contact.id);
  if (preferred) {
    const creds = await credsForProvider(business.id, preferred);
    if (creds) return getProvider(creds);
  }
  return getProvider(await credsForBusiness(business.id));
}

// Meta rejects a phone_number_id that's been removed from the WABA with an
// error naming that exact id. Rather than leave a contact's replies stuck
// failing forever (their history still points at the old number), retry once
// against the account's current default number.
async function sendWithPhoneFallback(sendFn, phoneNumberId) {
  try {
    return { result: await sendFn(phoneNumberId), phoneNumberId };
  } catch (err) {
    const stale = phoneNumberId && String(err.message).includes(phoneNumberId) && /does not exist/i.test(err.message);
    if (!stale) throw err;
    return { result: await sendFn(undefined), phoneNumberId: undefined };
  }
}

async function insertOutbound({ business, contact, body, kind, templateName, buttons, status, providerId, phoneNumberId, provider }) {
  const sql = await getSql();
  const [row] = await sql`
    INSERT INTO messages (business_id, contact_id, direction, body, kind, template_name, buttons, status, provider_id, phone_number_id, provider)
    VALUES (${business.id}, ${contact.id}, 'out', ${body}, ${kind}, ${templateName || null},
            ${buttons ? JSON.stringify(buttons) : null}, ${status}, ${providerId}, ${phoneNumberId || null}, ${provider || null})
    RETURNING *`;
  await sql`UPDATE contacts SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ${contact.id}`;
  return row;
}

// Send a 1-1 text message and record it in the chat history. `templateName` is
// just metadata for display — the CRM's saved templates are canned free text,
// so they go out as a session text message (NOT a Meta-approved template).
// On a real provider this only delivers inside the 24h window; the failure
// reason from the provider is captured on the returned row (`.error`).
export async function sendToContact({ business, contact, body, templateName = null, phoneNumberId }) {
  const provider = await resolveProviderForContact(business, contact);
  let status = "sent";
  let providerId = null;
  let error = null;
  let usedPhoneNumberId = phoneNumberId;
  try {
    const { result, phoneNumberId: finalPhoneNumberId } = await sendWithPhoneFallback(
      (pnid) => provider.sendText({ from: business.admin_number, to: contact.phone, body, phoneNumberId: pnid }),
      phoneNumberId
    );
    status = result.status || "sent";
    providerId = result.providerId || null;
    usedPhoneNumberId = finalPhoneNumberId;
  } catch (err) {
    status = "failed";
    error = err.message;
    body = `${body}\n\n[send failed: ${err.message}]`;
  }
  const row = await insertOutbound({ business, contact, body, kind: "text", templateName, status, providerId, phoneNumberId: usedPhoneNumberId, provider: provider.name });
  return { ...row, error };
}

// Send an APPROVED WhatsApp template via the provider (works outside the 24h
// window). `params` is an ordered array of values or { name, value } pairs for
// the template placeholders. Records the rendered preview text in chat history.
export async function sendTemplateToContact({ business, contact, watiTemplate, params = [], language, previewBody, broadcastName, phoneNumberId }) {
  const provider = await resolveProviderForContact(business, contact);
  const parameters = params.map((param, i) => {
    if (param && typeof param === "object") {
      return {
        name: String(param.name || i + 1),
        value: String(param.value ?? ""),
      };
    }
    return { name: String(i + 1), value: String(param) };
  });
  let status = "sent";
  let providerId = null;
  let error = null;
  let body = previewBody || `[template: ${watiTemplate}]`;
  let usedPhoneNumberId = phoneNumberId;
  try {
    if (typeof provider.sendTemplate !== "function") {
      throw new Error(`${provider.name} provider has no template support`);
    }
    const { result, phoneNumberId: finalPhoneNumberId } = await sendWithPhoneFallback(
      (pnid) =>
        provider.sendTemplate({
          from: business.admin_number,
          to: contact.phone,
          name: watiTemplate,
          parameters,
          broadcastName,
          phoneNumberId: pnid,
          // Only meta.sendTemplate reads this (Meta requires an exact language
          // match); WATI's sendTemplate ignores it.
          ...(language ? { language } : {}),
        }),
      phoneNumberId
    );
    status = result.status || "sent";
    providerId = result.providerId || null;
    usedPhoneNumberId = finalPhoneNumberId;
  } catch (err) {
    status = "failed";
    error = err.message;
    body = `${body}\n\n[send failed: ${err.message}]`;
  }
  const row = await insertOutbound({ business, contact, body, kind: "text", templateName: watiTemplate, status, providerId, phoneNumberId: usedPhoneNumberId, provider: provider.name });
  return { ...row, error };
}

// Send an interactive 3-button (Bot) message and record it.
export async function sendButtonsToContact({ business, contact, body, buttons, phoneNumberId }) {
  const provider = await resolveProviderForContact(business, contact);
  const cleanButtons = (buttons || []).map((b) => String(b).trim()).filter(Boolean).slice(0, 3);
  let status = "sent";
  let providerId = null;
  let error = null;
  let usedPhoneNumberId = phoneNumberId;
  try {
    const { result, phoneNumberId: finalPhoneNumberId } = await sendWithPhoneFallback(
      (pnid) => provider.sendButtons({ from: business.admin_number, to: contact.phone, body, buttons: cleanButtons, phoneNumberId: pnid }),
      phoneNumberId
    );
    status = result.status || "sent";
    providerId = result.providerId || null;
    usedPhoneNumberId = finalPhoneNumberId;
  } catch (err) {
    status = "failed";
    error = err.message;
    body = `${body}\n\n[send failed: ${err.message}]`;
  }
  const row = await insertOutbound({
    business,
    contact,
    body,
    kind: "interactive_buttons",
    buttons: cleanButtons,
    status,
    providerId,
    phoneNumberId: usedPhoneNumberId,
    provider: provider.name,
  });
  return { ...row, error };
}

// Record an inbound message (from a provider webhook). When the customer tapped
// an interactive button, pass buttonReply=true so it's captured and linked to
// the outbound button message it answered. `provider` (meta/baileys/wati/mock)
// is what a future reply to this contact will auto-route through.
export async function recordInbound({
  business,
  contact,
  body,
  providerId = null,
  buttonReply = false,
  phoneNumberId = null,
  provider = null,
}) {
  const sql = await getSql();

  // Meta and WATI retry webhooks when an acknowledgement is delayed. Their
  // message ids are stable, so make ingestion idempotent before touching
  // unread counts or contact activity.
  if (providerId) {
    const [existing] = await sql`
      SELECT * FROM messages
       WHERE business_id = ${business.id}
         AND provider = ${provider}
         AND provider_id = ${providerId}
       LIMIT 1`;
    if (existing) return existing;
  }

  let kind = buttonReply ? "button_reply" : "text";
  let replyToId = null;

  if (buttonReply) {
    // Link to this contact's most recent outbound interactive message.
    const [parent] = await sql`
      SELECT id FROM messages
       WHERE contact_id = ${contact.id} AND direction = 'out' AND kind = 'interactive_buttons'
       ORDER BY created_at DESC LIMIT 1`;
    replyToId = parent?.id || null;
  }

  const [row] = await sql`
    INSERT INTO messages (business_id, contact_id, direction, body, kind, status, provider_id, reply_to_id, phone_number_id, provider)
    VALUES (${business.id}, ${contact.id}, 'in', ${body}, ${kind}, 'delivered', ${providerId}, ${replyToId}, ${phoneNumberId}, ${provider})
    RETURNING *`;
  await sql`UPDATE contacts SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ${contact.id}`;
  return row;
}
