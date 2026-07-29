import { requireUser } from "@whatsapp/lib/auth";
import { getBusiness } from "@whatsapp/lib/data";
import { metaListPhoneNumbers, metaTemplatesConfigured } from "@whatsapp/lib/wa/provider";
import SettingsForm from "./SettingsForm";
import MetaPhoneVerify from "@whatsapp/components/MetaPhoneVerify";
import CallSettings from "@whatsapp/components/CallSettings";
import { credsForBusiness, credsForProvider } from "@whatsapp/lib/tenant";

export const metadata = { title: "Settings — Tinitiate WA" };

export default async function SettingsPage() {
  const user = await requireUser();
  const creds = await credsForBusiness(user.business_id);
  const business = await getBusiness(user.business_id);
  const provider = creds.provider;

  // Looked up independently of `creds` (which follows active_wa_provider) so
  // both panels are always editable, not just while that channel is active.
  // Baileys is never "active" for sending at all now (read-only monitoring).
  const metaCreds = await credsForProvider(user.business_id, "meta");
  const watiCreds = await credsForProvider(user.business_id, "wati");
  const baileysCreds = await credsForProvider(user.business_id, "baileys");
  const phoneNumbers = metaTemplatesConfigured(metaCreds)
    ? await metaListPhoneNumbers(metaCreds).catch(() => [])
    : [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SettingsForm
        business={business}
        provider={provider}
        metaWabaId={metaCreds?.wabaId || ""}
        hasMetaToken={Boolean(metaCreds?.accessToken)}
        baileysServiceUrl={baileysCreds?.serviceUrl || ""}
        hasBaileysSecret={Boolean(baileysCreds?.accessToken)}
        metaAppId={process.env.META_APP_ID || ""}
        metaConfigId={process.env.META_CONFIGURATION_ID || ""}
        watiApiUrl={watiCreds?.serviceUrl || ""}
        hasWatiToken={Boolean(watiCreds?.accessToken)}
        hasWatiWebhookSecret={Boolean(watiCreds?.webhookVerifyToken)}
      />
      {provider === "meta" && <CallSettings phoneNumbers={phoneNumbers} />}
      {provider === "meta" && <MetaPhoneVerify />}
    </div>
  );
}
