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
           (SELECT provider FROM messages m WHERE m.contact_id = c.id
             ORDER BY m.created_at DESC LIMIT 1) AS last_message_provider,
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

// Resolve (or auto-create) the contact for an inbound message's raw number,
// backfilling their profile name when we only knew their number. Shared by
// every provider's inbound webhook (Meta, Baileys, ...).
export async function resolveOrCreateContact(businessId, rawNumber, profileName) {
  const waId = normalizeWaNumber(rawNumber || "");
  if (!waId) return null;
  const sql = await getSql();

  const contactRows = await sql`SELECT * FROM contacts WHERE business_id = ${businessId}`;
  let contact = contactRows.find((c) => normalizeWaNumber(c.phone) === waId);

  if (!contact) {
    const name = profileName || `+${waId}`;
    [contact] = await sql`
      INSERT INTO contacts (business_id, name, phone)
      VALUES (${businessId}, ${name}, ${`+${waId}`})
      RETURNING *`;
  } else if (profileName && normalizeWaNumber(contact.name) === waId) {
    // Contact was created before we knew their name (e.g. via Quick Send,
    // name defaulted to their phone number) — backfill it now that the
    // provider has told us their real profile name.
    await sql`UPDATE contacts SET name = ${profileName} WHERE id = ${contact.id}`;
    contact = { ...contact, name: profileName };
  }
  return contact;
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

// Merge WATI API history into one CRM thread. Webhook rows and prior syncs are
// matched by WATI/WhatsApp message id; existing delivery statuses are updated
// while genuinely new rows retain WATI's original timestamp.
export async function syncWatiMessages(businessId, contactId, messages) {
  const sql = await getSql();
  let imported = 0;
  let updated = 0;
  let latest = null;

  await sql.begin(async (tx) => {
    for (const message of messages) {
      const createdAt = message.createdAt || new Date().toISOString();
      if (!latest || new Date(createdAt) > new Date(latest)) latest = createdAt;

      let existing = null;
      if (message.providerId) {
        [existing] = await tx`
          SELECT id, status FROM messages
           WHERE business_id = ${businessId}
             AND provider = 'wati'
             AND provider_id = ${message.providerId}
           LIMIT 1`;
      }

      if (existing) {
        if (message.status && existing.status !== message.status) {
          await tx`UPDATE messages SET status = ${message.status} WHERE id = ${existing.id}`;
          updated++;
        }
        continue;
      }

      await tx`
        INSERT INTO messages
          (business_id, contact_id, direction, body, kind, status, provider_id, provider, created_at)
        VALUES
          (${businessId}, ${contactId}, ${message.direction}, ${message.body}, ${message.kind || "text"},
           ${message.status || "sent"}, ${message.providerId}, 'wati', ${createdAt})`;
      imported++;
    }

    if (latest) {
      await tx`
        UPDATE contacts
           SET last_activity_at = GREATEST(COALESCE(last_activity_at, ${latest}), ${latest})
         WHERE id = ${contactId} AND business_id = ${businessId}`;
    }
  });

  return { imported, updated };
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

// Same idea, across providers instead of Meta numbers: which provider
// (meta/baileys/wati/mock) this contact last messaged in on. Lets Meta and
// Baileys contacts both be live at once — a reply auto-routes through
// whichever channel that contact actually talks on, rather than whatever the
// business's Settings toggle currently says.
export async function lastInboundProvider(contactId) {
  const sql = await getSql();
  const [row] = await sql`
    SELECT provider FROM messages
     WHERE contact_id = ${contactId} AND direction = 'in' AND provider IS NOT NULL
     ORDER BY id DESC LIMIT 1`;
  return row?.provider || null;
}

// --- Calls (WhatsApp Business Calling API) ---------------------------------
// Meta sends several events per call (call_created → connect → terminate), all
// carrying the same call id, so we upsert on call_id and let later events
// refine status/duration. Derived status:
//   ringing    — call_created / connect seen, not yet terminated
//   completed  — terminate with meta status COMPLETED
//   missed     — terminate with meta status FAILED (unanswered / not connected)
export function deriveCallStatus(event, metaStatus, duration = 0) {
  if (event !== "terminate") return "ringing";
  if (String(metaStatus).toUpperCase() === "COMPLETED" || Number(duration) > 0) return "completed";
  return "missed";
}

export async function recordCallEvent({
  businessId,
  contactId,
  callId,
  direction,
  event,
  metaStatus,
  phoneNumberId,
  startTime,
  endTime,
  duration = 0,
}) {
  const sql = await getSql();
  if (callId) {
    const [claimed] = await sql`SELECT business_id FROM calls WHERE call_id = ${callId}`;
    if (claimed && Number(claimed.business_id) !== Number(businessId)) {
      throw new Error("Call id is already associated with another workspace.");
    }
  }
  const status = deriveCallStatus(event, metaStatus, duration);
  const [row] = await sql`
    INSERT INTO calls (business_id, contact_id, call_id, direction, status, event,
                       meta_status, phone_number_id, start_time, end_time, duration)
    VALUES (${businessId}, ${contactId}, ${callId}, ${direction}, ${status}, ${event},
            ${metaStatus || null}, ${phoneNumberId || null}, ${startTime || null},
            ${endTime || null}, ${duration || 0})
    ON CONFLICT (call_id) DO UPDATE SET
      status     = EXCLUDED.status,
      event      = EXCLUDED.event,
      meta_status = COALESCE(EXCLUDED.meta_status, calls.meta_status),
      start_time = COALESCE(EXCLUDED.start_time, calls.start_time),
      end_time   = COALESCE(EXCLUDED.end_time, calls.end_time),
      duration   = GREATEST(EXCLUDED.duration, calls.duration),
      updated_at = now()
    RETURNING *`;
  await sql`UPDATE contacts SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ${contactId}`;
  return row;
}

// Full call log for the business, newest first.
export async function listCalls(businessId, { limit = 100 } = {}) {
  const sql = await getSql();
  return sql`
    SELECT c.*, ct.name AS contact_name, ct.phone AS contact_phone
      FROM calls c JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.business_id = ${businessId}
     ORDER BY c.created_at DESC
     LIMIT ${limit}`;
}

export async function listContactCalls(contactId) {
  const sql = await getSql();
  return sql`SELECT * FROM calls WHERE contact_id = ${contactId} ORDER BY created_at DESC`;
}

// Missed calls that haven't been acknowledged yet — powers the Notify alert.
export async function missedCalls(businessId) {
  const sql = await getSql();
  return sql`
    SELECT c.*, ct.name AS contact_name, ct.phone AS contact_phone
      FROM calls c JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.business_id = ${businessId}
       AND c.status = 'missed'
       AND c.acknowledged_at IS NULL
     ORDER BY c.created_at DESC`;
}

// Mark a missed call as seen so it drops out of the notification list.
export async function acknowledgeCall(businessId, callRowId) {
  const sql = await getSql();
  const res = await sql`
    UPDATE calls SET acknowledged_at = now()
     WHERE id = ${callRowId} AND business_id = ${businessId}`;
  return res.count > 0;
}

export async function callStatusSummary(businessId) {
  const sql = await getSql();
  const [row] = await sql`
    SELECT CAST(COUNT(*) AS INTEGER) AS total,
           CAST(COUNT(*) FILTER (WHERE status = 'missed') AS INTEGER) AS missed,
           CAST(COUNT(*) FILTER (WHERE status = 'completed') AS INTEGER) AS completed,
           CAST(COUNT(*) FILTER (WHERE status = 'missed' AND acknowledged_at IS NULL) AS INTEGER) AS unacknowledged,
           CAST(COALESCE(SUM(duration), 0) AS INTEGER) AS total_seconds
      FROM calls WHERE business_id = ${businessId}`;
  return row;
}

// --- Templates -------------------------------------------------------------
export async function listTemplates(businessId) {
  const sql = await getSql();
  return sql`SELECT * FROM templates WHERE business_id = ${businessId} ORDER BY lower(name)`;
}

// --- Groups ----------------------------------------------------------------
// Standing groups only — temp groups (built from a live list, see
// createTempGroupFromUnread) are kept out so they don't clutter the list.
export async function listGroups(businessId) {
  const sql = await getSql();
  return sql`
    SELECT g.*,
           CAST(COUNT(gm.contact_id) AS INTEGER) AS member_count
      FROM groups g
      LEFT JOIN group_members gm ON gm.group_id = g.id
     WHERE g.business_id = ${businessId}
       AND NOT g.is_temp
     GROUP BY g.id
     ORDER BY lower(g.name)`;
}

// Live temp groups, newest first. Expired ones are dropped first so callers
// never see a group that's past its TTL.
export async function listTempGroups(businessId) {
  const sql = await getSql();
  await purgeExpiredTempGroups(businessId);
  return sql`
    SELECT g.*,
           CAST(COUNT(gm.contact_id) AS INTEGER) AS member_count
      FROM groups g
      LEFT JOIN group_members gm ON gm.group_id = g.id
     WHERE g.business_id = ${businessId}
       AND g.is_temp
     GROUP BY g.id
     ORDER BY g.created_at DESC`;
}

// Delete temp groups whose TTL has passed. Cheap and idempotent — called on
// the paths that read or create temp groups rather than on a cron.
export async function purgeExpiredTempGroups(businessId) {
  const sql = await getSql();
  const res = await sql`
    DELETE FROM groups
     WHERE business_id = ${businessId}
       AND is_temp
       AND expires_at IS NOT NULL
       AND expires_at <= now()`;
  return res.count;
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

// A "new user" is a contact who has written in but whom we have never messaged
// — the set the welcome template is meant for. Used to scope the welcome
// broadcast so established contacts don't get greeted again.
export async function listNewGroupMembers(groupId) {
  const sql = await getSql();
  return sql`
    SELECT c.* FROM contacts c
      JOIN group_members gm ON gm.contact_id = c.id
     WHERE gm.group_id = ${groupId}
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id AND m.direction = 'out')
     ORDER BY lower(c.name)`;
}

// Bundle everyone with unread replies into a throwaway group, so the whole
// backlog can be actioned (broadcast, welcome) in one place. Returns null when
// there is nothing unread. TTL defaults to a day — the snapshot goes stale as
// soon as chats are opened, so it isn't meant to outlive the session.
export async function createTempGroupFromUnread(businessId, { ttlHours = 24 } = {}) {
  const sql = await getSql();
  await purgeExpiredTempGroups(businessId);

  const unread = await unreadContacts(businessId);
  if (!unread.length) return null;

  const stamp = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const name = `Unread — ${stamp}`;
  const expiresAt = new Date(Date.now() + ttlHours * 3600000);

  const group = await sql.begin(async (tx) => {
    const [row] = await tx`
      INSERT INTO groups (business_id, name, is_temp, expires_at)
      VALUES (${businessId}, ${name}, true, ${expiresAt})
      RETURNING *`;
    for (const c of unread) {
      await tx`INSERT INTO group_members (group_id, contact_id) VALUES (${row.id}, ${c.id})
               ON CONFLICT DO NOTHING`;
    }
    return row;
  });

  return {
    group,
    memberCount: unread.length,
    newCount: unread.filter((c) => c.is_new).length,
  };
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
// `is_new` marks contacts we have never sent anything to (see
// listNewGroupMembers) — the welcome-template audience.
export async function unreadContacts(businessId) {
  const sql = await getSql();
  return sql`
    SELECT c.*,
           (SELECT body FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
             ORDER BY m.id DESC LIMIT 1) AS last_reply,
           (SELECT created_at FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in'
             ORDER BY m.id DESC LIMIT 1) AS last_reply_at,
           NOT EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id AND m.direction = 'out') AS is_new,
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
