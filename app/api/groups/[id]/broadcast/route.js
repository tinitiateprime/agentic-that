import { getCurrentUser } from "@/lib/auth";
import { getBusiness, getGroup, listGroupMembers, listTemplates } from "@/lib/data";
import { sendToContact, sendTemplateToContact, sendButtonsToContact, renderTemplate } from "@/lib/wa/messaging";

// Broadcast to every member of a group — one individual DM each.
//
// Three modes (mutually exclusive):
//  1) Free text / CRM template  -> { body } or { templateId }
//     Sent as a session text message. On a live provider this ONLY delivers to
//     contacts who messaged you within the last 24h (WhatsApp rule).
//  2) Approved WhatsApp template -> { watiTemplate, templateParams }
//     Sent via the provider's approved-template API. Delivers to any contact,
//     even cold ones. `templateParams` values may use the literal "{{name}}"
//     to substitute each contact's name.
//  3) Interactive bot buttons -> { body, buttons: ["Sales", "Support"] }
//     Sent as an interactive button/session message to each group member via
//     the active provider (WA_PROVIDER=meta).
export async function POST(req, { params }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const business = await getBusiness(user.business_id);
  const group = await getGroup(user.business_id, id);
  if (!group) return Response.json({ error: "Group not found" }, { status: 404 });

  const members = await listGroupMembers(group.id);
  if (!members.length) return Response.json({ error: "Group has no members" }, { status: 400 });

  const { body, templateId, watiTemplate, templateParams, language, buttons, phoneNumberId } =
    await req.json();
  const fromPhoneId = phoneNumberId || undefined;

  const results = [];

  // ── Mode 3: interactive bot buttons ──────────────────────────────────────
  if (Array.isArray(buttons) && buttons.length > 0) {
    const text = body?.trim();
    const cleanButtons = buttons.map((b) => String(b).trim()).filter(Boolean).slice(0, 3);
    if (!text) return Response.json({ error: "Bot messages need body text" }, { status: 400 });
    if (!cleanButtons.length) return Response.json({ error: "Add at least one bot button" }, { status: 400 });

    for (const contact of members) {
      const msg = await sendButtonsToContact({
        business,
        contact,
        body: renderTemplate(text, { contact, business }),
        buttons: cleanButtons,
        phoneNumberId: fromPhoneId,
      });
      results.push({ contactId: contact.id, name: contact.name, status: msg.status, error: msg.error || null });
    }
    return Response.json({ ok: true, mode: "bot", sent: countSent(results), total: results.length, results });
  }

  // ── Mode 2: approved WhatsApp template ────────────────────────────────────
  if (watiTemplate) {
    const broadcastName = `${group.name}_${Date.now()}`.replace(/\s+/g, "_");
    for (const contact of members) {
      const paramsForContact = (Array.isArray(templateParams) ? templateParams : []).map((v) =>
        v && typeof v === "object"
          ? { ...v, value: renderTemplate(v.value, { contact, business }) }
          : renderTemplate(v, { contact, business })
      );
      const msg = await sendTemplateToContact({
        business,
        contact,
        watiTemplate,
        params: paramsForContact,
        language,
        previewBody: `[WhatsApp template: ${watiTemplate}]`,
        broadcastName,
        phoneNumberId: fromPhoneId,
      });
      results.push({ contactId: contact.id, name: contact.name, status: msg.status, error: msg.error || null });
    }
    return Response.json({ ok: true, mode: "template", sent: countSent(results), total: results.length, results });
  }

  // ── Mode 1: free text / CRM template (session message) ────────────────────
  let templateName = null;
  let getBody;
  if (templateId) {
    const tpl = (await listTemplates(user.business_id)).find((t) => t.id === Number(templateId));
    if (!tpl) return Response.json({ error: "Template not found" }, { status: 404 });
    templateName = tpl.name;
    getBody = (contact) => renderTemplate(tpl.body, { contact, business });
  } else {
    const text = body?.trim();
    if (!text) return Response.json({ error: "Provide a message, CRM template, or WhatsApp template" }, { status: 400 });
    getBody = () => text;
  }

  for (const contact of members) {
    const msg = await sendToContact({ business, contact, body: getBody(contact), templateName, phoneNumberId: fromPhoneId });
    results.push({ contactId: contact.id, name: contact.name, status: msg.status, error: msg.error || null });
  }

  return Response.json({ ok: true, mode: "session", sent: countSent(results), total: results.length, results });
}

function countSent(results) {
  return results.filter((r) => r.status !== "failed").length;
}
