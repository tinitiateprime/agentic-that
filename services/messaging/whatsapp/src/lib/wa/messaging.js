import { getSql } from "../db.js";
import { getProvider, normalizeWaNumber } from "./provider.js";
import { credsForBusiness, credsForProvider } from "../tenant.js";
import { lastInboundProvider, setReactionById } from "../data.js";

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

function normalizeReactionEmoji(value) {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error("Reaction must be an emoji or an empty string.");
  const emoji = value.trim();
  if (Array.from(emoji).length > 16 || /[\r\n]/.test(emoji)) {
    throw new Error("Choose one emoji for the reaction.");
  }
  return emoji;
}

// React through the same provider that delivered the target message. Using
// the contact's latest provider here would be wrong when one customer has
// history on both Meta and WATI.
export async function reactToMessage({ business, contact, targetMessage, emoji }) {
  if (targetMessage.direction !== "in") {
    throw new Error("You can only react to a message received from the contact.");
  }
  if (!targetMessage.provider_id) {
    throw new Error("This message was not received through a connected channel.");
  }

  const reaction = normalizeReactionEmoji(emoji);
  const targetProvider = String(targetMessage.provider || "").trim().toLowerCase();
  const creds = targetProvider
    ? await credsForProvider(business.id, targetProvider)
    : await credsForBusiness(business.id);
  if (!creds) {
    throw new Error(`The ${targetProvider || "saved"} channel is no longer connected.`);
  }
  const provider = getProvider(creds);
  if (typeof provider.sendReaction !== "function") {
    throw new Error(`Reactions are not supported on the ${provider.name} channel.`);
  }

  await provider.sendReaction({
    to: contact.phone,
    messageId: targetMessage.provider_id,
    emoji: reaction,
    phoneNumberId: targetMessage.phone_number_id || undefined,
  });
  return setReactionById({
    businessId: business.id,
    messageId: targetMessage.id,
    emoji: reaction || null,
  });
}

// --- Automated welcome -----------------------------------------------------
// The first time a brand-new contact messages one of the business's numbers,
// greet them with an approved WhatsApp template (Settings > Welcome message).

// Stored as a JSON array of values, one per template placeholder. Tolerates
// the column being empty/legacy junk — a template with no placeholders is the
// common case and needs no params at all.
function parseWelcomeParams(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v ?? "")) : [];
  } catch {
    return [];
  }
}

// Fill an approved template's body with the values we're about to send, for
// the chat-history preview. Meta templates are positional, so placeholders are
// replaced in order regardless of whether they read {{1}} or {{name}}.
function fillPlaceholders(body, values) {
  let i = 0;
  return String(body).replace(/\{\{\s*[^}]+?\s*\}\}/g, () => values[i++] ?? "");
}

// Send the configured welcome template if this inbound message opened a brand
// new conversation. Returns the outbound message row, or null when no welcome
// was due. Call AFTER the inbound message has been recorded.
export async function maybeSendWelcome({ business, contact, phoneNumberId = null }) {
  const templateName = (business?.welcome_template_name || "").trim();
  if (!business?.welcome_enabled || !templateName) return null;

  const sql = await getSql();

  // "New" means this is the contact's first inbound message ever — the row
  // that triggered this call is already stored, so a count above 1 is an
  // ongoing conversation. This is also what keeps contacts that predate the
  // feature (or were imported with history) from being greeted mid-thread;
  // they're marked welcomed so the count is only paid once.
  const [{ n: inboundCount }] = await sql`
    SELECT COUNT(*)::int AS n FROM messages
     WHERE contact_id = ${contact.id} AND direction = 'in'`;
  if (inboundCount > 1) {
    await sql`UPDATE contacts SET welcome_sent_at = CURRENT_TIMESTAMP
               WHERE id = ${contact.id} AND welcome_sent_at IS NULL`;
    return null;
  }

  // Claim the welcome before sending it. Providers retry webhooks and can
  // deliver concurrently, so this conditional UPDATE — not a read-then-write —
  // is what guarantees exactly one greeting per contact.
  const claimed = await sql`
    UPDATE contacts SET welcome_sent_at = CURRENT_TIMESTAMP
     WHERE id = ${contact.id} AND welcome_sent_at IS NULL
     RETURNING id`;
  if (claimed.length === 0) return null;

  const params = parseWelcomeParams(business.welcome_template_params).map((value) =>
    renderTemplate(value, { contact, business })
  );
  const previewBody = business.welcome_template_body
    ? fillPlaceholders(business.welcome_template_body, params)
    : undefined;

  // The claim stands even if the send fails: sendTemplateToContact records the
  // provider's error on the thread for the admin to see, and un-claiming would
  // mean a mis-configured template greets the contact again on every message
  // they send afterwards.
  return sendTemplateToContact({
    business,
    contact,
    watiTemplate: templateName,
    params,
    language: business.welcome_template_language || undefined,
    previewBody,
    phoneNumberId,
  });
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

  // Greet first-time contacts. Runs here rather than in each provider's
  // webhook so every channel behaves the same, and never throws: the inbound
  // message is already stored and a failed greeting must not stop the
  // webhook from being acknowledged (which would make the provider retry).
  try {
    await maybeSendWelcome({ business, contact, phoneNumberId });
  } catch (err) {
    console.error("welcome template failed:", err?.message || err);
  }

  return row;
}
