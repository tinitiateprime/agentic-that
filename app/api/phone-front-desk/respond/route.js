import {
  accessErrorResponse,
  assertPrincipalCapability,
  authorizeApiAccess,
} from "@platform/server/access-control";
import { respondToTypedPhoneCall } from "@platform/server/phone-front-desk-store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request) {
  try {
    let actor = await authorizeApiAccess("messaging.ai-phone-front-desk", "operate");
    actor = await assertPrincipalCapability(actor, "messaging.operate");
    return Response.json({ ok: true, ...(await respondToTypedPhoneCall(actor, await request.json())) });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      console.error("AI Phone Front Desk typed response failed", error);
      return Response.json({
        error: error instanceof Error ? error.message : "Unable to continue the demo call.",
      }, { status: Number(error?.status) || 500 });
    }
  }
}
