import { requireUser } from "@whatsapp/lib/auth";
import { getBusiness, listContactThreads, listMessages } from "@whatsapp/lib/data";
import { metaListPhoneNumbers } from "@whatsapp/lib/wa/provider";
import MessageCenter from "@whatsapp/components/MessageCenter";
import { credsForBusiness } from "@whatsapp/lib/tenant";

export const metadata = { title: "Messages — Tinitiate WA" };

export default async function MessagesPage() {
  const user = await requireUser();
  const creds = await credsForBusiness(user.business_id);
  const business = await getBusiness(user.business_id);
  const contacts = await listContactThreads(business.id);
  const initialMessages = Object.fromEntries(
    await Promise.all(contacts.map(async (c) => [c.id, await listMessages(c.id)]))
  );
  const provider = creds.provider;

  // All sender numbers on the WABA (multi-number support) — discovered live so
  // adding a number in Meta Business Manager needs no config change here.
  const phoneNumbers =
    provider === "meta" ? await metaListPhoneNumbers(creds).catch(() => []) : [];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--brand)]">Messages</p>
        <h1 className="text-xl font-semibold">Message</h1>
        <p className="text-sm text-slate-500">Every conversation, live — pick the view that fits.</p>
      </div>

      <MessageCenter
        contacts={contacts}
        initialMessages={initialMessages}
        provider={provider}
        phoneNumbers={phoneNumbers}
      />
    </div>
  );
}
