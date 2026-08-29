import { getSql } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import crypto from "node:crypto";

// Per-tenant WhatsApp account resolution. Everything provider-related used to
// come from process.env (single tenant); in SaaS mode it comes from
// whatsapp_accounts + whatsapp_numbers, keyed by the signed-in user's business.
//
// Env vars remain a fallback so the original single-tenant deployment keeps
// working while tenants are migrated into the database (see importEnvAccount).

// Shape every provider call consumes.
function credsFrom(account) {
  return {
    provider: account.provider || "meta",
    wabaId: account.waba_id,
    accessToken: decryptSecret(account.access_token),
    appId: account.app_id,
    appSecret: decryptSecret(account.app_secret),
    apiVersion: account.api_version || "v21.0",
    webhookVerifyToken: decryptSecret(account.webhook_verify_token),
    defaultPhoneNumberId: account.default_phone_number_id || null,
    // Baileys only: base URL of the connection service (../baileys-wa-app).
    // accessToken doubles as its shared x-api-secret for that provider.
    serviceUrl: account.service_url || null,
    // Whether this app is subscribed to the WABA's webhooks (Meta only). False
    // means Meta won't deliver inbound events for it — see metaSubscribeApp.
    appSubscribed: Boolean(account.app_subscribed),
    businessId: account.business_id,
    accountId: account.id,
  };
}

function isCredentialDecryptionFailure(error) {
  const message = String(error?.message || "");
  return /unable to authenticate data|invalid authentication tag|bad decrypt/i.test(message);
}

// A deployment encryption key can be rotated accidentally while old optional
// provider rows (WATI/Baileys) still exist. Those credentials cannot be
// recovered without the old key, but they also must not take down every admin
// page. Treat only authenticated-cipher failures as a disconnected account;
// unexpected programming/database errors still surface normally.
function readableCredsFrom(account) {
  try {
    return credsFrom(account);
  } catch (error) {
    if (!isCredentialDecryptionFailure(error)) throw error;
    console.warn(
      `WhatsApp ${account?.provider || "provider"} account ${account?.id || "unknown"} ` +
        "uses an obsolete encryption key and must be reconnected."
    );
    return null;
  }
}

// Credentials from environment — the pre-SaaS single-tenant path.
export function envCreds() {
  const provider = (process.env.WA_PROVIDER || "mock").toLowerCase();
  if (provider === "wati") {
    return {
      provider,
      wabaId: null,
      accessToken: (process.env.WATI_ACCESS_TOKEN || "").trim() || null,
      appId: null,
      appSecret: null,
      apiVersion: null,
      webhookVerifyToken: (process.env.WATI_WEBHOOK_SECRET || "").trim() || null,
      defaultPhoneNumberId: null,
      serviceUrl: (process.env.WATI_API_URL || "").trim().replace(/\/$/, "") || null,
      businessId: null,
      accountId: null,
      fromEnv: true,
    };
  }
  if (provider === "baileys") {
    return {
      provider,
      wabaId: null,
      accessToken: (process.env.BAILEYS_API_SECRET || "").trim() || null,
      appId: null,
      appSecret: null,
      apiVersion: null,
      webhookVerifyToken: null,
      defaultPhoneNumberId: null,
      serviceUrl: (process.env.BAILEYS_SERVICE_URL || "").trim().replace(/\/$/, "") || null,
      businessId: null,
      accountId: null,
      fromEnv: true,
    };
  }
  return {
    provider,
    wabaId: (process.env.META_WABA_ID || "").trim() || null,
    accessToken: (process.env.META_ACCESS_TOKEN || "").trim() || null,
    appId: (process.env.META_APP_ID || "").trim() || null,
    appSecret: (process.env.META_APP_SECRET || "").trim() || null,
    apiVersion: process.env.META_API_VERSION || "v21.0",
    webhookVerifyToken: (process.env.META_WEBHOOK_VERIFY_TOKEN || "").trim() || null,
    defaultPhoneNumberId: (process.env.META_PHONE_NUMBER_ID || "").trim() || null,
    serviceUrl: null,
    businessId: null,
    accountId: null,
    fromEnv: true,
  };
}

