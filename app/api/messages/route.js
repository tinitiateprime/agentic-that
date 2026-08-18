import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { getBusiness, getContact, listTemplates, markContactRead, lastInboundPhoneId } from "@whatsapp/lib/data";
import {
  sendToContact,
  sendTemplateToContact,
  sendButtonsToContact,
  renderTemplate,
} from "@whatsapp/lib/wa/messaging";

export async function POST(req) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");

  const {
    contactId,
    body,
    templateId,
    watiTemplate,
    templateParams,
    language,
    buttons,
    phoneNumberId: requestedPhoneId,
  } = await req.json();
  const business = await getBusiness(user.business_id);
  const contact = await getContact(user.business_id, contactId);
  if (!contact) return Response.json({ error: "Contact not found" }, { status: 404 });

  // Sender-number routing: explicit pick from the UI wins; otherwise stay on
  // the number the customer last wrote to (same WhatsApp thread on their
  // phone); otherwise the default configured number.
  const phoneNumberId =
    requestedPhoneId || (await lastInboundPhoneId(contact.id)) || process.env.META_PHONE_NUMBER_ID || null;

  // Replying implies the chat has been seen — clear its unread state.
  await markContactRead(user.business_id, contact.id);

  // Approved WhatsApp template. Use this to start/reopen a WATI conversation
  // outside the 24-hour service window.
  if (watiTemplate) {
    const paramsForContact = (Array.isArray(templateParams) ? templateParams : []).map((v) =>
      v && typeof v === "object"
        ? { ...v, value: renderTemplate(v.value, { contact, business }) }
        : renderTemplate(v, { contact, business })
    );
    const message = await sendTemplateToContact({
      business,
      contact,
      watiTemplate,
      params: paramsForContact,
      language,
      previewBody: `[WhatsApp template: ${watiTemplate}]`,
      broadcastName: `contact_${contact.id}_${Date.now()}`,
      phoneNumberId,
    });
    return Response.json({ ok: true, message });
  }

  // Interactive 3-button (Bot) message.
  if (Array.isArray(buttons) && buttons.length > 0) {
    const text = body?.trim();
    if (!text) return Response.json({ error: "Button messages need body text" }, { status: 400 });
    const message = await sendButtonsToContact({
      business,
      contact,
      body: renderTemplate(text, { contact, business }),
      buttons,
      phoneNumberId,
    });
    return Response.json({ ok: true, message });
  }

  let text = body?.trim();
  let templateName = null;

  // Sending from a saved template renders its variables for this contact.
  if (templateId) {
    const tpl = (await listTemplates(user.business_id)).find((t) => t.id === Number(templateId));
    if (!tpl) return Response.json({ error: "Template not found" }, { status: 404 });
    text = renderTemplate(tpl.body, { contact, business });
    templateName = tpl.name;
  }

  if (!text) return Response.json({ error: "Message is empty" }, { status: 400 });

  text = renderTemplate(text, { contact, business });
  const message = await sendToContact({ business, contact, body: text, templateName, phoneNumberId });
  return Response.json({ ok: true, message });
}
