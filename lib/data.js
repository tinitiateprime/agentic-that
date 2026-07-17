import { getSql } from "./db.js";
import { normalizeWaNumber } from "./wa/provider.js";

// This deployment serves a single business; helpers resolve it from the
// signed-in user's business_id. All queries are scoped by business_id and run
// against Supabase (Postgres) via the `sql` tagged-template client.

export async function getBusiness(businessId) {
  const sql = await getSql();
  const [row] = await sql`SELECT * FROM businesses WHERE id = ${businessId}`;
  return row;
}

// --- Contacts --------------------------------------------------------------
export async function listContacts(businessId) {
  const sql = await getSql();
  return sql`SELECT * FROM contacts WHERE business_id = ${businessId} ORDER BY lower(name)`;
}

export async function listContactThreads(businessId) {
  const sql = await getSql();
  return sql`
    SELECT c.*,
           (SELECT body FROM messages m WHERE m.contact_id = c.id
             ORDER BY m.created_at DESC LIMIT 1) AS last_message,
           (SELECT direction FROM messages m WHERE m.contact_id = c.id
             ORDER BY m.created_at DESC LIMIT 1) AS last_message_direction,
           (SELECT status FROM messages m WHERE m.contact_id = c.id
             ORDER BY m.created_at DESC LIMIT 1) AS last_message_status,
           (SELECT created_at FROM messages m WHERE m.contact_id = c.id
             ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
      FROM contacts c
     WHERE c.business_id = ${businessId}
     ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC`;
}

export async function getContact(businessId, id) {
  const sql = await getSql();
  const [row] = await sql`SELECT * FROM contacts WHERE business_id = ${businessId} AND id = ${id}`;
  return row;
}

// Set of normalized phone numbers already in the CRM (for de-duping imports).
export async function existingPhoneSet(businessId) {
  const sql = await getSql();
  const rows = await sql`SELECT phone FROM contacts WHERE business_id = ${businessId}`;
  return new Set(rows.map((r) => normalizeWaNumber(r.phone)).filter(Boolean));
}

// Insert WATI contacts into the CRM, skipping numbers that already exist.
// Returns { imported, skipped }.
export async function importContacts(businessId, contacts) {
  const sql = await getSql();
  const have = await existingPhoneSet(businessId);
  let imported = 0;
  let skipped = 0;
  await sql.begin(async (tx) => {
    for (const c of contacts) {
      const norm = normalizeWaNumber(c.phone);
      if (!norm || have.has(norm)) {
        skipped++;
        continue;
      }
      const tags = c.source ? `wati,${c.source}` : "wati";
      await tx`INSERT INTO contacts (business_id, name, phone, tags)
               VALUES (${businessId}, ${c.name || `+${norm}`}, ${c.phone || `+${norm}`}, ${tags})`;
      have.add(norm);
      imported++;
    }
  });
  return { imported, skipped };
}

// --- Messages (1-1 chat) ---------------------------------------------------
export async function listMessages(contactId) {
  const sql = await getSql();
  return sql`SELECT * FROM messages WHERE contact_id = ${contactId} ORDER BY created_at ASC`;
}

// For the chat window's polling — only rows newer than the last one it already
// has, so an open chat picks up inbound webhook replies without a full reload.
export async function listMessagesAfter(contactId, afterId) {
  const sql = await getSql();
  return sql`SELECT * FROM messages WHERE contact_id = ${contactId} AND id > ${afterId} ORDER BY created_at ASC`;
}

// Business-wide version, for the Message center where several chats are on
// screen at once — one poll returns every new message, grouped client-side.
export async function listBusinessMessagesAfter(businessId, afterId) {
  const sql = await getSql();
  return sql`SELECT * FROM messages WHERE business_id = ${businessId} AND id > ${afterId} ORDER BY id ASC`;
}

