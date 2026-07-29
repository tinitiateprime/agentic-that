import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@whatsapp/lib/auth";
import { getBusiness, getContact, listMessages, listTemplates } from "@whatsapp/lib/data";
import { metaListPhoneNumbers } from "@whatsapp/lib/wa/provider";
import Chat from "./Chat";
import { credsForBusiness } from "@whatsapp/lib/tenant";

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: `Chat #${id} — Tinitiate WA` };
}

export default async function ContactChatPage({ params }) {
  const user = await requireUser();
  const creds = await credsForBusiness(user.business_id);
  const { id } = await params;
  const contact = await getContact(user.business_id, id);
  if (!contact) notFound();

  const business = await getBusiness(user.business_id);
  const messages = await listMessages(contact.id);
  const templates = await listTemplates(user.business_id);
  const provider = creds.provider;
  const phoneNumbers =
    provider === "meta" ? await metaListPhoneNumbers(creds).catch(() => []) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-sm text-slate-500">← Back</Link>
      </div>
      <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <p className="font-medium">{contact.name}</p>
        <p className="text-xs text-slate-400">
          {contact.phone}
          {!contact.opted_in && " · ⚠️ not opted in"}
        </p>
      </div>

      <Chat
        contactId={contact.id}
        initialMessages={messages}
        templates={templates}
        currency={business.currency}
        provider={provider}
        phoneNumbers={phoneNumbers}
      />
    </div>
  );
}
