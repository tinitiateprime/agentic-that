import { getSql } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { importContacts } from "@/lib/data";
import { normalizeWaNumber, watiConfigured, watiGetContacts } from "@/lib/wa/provider";

// Create a CRM group directly from WATI contacts.
// Body:
//   { name: "June Leads" }                  -> imports all visible WATI contacts
//   { name: "VIP", phones: ["+9198..."] }   -> imports only those WATI numbers
//
// WATI's WhatsApp APIs send to individual numbers, so this app stores groups
// locally and uses WATI only for contact import + outbound messaging.
export async function POST(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!watiConfigured()) {
    return Response.json({ error: "WATI isn't configured." }, { status: 400 });
  }

  const { name, phones } = await req.json().catch(() => ({}));
  const groupName = name?.trim();
  if (!groupName) return Response.json({ error: "Name is required" }, { status: 400 });

  let watiContacts;
  try {
    watiContacts = await watiGetContacts({ pageSize: 100 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }

  if (Array.isArray(phones) && phones.length > 0) {
    const wanted = new Set(phones.map(normalizeWaNumber));
    watiContacts = watiContacts.filter((c) => wanted.has(normalizeWaNumber(c.phone)));
  }

  if (!watiContacts.length) {
    return Response.json({ error: "No matching WATI contacts found" }, { status: 404 });
  }

  const imported = await importContacts(user.business_id, watiContacts);
  const wanted = new Set(watiContacts.map((c) => normalizeWaNumber(c.phone)).filter(Boolean));
  const sql = await getSql();
  const allRows = await sql`SELECT id, phone FROM contacts WHERE business_id = ${user.business_id}`;
  const contacts = allRows.filter((c) => wanted.has(normalizeWaNumber(c.phone)));

  const groupId = await sql.begin(async (tx) => {
    const [group] = await tx`INSERT INTO groups (business_id, name) VALUES (${user.business_id}, ${groupName}) RETURNING id`;
    for (const contact of contacts) {
      await tx`INSERT INTO group_members (group_id, contact_id) VALUES (${group.id}, ${contact.id}) ON CONFLICT DO NOTHING`;
    }
    return group.id;
  });
  return Response.json({
    ok: true,
    id: groupId,
    memberCount: contacts.length,
    imported: imported.imported,
    skipped: imported.skipped,
  });
}
