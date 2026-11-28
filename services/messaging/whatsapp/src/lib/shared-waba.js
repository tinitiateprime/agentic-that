import { getSql } from "./db.js";
import { applyReaction, resolveOrCreateContact } from "./data.js";

// Shared WABAs: one Meta WhatsApp Business Account can be connected to several
// workspaces. Inbound events already reach every one of them (the Meta webhook
// fans out by WABA id), but Meta never echoes messages we send through the API.
// The helpers here keep each workspace's copy of the conversation identical:
//
//   mirrorOutbound          copy a message one workspace sent into the others
//   mirrorReaction          copy a reaction one workspace sent into the others
//   isWelcomeSender         pick ONE workspace to send the automated welcome
//   backfillSharedWabaHistory  copy existing history into a newly joined workspace
//
// Delivery receipts and reactions from the customer need nothing extra: copies
// share Meta's provider_id, and the webhook updates it in every workspace.

// Every Meta account (one per workspace) on the same WABA as the account that
// `businessId` sends from, oldest first, including the sender's own account.
// `phoneNumberId` pins the sending account when the workspace has several;
// without it the workspace's oldest Meta account is used.
export async function wabaPeers(businessId, phoneNumberId = null) {
  const sql = await getSql();
  const pnid = phoneNumberId ? String(phoneNumberId) : null;
  return sql`
    WITH source AS (
      SELECT a.waba_id
        FROM whatsapp_accounts a
       WHERE a.business_id = ${businessId}
         AND a.provider = 'meta'
         AND (${pnid}::text IS NULL OR EXISTS (
               SELECT 1 FROM whatsapp_numbers n
                WHERE n.whatsapp_account_id = a.id AND n.phone_number_id = ${pnid}))
       ORDER BY a.id ASC
       LIMIT 1
    )
    SELECT a.id AS account_id, a.business_id, a.waba_id
      FROM whatsapp_accounts a
      JOIN source s ON s.waba_id = a.waba_id
     WHERE a.provider = 'meta'
     ORDER BY a.id ASC`;
}

async function otherPeerBusinessIds(businessId, phoneNumberId) {
  const peers = await wabaPeers(businessId, phoneNumberId);
  return [...new Set(
    peers.map((p) => Number(p.business_id)).filter((id) => id !== Number(businessId))
  )];
}

// Copy an outbound message row (just stored for `business`) into every other
// workspace on the same WABA, under that workspace's own contact for the same
// phone number. Only Meta sends are shared. Never throws: the message has
// already been sent and recorded for the sender, so a mirroring problem must
// not turn into a send failure.
export async function mirrorOutbound({ business, contact, row }) {
  if (!row || row.direction !== "out" || row.provider !== "meta") return [];
  try {
    const peerIds = await otherPeerBusinessIds(business.id, row.phone_number_id);
    if (!peerIds.length) return [];
    const sql = await getSql();
    const copies = [];
    for (const peerId of peerIds) {
      const peerContact = await resolveOrCreateContact(peerId, contact.phone, contact.name);
      if (!peerContact) continue;
      const [copy] = await sql`
        INSERT INTO messages (business_id, contact_id, direction, body, kind, template_name, buttons,
                              status, provider_id, phone_number_id, provider, created_at)
        VALUES (${peerId}, ${peerContact.id}, 'out', ${row.body}, ${row.kind}, ${row.template_name || null},
                ${row.buttons || null}, ${row.status}, ${row.provider_id || null}, ${row.phone_number_id || null},
                ${row.provider}, ${row.created_at})
        ON CONFLICT DO NOTHING
        RETURNING *`;
      if (copy) {
        await sql`UPDATE contacts SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ${peerContact.id}`;
        copies.push(copy);
      }
    }
    return copies;
  } catch (err) {
    console.error("shared WABA: mirroring an outbound message failed:", err?.message || err);
    return [];
  }
}

// A reaction the business sent from one workspace, applied to the same
// customer message in the other workspaces. Never throws (see mirrorOutbound).
export async function mirrorReaction({ business, targetMessage, emoji }) {
  if (!targetMessage?.provider_id) return;
  const provider = String(targetMessage.provider || "meta").toLowerCase();
  if (provider !== "meta") return;
  try {
    const peerIds = await otherPeerBusinessIds(business.id, targetMessage.phone_number_id);
    for (const peerId of peerIds) {
      await applyReaction({ businessId: peerId, provider, providerId: targetMessage.provider_id, emoji: emoji || null });
    }
  } catch (err) {
    console.error("shared WABA: mirroring a reaction failed:", err?.message || err);
  }
}