// The business sender number this contact last messaged — replies default to
// it so the conversation continues on the same WhatsApp thread (each business
// number is a separate chat on the customer's phone).
export async function lastInboundPhoneId(contactId) {
  const sql = await getSql();
  const [row] = await sql`
    SELECT phone_number_id FROM messages
     WHERE contact_id = ${contactId} AND direction = 'in' AND phone_number_id IS NOT NULL
     ORDER BY id DESC LIMIT 1`;
  return row?.phone_number_id || null;
}

// --- Templates -------------------------------------------------------------
export async function listTemplates(businessId) {
  const sql = await getSql();
  return sql`SELECT * FROM templates WHERE business_id = ${businessId} ORDER BY lower(name)`;
}

// --- Groups ----------------------------------------------------------------
export async function listGroups(businessId) {
  const sql = await getSql();
  return sql`
    SELECT g.*,
           CAST(COUNT(gm.contact_id) AS INTEGER) AS member_count
      FROM groups g
      LEFT JOIN group_members gm ON gm.group_id = g.id
     WHERE g.business_id = ${businessId}
     GROUP BY g.id
     ORDER BY lower(g.name)`;
}

export async function getGroup(businessId, id) {
  const sql = await getSql();
  const [row] = await sql`SELECT * FROM groups WHERE business_id = ${businessId} AND id = ${id}`;
  return row;
}

export async function listGroupMembers(groupId) {
  const sql = await getSql();
  return sql`
    SELECT c.* FROM contacts c
      JOIN group_members gm ON gm.contact_id = c.id
     WHERE gm.group_id = ${groupId}
     ORDER BY lower(c.name)`;
}

export async function listContactsNotInGroup(businessId, groupId) {
  const sql = await getSql();
  return sql`
    SELECT * FROM contacts
     WHERE business_id = ${businessId}
       AND id NOT IN (SELECT contact_id FROM group_members WHERE group_id = ${groupId})
     ORDER BY lower(name)`;
}

// --- Eagle Eye dashboard ---------------------------------------------------
// All contacts with their recent-activity summary. `window` is days back
// (e.g. 7 = this week, 15 = last 15 days); 0 = all time.
export async function eagleEye(businessId, windowDays = 0) {
  const sql = await getSql();
  const contacts = await sql`
    SELECT c.*,
           (SELECT body FROM messages m WHERE m.contact_id = c.id
             ORDER BY m.created_at DESC LIMIT 1) AS last_message
      FROM contacts c
     WHERE c.business_id = ${businessId}
     ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC`;

  const withinWindow = (value) => {
    if (!windowDays) return true;
    if (!value) return false;
    const t = new Date(String(value).replace(" ", "T") + (String(value).includes("Z") ? "" : "Z")).getTime();
    return Date.now() - t <= windowDays * 86400000;
  };

  return contacts.filter((c) => withinWindow(c.last_activity_at || c.created_at));
}

export async function dashboardStats(businessId) {
  const sql = await getSql();
  const since = new Date(Date.now() - 7 * 86400000);
  const [contacts] = await sql`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM contacts WHERE business_id = ${businessId}`;
  const [messages7d] = await sql`
    SELECT CAST(COUNT(*) AS INTEGER) AS n FROM messages
     WHERE business_id = ${businessId} AND created_at >= ${since}`;
  return { contacts: contacts.n, messages7d: messages7d.n };
}

// Contacts who have sent at least one inbound message, most recent reply first.
export async function respondedContacts(businessId) {
  const sql = await getSql();
  return sql`
    SELECT c.*,
           (SELECT body FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
             ORDER BY m.created_at DESC LIMIT 1) AS last_reply,
           (SELECT created_at FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
             ORDER BY m.created_at DESC LIMIT 1) AS last_reply_at
      FROM contacts c
     WHERE c.business_id = ${businessId}
       AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in')
     ORDER BY last_reply_at DESC`;
}

