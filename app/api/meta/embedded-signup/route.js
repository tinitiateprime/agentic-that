import { getCurrentUser } from "@whatsapp/lib/auth";
import { getSql } from "@whatsapp/lib/db";
import { updateMetaAccount, upsertAccount, syncNumbers, credsForProvider } from "@whatsapp/lib/tenant";
import { metaListPhoneNumbers } from "@whatsapp/lib/wa/provider";

// Settings -> "Connect via Meta" button (Embedded Signup). The browser never
// sees an access token or the app secret — it only hands us the short-lived
// authorization code plus the waba_id/phone_number_id Meta's popup posted
// back to it (window "message" event, type WA_EMBEDDED_SIGNUP). This
// exchanges the code server-side, verifies it against Meta the same way the
// manual "WABA id / Access token" form does, and saves through the same path.
export async function POST(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { code, wabaId, phoneNumberId } = await req.json();
  if (!code || !wabaId) {
    return Response.json({ error: "Missing authorization code or WABA id from the signup popup" }, { status: 400 });
  }

  const appId = (process.env.META_APP_ID || "").trim();
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  const apiVersion = process.env.META_API_VERSION || "v21.0";
  if (!appId || !appSecret) {
    return Response.json({ error: "META_APP_ID / META_APP_SECRET are not configured on the server" }, { status: 500 });
  }

  // The JS SDK's Embedded Signup flow needs no redirect_uri for this
  // exchange (unlike a server-side OAuth redirect flow).
  let accessToken;
  try {
    const url = new URL(`https://graph.facebook.com/${apiVersion}/oauth/access_token`);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("client_secret", appSecret);
    url.searchParams.set("code", code);
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(data?.error?.message || `Token exchange failed (HTTP ${res.status})`);
    }
    accessToken = data.access_token;
  } catch (err) {
    return Response.json({ error: `Couldn't exchange the signup code: ${err.message}` }, { status: 400 });
  }

  let liveNumbers;
  try {
    liveNumbers = await metaListPhoneNumbers({ accessToken, wabaId, apiVersion });
  } catch (err) {
    return Response.json({ error: `Signed in, but couldn't verify the WABA: ${err.message}` }, { status: 400 });
  }
  if (!liveNumbers.length) {
    return Response.json(
      { error: "Meta accepted the sign-in but this WABA has no phone numbers on it." },
      { status: 400 }
    );
  }
  const defaultId = liveNumbers.some((n) => String(n.id) === String(phoneNumberId)) ? phoneNumberId : liveNumbers[0].id;

  // First-time connection for this business (no Meta account row yet) vs.
  // moving an already-onboarded one to a new WABA — same distinction the
  // manual form's /api/meta/account route doesn't need to make, since it
  // only ever edits an existing row.
  const existing = await credsForProvider(user.business_id, "meta");
  let account;
  try {
    account = existing?.accountId
      ? await updateMetaAccount(user.business_id, { wabaId, accessToken, appId, apiVersion })
      : await upsertAccount({
          businessId: user.business_id,
          wabaId,
          accessToken,
          appId,
          apiVersion,
          provider: "meta",
          onboardingSource: "embedded-signup",
          status: "active",
        });
  } catch (err) {
    const claimed = /already connected|unique|duplicate/i.test(String(err?.message));
    return Response.json(
      { error: claimed ? "This WhatsApp Business Account is already connected to another workspace." : err.message },
      { status: claimed ? 409 : 400 }
    );
  }

  let numbers;
  try {
    numbers = await syncNumbers(account.id, liveNumbers, { defaultPhoneNumberId: defaultId });
  } catch (err) {
    const conflict = /already connected/i.test(String(err?.message));
    return Response.json({ error: err.message || "Could not save these phone numbers" }, { status: conflict ? 409 : 400 });
  }
  const sql = await getSql();
  await sql`
    UPDATE businesses
       SET provider = 'meta',
           active_wa_provider = CASE
             WHEN onboarded_at IS NULL OR active_wa_provider IS NULL OR active_wa_provider = 'mock' THEN 'meta'
             ELSE active_wa_provider
           END
     WHERE id = ${user.business_id}`;

  return Response.json({ ok: true, numbers });
}
