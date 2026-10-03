import { getSql } from "@whatsapp/lib/db";
import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { getBusiness } from "@whatsapp/lib/data";
import { sendToContact, sendTemplateToContact, renderTemplate } from "@whatsapp/lib/wa/messaging";

const MAX_RECIPIENTS = 200;

// Send one message to specific, hand-picked WhatsApp contacts (one DM each).
//   { contactIds, body }                        -> free text (24h window applies)
//   { contactIds, watiTemplate, templateParams } -> approved template, any contact
export async function POST(req) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");

  const { contactIds, excludeGroupIds, body, watiTemplate, templateParams, language } = await req.json();
  let ids = Array.isArray(contactIds) ? [...new Set(contactIds.map(Number).filter(Number.isInteger))] : [];
  if (!ids.length) return Response.json({ error: "Choose at least one contact" }, { status: 400 });
  if (ids.length > MAX_RECIPIENTS) {
    return Response.json({ error: `Choose at most ${MAX_RECIPIENTS} contacts at a time` }, { status: 400 });
  }
  const text = body?.trim();
  if (!watiTemplate && !text) return Response.json({ error: "Write a message or choose a template" }, { status: 400 });

  const business = await getBusiness(user.business_id);
  const sql = await getSql();

  // People already reached through a group broadcast in the same send are skipped,
  // so nobody gets the message twice.
  const groupIds = Array.isArray(excludeGroupIds) ? excludeGroupIds.map(Number).filter(Number.isInteger) : [];
  if (groupIds.length) {
    const covered = await sql`
      SELECT gm.contact_id FROM group_members gm
        JOIN groups g ON g.id = gm.group_id
       WHERE g.business_id = ${user.business_id} AND gm.group_id IN ${sql(groupIds)}`;
    const skip = new Set(covered.map((row) => row.contact_id));
    ids = ids.filter((id) => !skip.has(id));
    if (!ids.length) return Response.json({ ok: true, sent: 0, total: 0, results: [] });
  }
  const contacts = await sql`SELECT * FROM contacts WHERE business_id = ${user.business_id} AND id IN ${sql(ids)}`;
  if (!contacts.length) return Response.json({ error: "Contacts not found" }, { status: 404 });

  const broadcastName = `selected_${Date.now()}`;
  const results = [];
  for (const contact of contacts) {
    const msg = watiTemplate
      ? await sendTemplateToContact({
          business,
          contact,
          watiTemplate,
          params: (Array.isArray(templateParams) ? templateParams : []).map((v) =>
            v && typeof v === "object"
              ? { ...v, value: renderTemplate(v.value, { contact, business }) }
              : renderTemplate(v, { contact, business })
          ),
          language,
          previewBody: `[WhatsApp template: ${watiTemplate}]`,
          broadcastName,
        })
      : await sendToContact({ business, contact, body: text });
    results.push({ contactId: contact.id, name: contact.name, status: msg.status, error: msg.error || null });
  }
  return Response.json({
    ok: true,
    sent: results.filter((r) => r.status !== "failed").length,
    total: results.length,
    results,
  });
}
