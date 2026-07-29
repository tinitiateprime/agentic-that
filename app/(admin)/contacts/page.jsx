import { requireUser } from "@whatsapp/lib/auth";
import { listContactThreads, listCalls, callStatusSummary } from "@whatsapp/lib/data";
import { metaListPhoneNumbers, metaTemplatesConfigured, watiConfigured } from "@whatsapp/lib/wa/provider";
import NotificationCenter from "./NotificationCenter";
import { credsForBusiness, credsForProvider } from "@whatsapp/lib/tenant";

export const metadata = { title: "Customer CRM — Tinitiate WA" };

export default async function ContactsPage() {
  const user = await requireUser();
  const creds = await credsForBusiness(user.business_id);
  const metaCreds = await credsForProvider(user.business_id, "meta");
  const watiCreds = await credsForProvider(user.business_id, "wati");
  const contacts = await listContactThreads(user.business_id);
  const provider = creds.provider;
  // Sender numbers on the WABA — lets a new quick-chat pick which business
  // number to send from when there's more than one.
  const phoneNumbers = metaTemplatesConfigured(metaCreds)
    ? await metaListPhoneNumbers(metaCreds).catch(() => [])
    : [];
  // WhatsApp call log + missed-call counters for the Calls tab.
  const calls = await listCalls(user.business_id);
  const callSummary = await callStatusSummary(user.business_id);

  return (
    <NotificationCenter
      contacts={contacts}
      provider={provider}
      phoneNumbers={phoneNumbers}
      calls={calls}
      callSummary={callSummary}
      connections={{
        meta: metaTemplatesConfigured(metaCreds),
        wati: watiConfigured(watiCreds),
      }}
    />
  );
}
