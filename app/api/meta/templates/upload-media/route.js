import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { metaUploadTemplateImage, metaConfigured } from "@whatsapp/lib/wa/provider";
import { credsForBusiness } from "@whatsapp/lib/tenant";

const MAX_BYTES = 5 * 1024 * 1024; // Meta's limit for template header images

// Uploads an image for use as a template HEADER and returns its handle, which
// gets passed to POST /api/meta/templates as headerImageHandle.
export async function POST(req) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");
  const creds = await credsForBusiness(user.business_id);

  if (!metaConfigured(creds)) {
    return Response.json({ error: "Meta isn't configured — set META_ACCESS_TOKEN in .env.local." }, { status: 400 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    return Response.json({ error: "Only JPEG or PNG images are supported" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Image must be under 5MB" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const handle = await metaUploadTemplateImage({ buffer, mimeType: file.type, creds });
    return Response.json({ ok: true, handle });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