// A single deployment can listen and reply through both Meta and WATI even
// when WA_PROVIDER selects only one as the default outbound channel. The WATI
// adapter reads its API URL/token directly from the server environment; these
// lightweight credentials make it discoverable for contact-level routing.
function envCredsForProvider(provider) {
  const name = String(provider || "").toLowerCase();
  if (name === "meta") {
    const creds = { ...envCreds(), provider: "meta" };
    return creds.accessToken && creds.defaultPhoneNumberId ? creds : null;
  }
  if (name === "wati") {
    const apiUrl = (process.env.WATI_API_URL || "").trim();
    const accessToken = (process.env.WATI_ACCESS_TOKEN || "").trim();
    if (!apiUrl || !accessToken || apiUrl.includes("YOUR_TENANT_ID")) return null;
    return {
      provider: "wati",
      accessToken,
      serviceUrl: apiUrl.replace(/\/$/, ""),
      webhookVerifyToken: (process.env.WATI_WEBHOOK_SECRET || "").trim() || null,
      businessId: null,
      accountId: null,
      fromEnv: true,
    };
  }
  if (name === "baileys") {
    const serviceUrl = (process.env.BAILEYS_SERVICE_URL || "").trim().replace(/\/$/, "");
    const accessToken = (process.env.BAILEYS_API_SECRET || "").trim();
    if (!serviceUrl || !accessToken) return null;
    return {
      provider: "baileys",
      accessToken,
      serviceUrl,
      businessId: null,
      accountId: null,
      fromEnv: true,
    };
  }
  const creds = envCreds();
  return creds.provider === name ? creds : null;
}

async function isLegacyEnvBusiness(businessId) {
  const sql = await getSql();
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (adminEmail) {
    const [adminBusiness] = await sql`
      SELECT business_id FROM users WHERE LOWER(email) = ${adminEmail} ORDER BY id LIMIT 1`;
    if (adminBusiness) return Number(adminBusiness.business_id) === Number(businessId);
  }
  const [firstBusiness] = await sql`SELECT id FROM businesses ORDER BY id LIMIT 1`;
  return Boolean(firstBusiness && Number(firstBusiness.id) === Number(businessId));
}

function unconfiguredCreds(businessId) {
  return {
    provider: "mock",
    wabaId: null,
    accessToken: null,
    appId: null,
    appSecret: null,
    apiVersion: "v21.0",
    webhookVerifyToken: null,
    defaultPhoneNumberId: null,
    serviceUrl: null,
    businessId,
    accountId: null,
  };
}

// WATI has no WABA id in its callback payload, so a tenant-specific secret in
// the callback URL is the routing key. Secrets remain encrypted in storage and
// are compared in constant time after decryption.
export async function resolveTenantByWatiWebhookSecret(secret) {
  if (!secret) return null;
  const sql = await getSql();
  const accounts = await sql`
    SELECT * FROM whatsapp_accounts WHERE provider = 'wati' AND webhook_verify_token IS NOT NULL`;
  const supplied = Buffer.from(String(secret));
  const account = accounts.find((row) => {
    let expectedSecret;
    try {
      expectedSecret = decryptSecret(row.webhook_verify_token);
    } catch (error) {
      if (!isCredentialDecryptionFailure(error)) throw error;
      return false;
    }
    const expected = Buffer.from(String(expectedSecret || ""));
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  });
  if (!account) return null;
  const [business] = await sql`SELECT * FROM businesses WHERE id = ${account.business_id}`;
  const creds = readableCredsFrom(account);
  return business && creds ? { business, account, creds } : null;
}

