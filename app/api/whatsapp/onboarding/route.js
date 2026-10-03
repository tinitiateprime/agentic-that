import { getSql } from "@whatsapp/lib/db";
import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { getAccountForBusiness, listTenantNumbers, upsertAccount, syncNumbers } from "@whatsapp/lib/tenant";
import { metaListPhoneNumbers, watiGetContacts } from "@whatsapp/lib/wa/provider";
import { hasEncryptionKey } from "@whatsapp/lib/crypto";

// Self-serve onboarding for a new workspace.
//   GET                      -> current setup state (drives the wizard)
//   POST { step: "profile" } -> business name / admin number / currency
//   POST { step: "whatsapp" }-> validate + store WABA credentials, sync numbers
//   POST { step: "default-number" } -> pick the default sender
//   POST { step: "complete" }-> mark onboarded
//
// Credentials are validated against Meta before they're stored, so a typo
// surfaces immediately instead of failing later on the first send.
export async function GET() {
  const user = await getCurrentUser("configure");
  if (!user) return whatsappAccessErrorResponse("configure");

  const sql = await getSql();
  const [business] = await sql`SELECT * FROM businesses WHERE id = ${user.business_id}`;
  const account = await getAccountForBusiness(user.business_id);
  const numbers = account ? await listTenantNumbers(user.business_id) : [];

  return Response.json({
    ok: true,
    business,
    connected: Boolean(account),
    // Never send secrets back to the browser — only whether they're set.
    account: account
      ? {
          id: account.id,
          waba_id: account.waba_id,
          api_version: account.api_version,
          app_id: account.app_id,
          status: account.status,
          provider: account.provider,
          service_url: account.service_url,
          onboarding_source: account.onboarding_source,
          has_token: Boolean(account.access_token),
        }
      : null,
    numbers,
    onboarded: Boolean(business?.onboarded_at),
    encryptionReady: hasEncryptionKey(),
  });
}

