import { getSql } from "../db.js";
import { getProvider, normalizeWaNumber } from "./provider.js";

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

async function insertOutbound({ business, contact, body, kind, templateName, buttons, status, providerId, phoneNumberId }) {
  const sql = await getSql();
  const [row] = await sql`
    INSERT INTO messages (business_id, contact_id, direction, body, kind, template_name, buttons, status, provider_id, phone_number_id)
    VALUES (${business.id}, ${contact.id}, 'out', ${body}, ${kind}, ${templateName || null},
            ${buttons ? JSON.stringify(buttons) : null}, ${status}, ${providerId}, ${phoneNumberId || null})
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
  const provider = getProvider();
  let status = "sent";
  let providerId = null;
  let error = null;
  try {
    const result = await provider.sendText({
      from: business.admin_number,
      to: contact.phone,
      body,
      phoneNumberId,
    });
    status = result.status || "sent";
    providerId = result.providerId || null;
  } catch (err) {
    status = "failed";
    error = err.message;
    body = `${body}\n\n[send failed: ${err.message}]`;
  }
  const row = await insertOutbound({ business, contact, body, kind: "text", templateName, status, providerId, phoneNumberId });
  return { ...row, error };
}

// Send an APPROVED WhatsApp template via the provider (works outside the 24h
// window). `params` is an ordered array of values or { name, value } pairs for
// the template placeholders. Records the rendered preview text in chat history.
export async function sendTemplateToContact({ business, contact, watiTemplate, params = [], language, previewBody, broadcastName, phoneNumberId }) {
  const provider = getProvider();
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
  try {
    if (typeof provider.sendTemplate !== "function") {
      throw new Error(`${provider.name} provider has no template support`);
    }
    const result = await provider.sendTemplate({
      from: business.admin_number,
      to: contact.phone,
      name: watiTemplate,
      parameters,
      broadcastName,
      phoneNumberId,
      // Only meta.sendTemplate reads this (Meta requires an exact language
      // match); WATI's sendTemplate ignores it.
      ...(language ? { language } : {}),
    });
    status = result.status || "sent";
    providerId = result.providerId || null;
  } catch (err) {
    status = "failed";
    error = err.message;
    body = `${body}\n\n[send failed: ${err.message}]`;
  }
  const row = await insertOutbound({ business, contact, body, kind: "text", templateName: watiTemplate, status, providerId, phoneNumberId });
  return { ...row, error };
}

// Send an interactive 3-button (Bot) message and record it.
export async function sendButtonsToContact({ business, contact, body, buttons, phoneNumberId }) {
  const provider = getProvider();
  const cleanButtons = (buttons || []).map((b) => String(b).trim()).filter(Boolean).slice(0, 3);
  let status = "sent";
  let providerId = null;
  let error = null;
  try {
    const result = await provider.sendButtons({
      from: business.admin_number,
      to: contact.phone,
      body,
      buttons: cleanButtons,
      phoneNumberId,
    });
    status = result.status || "sent";
    providerId = result.providerId || null;
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
    phoneNumberId,
  });
  return { ...row, error };
}

// Record an inbound message (from a provider webhook). When the customer tapped
// an interactive button, pass buttonReply=true so it's captured and linked to
// the outbound button message it answered.
export async function recordInbound({
  business,
  contact,
  body,
  providerId = null,
  buttonReply = false,
  phoneNumberId = null,
}) {
  const sql = await getSql();
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
    INSERT INTO messages (business_id, contact_id, direction, body, kind, status, provider_id, reply_to_id, phone_number_id)
    VALUES (${business.id}, ${contact.id}, 'in', ${body}, ${kind}, 'delivered', ${providerId}, ${replyToId}, ${phoneNumberId})
    RETURNING *`;
  await sql`UPDATE contacts SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ${contact.id}`;
  return row;
}
