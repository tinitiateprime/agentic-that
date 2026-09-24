import { accessErrorResponse, assertPrincipalCapability, authorizeApiAccess } from "@platform/server/access-control";
import { deliverPhoneFrontDeskSummary } from "@platform/server/phone-front-desk-store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(_request, { params }) {
  try {
    const actor = await assertPrincipalCapability(await authorizeApiAccess("messaging.ai-phone-front-desk", "operate"), "messaging.operate");
    const { id } = await params;
    const call = await deliverPhoneFrontDeskSummary(actor, id);
    return Response.json({ ok: true, call });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      console.error("Phone Front Desk summary retry failed", error);
      return Response.json({ error: error instanceof Error ? error.message : "Summary email retry failed." }, { status: Number(error?.status) || 500 });
    }
  }
}