export async function POST(req) {
  const user = await getCurrentUser("configure");
  if (!user) return whatsappAccessErrorResponse("configure");

  const body = await req.json().catch(() => ({}));
  const sql = await getSql();

  if (body.step === "profile") {
    const name = String(body.name || "").trim();
    if (!name) return Response.json({ error: "Business name is required" }, { status: 400 });
    await sql`
      UPDATE businesses
         SET name = ${name},
             admin_number = ${String(body.adminNumber || "").trim() || null},
             currency = ${String(body.currency || "INR").trim()}
       WHERE id = ${user.business_id}`;
    return Response.json({ ok: true });
  }

  if (body.step === "whatsapp") {
    if (!hasEncryptionKey()) {
      return Response.json(
        { error: "Server is missing CREDENTIAL_ENCRYPTION_KEY — credentials can't be stored securely." },
        { status: 500 }
      );
    }
    const wabaId = String(body.wabaId || "").trim();
    const accessToken = String(body.accessToken || "").trim();
    if (!wabaId || !accessToken) {
      return Response.json({ error: "WABA ID and access token are required" }, { status: 400 });
    }

    // Prove the credentials work (and belong together) before storing them.
    const candidate = {
      wabaId,
      accessToken,
      apiVersion: String(body.apiVersion || "").trim() || "v21.0",
      appId: String(body.appId || "").trim() || null,
      defaultPhoneNumberId: null,
    };
    let numbers;
    try {
      numbers = await metaListPhoneNumbers(candidate);
    } catch (err) {
      return Response.json({ error: `Meta rejected these credentials: ${err.message}` }, { status: 400 });
    }
    if (!numbers.length) {
      return Response.json(
        { error: "That WABA has no phone numbers yet. Add a number in Meta Business Manager first." },
        { status: 400 }
      );
    }

    // waba_id is globally UNIQUE — block connecting a WABA already claimed by
    // another workspace (would otherwise hijack that tenant's webhooks).
    const [claimed] = await sql`SELECT business_id FROM whatsapp_accounts WHERE waba_id = ${wabaId}`;
    if (claimed && Number(claimed.business_id) !== Number(user.business_id)) {
      return Response.json(
        { error: "This WhatsApp Business Account is already connected to another workspace." },
        { status: 409 }
      );
    }

    let saved;
    try {
      const account = await upsertAccount({
        businessId: user.business_id,
        wabaId,
        accessToken,
        appId: candidate.appId,
        appSecret: String(body.appSecret || "").trim() || null,
        apiVersion: candidate.apiVersion,
        provider: "meta",
        onboardingSource: "manual",
        status: "active",
      });
      saved = await syncNumbers(account.id, numbers, {
        defaultPhoneNumberId: numbers[0]?.id,
      });
    } catch (err) {
      const conflict = /already connected/i.test(String(err?.message));
      return Response.json({ error: err.message || "Could not save this WhatsApp account" }, { status: conflict ? 409 : 400 });
    }
    await sql`
      UPDATE businesses
         SET provider = 'meta', active_wa_provider = 'meta'
       WHERE id = ${user.business_id}`;
    return Response.json({ ok: true, provider: "meta", numbers: saved });
  }

  if (body.step === "wati") {
    if (!hasEncryptionKey()) {
      return Response.json(
        { error: "Server is missing CREDENTIAL_ENCRYPTION_KEY — credentials can't be stored securely." },
        { status: 500 }
      );
    }

    const serviceUrl = String(body.apiUrl || "").trim().replace(/\/+$/, "");
    const accessToken = String(body.accessToken || "").trim();
    const webhookSecret = String(body.webhookSecret || "").trim();

    let parsed;
    try {
      parsed = new URL(serviceUrl);
    } catch {
      return Response.json({ error: "Enter a valid WATI API endpoint URL" }, { status: 400 });
    }
    if (parsed.protocol !== "https:") {
      return Response.json({ error: "The WATI API endpoint must use HTTPS" }, { status: 400 });
    }
    if (!accessToken) {
      return Response.json({ error: "WATI access token is required" }, { status: 400 });
    }
    if (webhookSecret.length < 24) {
      return Response.json(
        { error: "Use a webhook secret with at least 24 characters" },
        { status: 400 }
      );
    }

    let contacts;
    try {
      contacts = await watiGetContacts(
        { pageSize: 1 },
        { provider: "wati", serviceUrl, accessToken }
      );
    } catch (err) {
      return Response.json(
        { error: `WATI rejected these connection details: ${err.message}` },
        { status: 400 }
      );
    }

    try {
      await upsertAccount({
        businessId: user.business_id,
        wabaId: `wati:${user.business_id}`,
        accessToken,
        webhookVerifyToken: webhookSecret,
        provider: "wati",
        onboardingSource: "self-serve",
        status: "active",
        serviceUrl,
      });
    } catch (err) {
      return Response.json(
        { error: err.message || "Could not save this WATI account" },
        { status: 400 }
      );
    }

    await sql`
      UPDATE businesses
         SET provider = 'wati', active_wa_provider = 'wati'
       WHERE id = ${user.business_id}`;

    return Response.json({
      ok: true,
      provider: "wati",
      apiUrl: serviceUrl,
      contactCheck: contacts.length,
      numbers: [],
    });
  }

  if (body.step === "default-number") {
    const phoneNumberId = String(body.phoneNumberId || "").trim();
    const account = await getAccountForBusiness(user.business_id);
    if (!account) return Response.json({ error: "Connect WhatsApp first" }, { status: 400 });
    const [ownedNumber] = await sql`
      SELECT id FROM whatsapp_numbers
       WHERE whatsapp_account_id = ${account.id} AND phone_number_id = ${phoneNumberId}`;
    if (!ownedNumber) return Response.json({ error: "Choose a sender number from this account" }, { status: 400 });
    await sql`
      UPDATE whatsapp_numbers SET is_default = (phone_number_id = ${phoneNumberId}), updated_at = now()
       WHERE whatsapp_account_id = ${account.id}`;
    return Response.json({ ok: true, numbers: await listTenantNumbers(user.business_id) });
  }

  if (body.step === "complete") {
    const account = await getAccountForBusiness(user.business_id);
    if (!account) return Response.json({ error: "Connect WhatsApp before finishing" }, { status: 400 });
    await sql`UPDATE businesses SET onboarded_at = now() WHERE id = ${user.business_id} AND onboarded_at IS NULL`;
    return Response.json({ ok: true, next: "/dashboard" });
  }

  return Response.json({ error: "Unknown step" }, { status: 400 });
}