// Every workspace on a shared WABA records the same inbound message, so each
// would greet a new contact on its own. Only the oldest account whose
// workspace has a welcome configured sends it; the others get a copy of that
// welcome through mirrorOutbound. Workspaces that are not on a shared WABA
// (or non-Meta channels, which have no phone number id) always send.
export async function isWelcomeSender(businessId, phoneNumberId) {
  if (!phoneNumberId) return true;
  const peers = await wabaPeers(businessId, phoneNumberId);
  if (peers.length < 2) return true;
  const sql = await getSql();
  const ids = [...new Set(peers.map((p) => Number(p.business_id)))];
  const configured = await sql`
    SELECT id FROM businesses
     WHERE id IN ${sql(ids)}
       AND welcome_enabled = true
       AND COALESCE(TRIM(welcome_template_name), '') <> ''`;
  const enabled = new Set(configured.map((b) => Number(b.id)));
  const sender = peers.find((p) => enabled.has(Number(p.business_id)));
  return !sender || Number(sender.business_id) === Number(businessId);
}

// When a workspace connects a WABA that another workspace already holds, copy
// that workspace's existing Meta conversation history in, so both start out
// identical. The source is the oldest other account on the WABA (it holds the
// longest history). Safe to run again: messages with a Meta id are skipped by
// the unique (business, provider, provider_id) index, and messages without one
// (e.g. failed sends) are matched on contact, direction, time and text.
// Returns the number of messages copied.
export async function backfillSharedWabaHistory(accountId) {
  const sql = await getSql();
  const [target] = await sql`
    SELECT id, business_id, waba_id FROM whatsapp_accounts
     WHERE id = ${accountId} AND provider = 'meta'`;
  if (!target) return 0;
  const [source] = await sql`
    SELECT id, business_id FROM whatsapp_accounts
     WHERE waba_id = ${target.waba_id}
       AND provider = 'meta'
       AND business_id <> ${target.business_id}
     ORDER BY id ASC
     LIMIT 1`;
  if (!source) return 0;

  // Contacts with Meta history on this WABA's numbers in the source workspace.
  const sourceContacts = await sql`
    SELECT DISTINCT c.id, c.name, c.phone
      FROM contacts c
      JOIN messages m ON m.contact_id = c.id
     WHERE c.business_id = ${source.business_id}
       AND m.business_id = ${source.business_id}
       AND m.provider = 'meta'
       AND (m.phone_number_id IS NULL OR m.phone_number_id IN (
             SELECT phone_number_id FROM whatsapp_numbers WHERE whatsapp_account_id = ${source.id}))`;

  let copied = 0;
  for (const sourceContact of sourceContacts) {
    const targetContact = await resolveOrCreateContact(target.business_id, sourceContact.phone, sourceContact.name);
    if (!targetContact) continue;
    const inserted = await sql`
      INSERT INTO messages (business_id, contact_id, direction, body, kind, template_name, buttons,
                            status, provider_id, phone_number_id, provider, reaction, reaction_at, created_at,
                            media_type, media_id, media_mime, media_filename)
      SELECT ${target.business_id}, ${targetContact.id}, m.direction, m.body, m.kind, m.template_name, m.buttons,
             m.status, m.provider_id, m.phone_number_id, m.provider, m.reaction, m.reaction_at, m.created_at,
             m.media_type, m.media_id, m.media_mime, m.media_filename
        FROM messages m
       WHERE m.business_id = ${source.business_id}
         AND m.contact_id = ${sourceContact.id}
         AND m.provider = 'meta'
         AND (m.phone_number_id IS NULL OR m.phone_number_id IN (
               SELECT phone_number_id FROM whatsapp_numbers WHERE whatsapp_account_id = ${source.id}))
         AND (m.provider_id IS NOT NULL OR NOT EXISTS (
               SELECT 1 FROM messages t
                WHERE t.business_id = ${target.business_id}
                  AND t.contact_id = ${targetContact.id}
                  AND t.direction = m.direction
                  AND t.created_at = m.created_at
                  AND t.body = m.body))
       ORDER BY m.created_at ASC, m.id ASC
      ON CONFLICT DO NOTHING
      RETURNING id`;
    if (inserted.length) {
      copied += inserted.length;
      await sql`
        UPDATE contacts
           SET last_activity_at = GREATEST(
                 COALESCE(last_activity_at, '-infinity'::timestamptz),
                 (SELECT MAX(created_at) FROM messages WHERE contact_id = ${targetContact.id}))
         WHERE id = ${targetContact.id}`;
    }
  }
  return copied;
}

// For the connect routes: the account is already saved, so a backfill problem
// is logged rather than failing the connection. Returns the number copied.
export async function backfillSharedWabaHistorySafely(accountId) {
  try {
    return await backfillSharedWabaHistory(accountId);
  } catch (err) {
    console.error("shared WABA: history backfill failed:", err?.message || err);
    return 0;
  }
}