// Contacts who were messaged (outbound) but have never replied.
export async function unrespondedContacts(businessId) {
  const sql = await getSql();
  return sql`
    SELECT c.*,
           (SELECT body FROM messages m WHERE m.contact_id = c.id AND m.direction = 'out'
             ORDER BY m.created_at DESC LIMIT 1) AS last_outbound,
           (SELECT created_at FROM messages m WHERE m.contact_id = c.id AND m.direction = 'out'
             ORDER BY m.created_at DESC LIMIT 1) AS last_outbound_at
      FROM contacts c
     WHERE c.business_id = ${businessId}
       AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id AND m.direction = 'out')
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in')
     ORDER BY last_outbound_at DESC`;
}

// Chats with inbound messages the business user hasn't opened yet — an
// inbound row newer than the contact's last_read_message_id marker.
export async function unreadContacts(businessId) {
  const sql = await getSql();
  return sql`
    SELECT c.*,
           (SELECT body FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
             ORDER BY m.id DESC LIMIT 1) AS last_reply,
           (SELECT created_at FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
             ORDER BY m.id DESC LIMIT 1) AS last_reply_at,
           CAST((SELECT COUNT(*) FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
              AND m.id > COALESCE(c.last_read_message_id, 0)) AS INTEGER) AS unread_count
      FROM contacts c
     WHERE c.business_id = ${businessId}
       AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
                     AND m.id > COALESCE(c.last_read_message_id, 0))
     ORDER BY last_reply_at DESC`;
}

// Chats whose replies have all been seen (has inbound, none newer than the marker).
export async function readContacts(businessId) {
  const sql = await getSql();
  return sql`
    SELECT c.*,
           (SELECT body FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
             ORDER BY m.id DESC LIMIT 1) AS last_reply,
           (SELECT created_at FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
             ORDER BY m.id DESC LIMIT 1) AS last_reply_at
      FROM contacts c
     WHERE c.business_id = ${businessId}
       AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in')
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
                         AND m.id > COALESCE(c.last_read_message_id, 0))
     ORDER BY last_reply_at DESC`;
}

// Advance the read marker to the contact's newest inbound message.
export async function markContactRead(businessId, contactId) {
  const sql = await getSql();
  await sql`
    UPDATE contacts
       SET last_read_message_id =
             (SELECT COALESCE(MAX(id), 0) FROM messages WHERE contact_id = ${contactId} AND direction = 'in')
     WHERE id = ${contactId} AND business_id = ${businessId}`;
}

// Outbound delivery + reply status, for the dashboard summary cards.
export async function messageStatusSummary(businessId) {
  const sql = await getSql();
  const [sent] = await sql`
    SELECT CAST(COUNT(*) AS INTEGER) AS n FROM messages WHERE business_id = ${businessId} AND direction = 'out'`;
  const [delivered] = await sql`
    SELECT CAST(COUNT(*) AS INTEGER) AS n FROM messages
     WHERE business_id = ${businessId} AND direction = 'out' AND status IN ('sent','delivered','read')`;
  const [failed] = await sql`
    SELECT CAST(COUNT(*) AS INTEGER) AS n FROM messages
     WHERE business_id = ${businessId} AND direction = 'out' AND status = 'failed'`;
  const [inbound] = await sql`
    SELECT CAST(COUNT(*) AS INTEGER) AS n FROM messages WHERE business_id = ${businessId} AND direction = 'in'`;
  const [contacted] = await sql`
    SELECT CAST(COUNT(DISTINCT contact_id) AS INTEGER) AS n FROM messages
     WHERE business_id = ${businessId} AND direction = 'out'`;
  const [responded] = await sql`
    SELECT CAST(COUNT(DISTINCT contact_id) AS INTEGER) AS n FROM messages
     WHERE business_id = ${businessId} AND direction = 'in'`;
  return {
    sent: sent.n,
    delivered: delivered.n,
    failed: failed.n,
    inbound: inbound.n,
    contacted: contacted.n,
    responded: responded.n,
    responseRate: contacted.n ? Math.round((responded.n / contacted.n) * 100) : 0,
  };
}