// Account row + its default sender number, for one tenant. A business can
// hold more than one account (e.g. Meta + Baileys) — businesses.active_wa_provider
// picks which one is "live"; unset, this keeps the original single-account
// behavior (the first row by id).
export async function getAccountForBusiness(businessId) {
  const sql = await getSql();
  const [business] = await sql`SELECT active_wa_provider FROM businesses WHERE id = ${businessId}`;
  const preferred = business?.active_wa_provider || "";
  const [row] = await sql`
    SELECT a.*,
           (SELECT n.phone_number_id FROM whatsapp_numbers n
             WHERE n.whatsapp_account_id = a.id
             ORDER BY n.is_default DESC, n.id ASC LIMIT 1) AS default_phone_number_id
      FROM whatsapp_accounts a
     WHERE a.business_id = ${businessId}
     ORDER BY (a.provider = ${preferred}) DESC, a.id ASC LIMIT 1`;
  return row || null;
}

// Credentials for a tenant. Only the original deployment workspace may use
// the environment fallback; self-serve tenants must use their own encrypted
// account row.
export async function credsForBusiness(businessId) {
  const account = await getAccountForBusiness(businessId);
  if (account) {
    const creds = readableCredsFrom(account);
    if (creds) return creds;
  }
  if (await isLegacyEnvBusiness(businessId)) {
    return { ...envCreds(), businessId };
  }
  return unconfiguredCreds(businessId);
}

// Credentials for one specific provider on a tenant, regardless of which
// provider is currently active (businesses.active_wa_provider) — e.g. to
// check a Baileys connection from Settings while Meta is still the live
// channel. Returns null when that provider isn't configured at all.
export async function credsForProvider(businessId, provider) {
  const sql = await getSql();
  const [row] = await sql`
    SELECT a.*,
           (SELECT n.phone_number_id FROM whatsapp_numbers n
             WHERE n.whatsapp_account_id = a.id
             ORDER BY n.is_default DESC, n.id ASC LIMIT 1) AS default_phone_number_id
      FROM whatsapp_accounts a
     WHERE a.business_id = ${businessId} AND a.provider = ${provider}
     LIMIT 1`;
  if (row) {
    const creds = readableCredsFrom(row);
    if (creds) return creds;
  }
  if (await isLegacyEnvBusiness(businessId)) {
    const creds = envCredsForProvider(provider);
    return creds ? { ...creds, businessId } : null;
  }
  return null;
}

// Webhook routing: Meta puts the WABA id in entry[].id. Map it back to the
// tenant that owns it. Returns { business, creds } or null when unknown.
export async function resolveTenantByWabaId(wabaId) {
  if (!wabaId) return null;
  const sql = await getSql();
  const [row] = await sql`
    SELECT a.*,
           (SELECT n.phone_number_id FROM whatsapp_numbers n
             WHERE n.whatsapp_account_id = a.id
             ORDER BY n.is_default DESC, n.id ASC LIMIT 1) AS default_phone_number_id
      FROM whatsapp_accounts a
     WHERE a.waba_id = ${String(wabaId)}
     LIMIT 1`;
  if (!row) return null;
  const [business] = await sql`SELECT * FROM businesses WHERE id = ${row.business_id}`;
  if (!business) return null;
  let creds = readableCredsFrom(row);
  if (!creds && (await isLegacyEnvBusiness(row.business_id))) {
    const fallback = envCredsForProvider(row.provider);
    if (fallback) creds = { ...fallback, businessId: row.business_id };
  }
  return creds ? { business, creds, account: row } : null;
}

// Numbers belonging to a tenant (drives the "Send from" pickers without an API
// round-trip; refreshed from Meta by syncNumbers).
export async function listTenantNumbers(businessId) {
  const sql = await getSql();
  return sql`
    SELECT n.* FROM whatsapp_numbers n
      JOIN whatsapp_accounts a ON a.id = n.whatsapp_account_id
     WHERE a.business_id = ${businessId}
     ORDER BY n.is_default DESC, n.id ASC`;
}

