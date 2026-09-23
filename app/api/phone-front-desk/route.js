import {
  accessErrorResponse,
  assertPrincipalCapability,
  authorizeApiAccess,
} from "@platform/server/access-control";
import {
  phoneFrontDeskSnapshot,
  savePhoneFrontDeskCall,
  savePhoneFrontDeskProfile,
} from "@platform/server/phone-front-desk-store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function authorize(level, capability) {
  const principal = await authorizeApiAccess("messaging.ai-phone-front-desk", level);
  return assertPrincipalCapability(principal, capability);
}

function failure(error, fallback) {
  try { return accessErrorResponse(error); } catch {
    console.error(fallback, error);
    return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: Number(error?.status) || 500 });
  }
}

export async function GET() {
  try {
    const actor = await authorize("view", "messaging.view");
    return Response.json({ ok: true, ...(await phoneFrontDeskSnapshot(actor)) });
  } catch (error) {
    return failure(error, "Unable to load AI Phone Front Desk.");
  }
}

export async function PUT(request) {
  try {
    const actor = await authorize("configure", "messaging.configure");
    const profile = await savePhoneFrontDeskProfile(actor, await request.json());
    return Response.json({ ok: true, profile });
  } catch (error) {
    return failure(error, "Unable to save the receptionist profile.");
  }
}

export async function POST(request) {
  try {
    const actor = await authorize("operate", "messaging.operate");
    const call = await savePhoneFrontDeskCall(actor, await request.json());
    return Response.json({ ok: true, call }, { status: 201 });
  } catch (error) {
    return failure(error, "Unable to save the call summary.");
  }
}
