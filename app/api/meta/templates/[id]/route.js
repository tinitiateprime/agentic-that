import { getCurrentUser } from "@whatsapp/lib/auth";
import { metaEditTemplate, metaTemplatesConfigured } from "@whatsapp/lib/wa/provider";
import { credsForBusiness } from "@whatsapp/lib/tenant";

// Edit an existing WhatsApp template on Meta. Body: { category?, bodyText,
// headerText?, headerImageHandle?, footerText?, buttons? }. Name and language
// can't change; an edited APPROVED template returns to PENDING review.
export async function PATCH(req, { params }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const creds = await credsForBusiness(user.business_id);

  if (!metaTemplatesConfigured(creds)) {
    return Response.json(
      { error: "Meta isn't configured — set META_WABA_ID and META_ACCESS_TOKEN in .env.local." },
      { status: 400 }
    );
  }

  const { id } = await params;
  const { category, bodyText, headerText, headerImageHandle, footerText, buttons } = await req.json();
  if (!bodyText?.trim()) return Response.json({ error: "Body text is required" }, { status: 400 });
  if (category && !["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) {
    return Response.json({ error: "Category must be MARKETING, UTILITY, or AUTHENTICATION" }, { status: 400 });
  }

  try {
    const result = await metaEditTemplate({
      templateId: id,
      category,
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