// Create/update a tenant's WhatsApp account. Secrets are encrypted here so
// callers never have to think about it.
export async function upsertAccount({
  businessId,
  wabaId,
  accessToken,
  appId,
  appSecret,
  apiVersion = "v21.0",
  webhookVerifyToken,
  provider = "meta",
  onboardingSource = "manual",
  status = "active",
  tokenExpiresAt = null,
  serviceUrl = null,
}) {
  const sql = await getSql();
  const normalizedWabaId = String(wabaId);
  const [claimed] = await sql`
    SELECT business_id FROM whatsapp_accounts WHERE waba_id = ${normalizedWabaId}`;
  if (claimed && Number(claimed.business_id) !== Number(businessId)) {
    throw new Error("This WhatsApp account is already connected to another workspace.");
  }

  const [row] = await sql`
    INSERT INTO whatsapp_accounts
      (business_id, provider, waba_id, access_token, token_expires_at, app_id, app_secret,
       api_version, webhook_verify_token, onboarding_source, status, service_url)
    VALUES (${businessId}, ${provider}, ${normalizedWabaId}, ${encryptSecret(accessToken)},
            ${tokenExpiresAt}, ${appId || null}, ${encryptSecret(appSecret)},
            ${apiVersion}, ${encryptSecret(webhookVerifyToken)}, ${onboardingSource}, ${status},
            ${serviceUrl || null})
    ON CONFLICT (waba_id) DO UPDATE SET
      provider             = EXCLUDED.provider,
      access_token         = COALESCE(EXCLUDED.access_token, whatsapp_accounts.access_token),
      token_expires_at     = COALESCE(EXCLUDED.token_expires_at, whatsapp_accounts.token_expires_at),
      app_id               = COALESCE(EXCLUDED.app_id, whatsapp_accounts.app_id),
      app_secret           = COALESCE(EXCLUDED.app_secret, whatsapp_accounts.app_secret),
      api_version          = EXCLUDED.api_version,
      webhook_verify_token = COALESCE(EXCLUDED.webhook_verify_token, whatsapp_accounts.webhook_verify_token),
      status               = EXCLUDED.status,
      service_url          = COALESCE(EXCLUDED.service_url, whatsapp_accounts.service_url),
      updated_at           = now()
    WHERE whatsapp_accounts.business_id = EXCLUDED.business_id
    RETURNING *`;
  if (!row) {
    throw new Error("This WhatsApp account is already connected to another workspace.");
  }
  return row;
}

// Replace the cached number list for an account (from metaListPhoneNumbers).
export async function syncNumbers(accountId, numbers, { defaultPhoneNumberId } = {}) {
  const sql = await getSql();
  const [targetAccount] = await sql`
    SELECT business_id FROM whatsapp_accounts WHERE id = ${accountId}`;
  if (!targetAccount) throw new Error("WhatsApp account not found.");

  for (const n of numbers) {
    const phoneNumberId = String(n.id);
    const [claimed] = await sql`
      SELECT a.business_id
        FROM whatsapp_numbers wn
        JOIN whatsapp_accounts a ON a.id = wn.whatsapp_account_id
       WHERE wn.phone_number_id = ${phoneNumberId}`;
    if (claimed && Number(claimed.business_id) !== Number(targetAccount.business_id)) {
      throw new Error("This WhatsApp phone number is already connected to another workspace.");
    }

    const [savedNumber] = await sql`
      INSERT INTO whatsapp_numbers
        (whatsapp_account_id, phone_number_id, display_number, verified_name, is_default, quality_rating, status)
      VALUES (${accountId}, ${phoneNumberId}, ${n.number || null}, ${n.name || null},
              ${defaultPhoneNumberId ? String(n.id) === String(defaultPhoneNumberId) : Boolean(n.isDefault)},
              ${n.quality_rating || null}, ${n.status || null})
      ON CONFLICT (phone_number_id) DO UPDATE SET
        whatsapp_account_id = EXCLUDED.whatsapp_account_id,
        display_number = COALESCE(EXCLUDED.display_number, whatsapp_numbers.display_number),
        verified_name  = COALESCE(EXCLUDED.verified_name, whatsapp_numbers.verified_name),
        is_default     = EXCLUDED.is_default,
        quality_rating = COALESCE(EXCLUDED.quality_rating, whatsapp_numbers.quality_rating),
        status         = COALESCE(EXCLUDED.status, whatsapp_numbers.status),
        updated_at     = now()
      WHERE EXISTS (
        SELECT 1 FROM whatsapp_accounts owner
         WHERE owner.id = whatsapp_numbers.whatsapp_account_id
           AND owner.business_id = ${targetAccount.business_id}
      )
      RETURNING id`;
    if (!savedNumber) {
      throw new Error("This WhatsApp phone number is already connected to another workspace.");
    }
  }
  return listAccountNumbers(accountId);
}

