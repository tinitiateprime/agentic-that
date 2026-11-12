import { accessErrorResponse, authorizeOpenServiceApi } from "@platform/server/access-control";
import { collectSocialSeoSignals } from "@platform/server/social-seo-signals";
import { SocialSeoInputError, buildInstagramSeo } from "@platform/social-seo/instagram-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request) {
  try {
    // Open to every signed-in, active user.
    const principal = await authorizeOpenServiceApi();

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new SocialSeoInputError("The request is too large.");
    let body;
    try { body = JSON.parse(raw || "{}"); } catch { throw new SocialSeoInputError("The request is not valid JSON."); }

    const description = String(body?.description || "");
    const gps = body?.gps && typeof body.gps === "object" ? body.gps : null;
    const media = Array.isArray(body?.media) ? body.media : [];
    const brandName = String(body?.brandName || "");
    const signals = await collectSocialSeoSignals({ description, gps, brandName, fileNames: media.map((item) => String(item?.name || "")) });
    const result = buildInstagramSeo({
      description,
      media,
      brandName,
      workspaceName: principal.businessName,
      location: signals.location,
      signals,
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof SocialSeoInputError) {
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    try { return accessErrorResponse(error); } catch {
      console.error("Social SEO generation failed", error);
      return Response.json({ error: "Unable to prepare Social SEO suggestions." }, { status: 500 });
    }
  }
}
