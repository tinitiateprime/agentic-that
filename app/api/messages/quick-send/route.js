import { getSql } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getBusiness } from "@/lib/data";
import { sendToContact, sendTemplateToContact, renderTemplate } from "@/lib/wa/messaging";
import { normalizeWaNumber, metaGetTemplates, metaTemplatesConfigured } from "@/lib/wa/provider";

// Meta's onboarding sample templates — never auto-pick these as the opener
// (hello_world only works on the public test numbers anyway).
const SAMPLE_TEMPLATES = new Set(["hello_world", "3p_direct_integration_test_template"]);

// Accessory for messaging a raw phone number straight from the dashboard,
// without first adding it as a contact.
//   - number already in contacts -> the typed text goes out as-is
//   - number NOT in contacts     -> it's a brand-new conversation, so an
//     approved WhatsApp template is sent to open the chat (free text can't
//     start a conversation); the typed text stays in the composer for after
//     the customer replies.
export async function POST(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { phone, name, body, phoneNumberId } = await req.json();
  const waId = normalizeWaNumber(phone);
  const text = body?.trim();
  if (!waId) return Response.json({ error: "Enter a valid WhatsApp number" }, { status: 400 });
  if (!text) return Response.json({ error: "Message is empty" }, { status: 400 });

  const business = await getBusiness(user.business_id);

  const sql = await getSql();
  const rows = await sql`SELECT * FROM contacts WHERE business_id = ${business.id}`;
  let contact = rows.find((c) => normalizeWaNumber(c.phone) === waId);
  const isNewNumber = !contact;

  if (!contact) {
    // Without a name, default to the phone number — renderTemplate() treats
    // that as "no name known" so {{name}} doesn't show the number back to them.
    [contact] = await sql`
      INSERT INTO contacts (business_id, name, phone)
      VALUES (${business.id}, ${name?.trim() || `+${waId}`}, ${`+${waId}`})
      RETURNING *`;
  }

  const provider = (process.env.WA_PROVIDER || "mock").toLowerCase();

  // Number not found in contacts -> open the chat with an approved template.
  if (provider === "meta" && isNewNumber) {
    if (!metaTemplatesConfigured()) {
      return Response.json(
        { error: "New number needs an approved template, but Meta templates aren't configured." },
        { status: 400 }
      );
    }
    let approved = [];
    try {
      approved = await metaGetTemplates({ approvedOnly: true });
    } catch (err) {
      return Response.json({ error: err.message }, { status: 502 });
    }
    // Prefer a real template over Meta's onboarding samples.
    const tpl = approved.find((t) => !SAMPLE_TEMPLATES.has(t.name)) || approved[0];
    if (!tpl) {
      return Response.json(
        { error: "No approved WhatsApp template available — approve one under Dashboard → WhatsApp templates first." },
        { status: 400 }
      );
    }

    const names = tpl.placeholderNames?.length
      ? tpl.placeholderNames
      : Array.from({ length: tpl.placeholders || 0 }, (_, i) => String(i + 1));
    const params = names.map((n) => ({
      name: n,
      value: renderTemplate("{{name}}", { contact, business }),
    }));

    const message = await sendTemplateToContact({
      business,
      contact,
      watiTemplate: tpl.name,
      params,
      language: tpl.language,
      previewBody: `[WhatsApp template: ${tpl.name}]`,
      broadcastName: `quicksend_${contact.id}_${Date.now()}`,
      phoneNumberId: phoneNumberId || undefined,
    });
    return Response.json({ ok: true, message, contact, usedTemplate: tpl.name });
  }

  const message = await sendToContact({ business, contact, body: text, phoneNumberId: phoneNumberId || undefined });
  return Response.json({ ok: true, message, contact });
}
