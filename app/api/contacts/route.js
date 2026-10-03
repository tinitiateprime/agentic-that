import { getSql } from "@whatsapp/lib/db";
import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { normalizeWaNumber } from "@whatsapp/lib/wa/provider";

// Contact directory for the omnichannel composer. `active` means the contact
// messaged us in the last 24 hours, i.e. a free-text WhatsApp message will reach them.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return whatsappAccessErrorResponse("view");
  const sql = await getSql();
  const rows = await sql`
    SELECT c.id, c.name, c.phone, c.tags, c.opted_in,
           (SELECT MAX(m.created_at) FROM messages m WHERE m.contact_id = c.id AND m.direction = 'in') AS last_inbound_at
      FROM contacts c
     WHERE c.business_id = ${user.business_id}
     ORDER BY lower(c.name)`;
  const now = Date.now();
  const contacts = rows.map((row) => ({
    ...row,
    active: Boolean(row.last_inbound_at) && now - new Date(row.last_inbound_at).getTime() < 24 * 3600 * 1000,
  }));
  return Response.json({ contacts });
}

export async function POST(req) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");

  const { name, phone, tags, notes } = await req.json();
  const cleanPhone = phone?.trim();
  if (!cleanPhone) {
    return Response.json({ error: "Phone is required" }, { status: 400 });
  }

  const normalized = normalizeWaNumber(cleanPhone);
  const sql = await getSql();
  const rows = await sql`SELECT id, phone FROM contacts WHERE business_id = ${user.business_id}`;
  const existing = rows.find((contact) => normalizeWaNumber(contact.phone) === normalized);
  if (existing) {
    return Response.json({ ok: true, id: existing.id, existing: true });
  }

  try {
    const [row] = await sql`
      INSERT INTO contacts (business_id, name, phone, tags, notes)
      VALUES (${user.business_id}, ${name?.trim() || cleanPhone}, ${cleanPhone},
              ${tags?.trim() || null}, ${notes?.trim() || null})
      RETURNING id`;
    return Response.json({ ok: true, id: row.id });
  } catch (err) {
    if (/UNIQUE|duplicate key/i.test(String(err.message))) {
      return Response.json({ error: "A contact with this phone already exists" }, { status: 409 });
    }
    throw err;
  }
}
