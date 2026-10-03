import { accessErrorResponse, assertPrincipalCapability, authorizeApiAccess } from "@platform/server/access-control";
import { sendPhoneFrontDeskUrgentAlert } from "@platform/server/phone-front-desk-store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request) {
  try {
    const raw = await request.text();
    if (raw.length > 4_000) return Response.json({ error: "Invalid alert request." }, { status: 400 });
    const actor = await assertPrincipalCapability(await authorizeApiAccess("messaging.ai-phone-front-desk", "operate"), "messaging.operate");
    return Response.json({ ok: true, ...(await sendPhoneFrontDeskUrgentAlert(actor, JSON.parse(raw || "{}"))) });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      console.error("Phone Front Desk urgent alert failed", error);
      return Response.json({ error: error instanceof Error ? error.message : "Urgent alert failed." }, { status: Number(error?.status) || 500 });
    }
  }
}
