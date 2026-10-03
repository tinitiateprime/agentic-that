import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { metaGetCallSettings, metaUpdateCallSettings, metaConfigured } from "@whatsapp/lib/wa/provider";
import { credsForBusiness } from "@whatsapp/lib/tenant";

// Read / modify the WhatsApp Calling settings for one business number.
//   GET  ?id=<Phone Number ID>   -> { calling: { status, call_icon_visibility, ... } }
//   POST { phoneNumberId, status, callIconVisibility, callbackPermissionStatus }
//
// Enabling calling is a live change to the business number (it turns on the
// in-chat call button for customers), so it's driven explicitly from Settings.
export async function GET(req) {
  const user = await getCurrentUser();
  if (!user) return whatsappAccessErrorResponse("view");
  const creds = await credsForBusiness(user.business_id);
  if (!metaConfigured(creds)) {
    return Response.json({ error: "Meta isn't configured — set META_ACCESS_TOKEN." }, { status: 400 });
  }

  const phoneNumberId = new URL(req.url).searchParams.get("id") || process.env.META_PHONE_NUMBER_ID;
  if (!phoneNumberId) return Response.json({ error: "Enter a Phone Number ID" }, { status: 400 });

  try {
    return Response.json({ ok: true, calling: await metaGetCallSettings({ phoneNumberId, creds }) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}

export async function POST(req) {
  const user = await getCurrentUser("configure");
  if (!user) return whatsappAccessErrorResponse("configure");
  const creds = await credsForBusiness(user.business_id);
  if (!metaConfigured(creds)) {
    return Response.json({ error: "Meta isn't configured — set META_ACCESS_TOKEN." }, { status: 400 });
  }

  const { phoneNumberId, status, callIconVisibility, callbackPermissionStatus } = await req.json();
  if (!phoneNumberId) return Response.json({ error: "Enter a Phone Number ID" }, { status: 400 });

  try {
    await metaUpdateCallSettings({ phoneNumberId, status, callIconVisibility, callbackPermissionStatus, creds });
    // Return the settings Meta actually stored, not what we asked for.
    return Response.json({ ok: true, calling: await metaGetCallSettings({ phoneNumberId, creds }) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
