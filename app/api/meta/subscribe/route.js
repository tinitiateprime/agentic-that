import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { credsForProvider, setAppSubscribed } from "@whatsapp/lib/tenant";
import { metaSubscribeApp } from "@whatsapp/lib/wa/provider";

// Subscribe our app to the business's WABA webhooks using stored credentials.
// Powers Settings → "Enable receiving": Embedded Signup does this on connect,
// but accounts onboarded before that step existed (or where it failed) can
// turn on inbound delivery here without reconnecting. Idempotent on Meta's side.
export async function POST() {
  const user = await getCurrentUser("configure");
  if (!user) return whatsappAccessErrorResponse("configure");

  const creds = await credsForProvider(user.business_id, "meta");
  if (!creds?.accessToken || !creds?.wabaId) {
    return Response.json({ error: "Connect a Meta WhatsApp number first." }, { status: 400 });
  }

  try {
    await metaSubscribeApp({ accessToken: creds.accessToken, wabaId: creds.wabaId, apiVersion: creds.apiVersion });
    if (creds.accountId) await setAppSubscribed(creds.accountId, true);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
