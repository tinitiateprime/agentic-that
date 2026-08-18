import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { metaGetTemplates, metaCreateTemplate, metaTemplatesConfigured } from "@whatsapp/lib/wa/provider";
import { credsForBusiness } from "@whatsapp/lib/tenant";

// Meta Cloud API equivalent of /api/wati/templates — lists WhatsApp message
// templates straight from Meta's Graph API for the active WABA. ?all=1 returns
// every template (incl. pending/rejected); otherwise only APPROVED ones.
export async function GET(req) {
  const user = await getCurrentUser();
  if (!user) return whatsappAccessErrorResponse("view");
  const creds = await credsForBusiness(user.business_id);

  if (!metaTemplatesConfigured(creds)) {
    return Response.json({
      configured: false,
      templates: [],
      error: "Meta isn't configured — set META_WABA_ID and META_ACCESS_TOKEN in .env.local.",
    });
  }

  const all = new URL(req.url).searchParams.get("all") === "1";
  try {
    const templates = await metaGetTemplates({ approvedOnly: !all, creds });
    return Response.json({ configured: true, templates });
  } catch (err) {
    return Response.json({ configured: true, templates: [], error: err.message }, { status: 502 });
  }
}

// Submit a new template to Meta for review. Body: { name, category, language,
// bodyText, headerText?, headerImageHandle?, footerText?, buttons? }.
// `buttons` is [{ type: "QUICK_REPLY"|"URL"|"PHONE_NUMBER", text, url?, phoneNumber? }].
export async function POST(req) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");
  const creds = await credsForBusiness(user.business_id);

  if (!metaTemplatesConfigured(creds)) {
    return Response.json({ error: "Meta isn't configured — set META_WABA_ID and META_ACCESS_TOKEN in .env.local." }, { status: 400 });
  }

  const { name, category, language, bodyText, headerText, headerImageHandle, footerText, buttons } = await req.json();
  if (!name?.trim()) return Response.json({ error: "Template name is required" }, { status: 400 });
  if (!bodyText?.trim()) return Response.json({ error: "Body text is required" }, { status: 400 });
  if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) {
    return Response.json({ error: "Category must be MARKETING, UTILITY, or AUTHENTICATION" }, { status: 400 });
  }

  try {
    const result = await metaCreateTemplate({
      name: name.trim(),
      category,
      language: language || "en_US",
      bodyText: bodyText.trim(),
      headerText,
      headerImageHandle,
      footerText,
      buttons, creds });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