export async function listAccountNumbers(accountId) {
  const sql = await getSql();
  return sql`SELECT * FROM whatsapp_numbers WHERE whatsapp_account_id = ${accountId} ORDER BY is_default DESC, id ASC`;
}

// Record whether this app is subscribed to the account's WABA webhooks. Set
// after a successful metaSubscribeApp so the UI can show receiving status and
// stop nagging to re-enable it.
export async function setAppSubscribed(accountId, subscribed = true) {
  const sql = await getSql();
  await sql`
    UPDATE whatsapp_accounts SET app_subscribed = ${Boolean(subscribed)}, updated_at = now()
     WHERE id = ${accountId}`;
}

// One-time migration: lift the env-configured WABA into the database as the
// given tenant's account, so the original deployment becomes "tenant 1".
export async function importEnvAccount(businessId) {
  const env = envCreds();
  if (!env.wabaId || !env.accessToken) {
    throw new Error("META_WABA_ID and META_ACCESS_TOKEN must be set to import the env account.");
  }
  const account = await upsertAccount({
    businessId,
    wabaId: env.wabaId,
    accessToken: env.accessToken,
    appId: env.appId,
    appSecret: env.appSecret,
    apiVersion: env.apiVersion,
    webhookVerifyToken: env.webhookVerifyToken,
    provider: "meta",
    onboardingSource: "env-import",
    status: "active",
  });
  return account;
}

// Move an already-onboarded business's Meta account to a different WABA/token
// (e.g. a new Meta app, or credentials rotated). Deliberately NOT the same as
// upsertAccount: that upserts on waba_id, so pointing it at a brand-new WABA
// id would INSERT a second account row for this business rather than update
// the existing one — leaving two "meta" rows and the old (lower id) one still
// winning ties in getAccountForBusiness. This updates the one existing row in
// place instead, and drops its old number list — those phone_number_ids
// belonged to the previous WABA and won't exist on the new one, so keeping
// them around risks the same "stuck on a stale number" bug fixed earlier.
export async function updateMetaAccount(businessId, { wabaId, accessToken, appId, appSecret, apiVersion }) {
  const sql = await getSql();
  const [account] = await sql`
    SELECT * FROM whatsapp_accounts WHERE business_id = ${businessId} AND provider = 'meta' LIMIT 1`;
  if (!account) throw new Error("No Meta account on file for this business yet — complete onboarding first.");

  const [updated] = await sql`
    UPDATE whatsapp_accounts SET
      waba_id      = ${String(wabaId)},
      access_token = ${encryptSecret(accessToken)},
      app_id       = ${appId || account.app_id},
      app_secret   = ${appSecret ? encryptSecret(appSecret) : account.app_secret},
      api_version  = ${apiVersion || account.api_version},
      updated_at   = now()
    WHERE id = ${account.id}
    RETURNING *`;

  await sql`DELETE FROM whatsapp_numbers WHERE whatsapp_account_id = ${account.id}`;

  return updated;
}
