import Link from "next/link";
import { requireUser } from "@whatsapp/lib/auth";
import { getBusiness, respondedContacts, unrespondedContacts } from "@whatsapp/lib/data";
import ResponsesList from "@whatsapp/components/ResponsesList";
import { credsForBusiness } from "@whatsapp/lib/tenant";

export const metadata = { title: "Responses — Tinitiate WA" };

export default async function ResponsesPage({ searchParams }) {
  const user = await requireUser();
  const business = await getBusiness(user.business_id);
  const creds = await credsForBusiness(user.business_id);
  const sp = await searchParams;
  const tab = sp?.tab === "not-responded" ? "not-responded" : "responded";
  const provider = creds.provider;

  const responded = (await respondedContacts(business.id)).map((c) => ({
    ...c,
    lastText: c.last_reply,
    lastAt: c.last_reply_at,
  }));
  const unresponded = (await unrespondedContacts(business.id)).map((c) => ({
    ...c,
    lastText: c.last_outbound,
    lastAt: c.last_outbound_at,
  }));

  const active = tab === "not-responded" ? unresponded : responded;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-sm text-slate-500">← Dashboard</Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold">Responses</h1>
        <p className="text-sm text-slate-500">
          Chat with contacts directly, or send an approved template to re-engage.
        </p>
      </div>

      <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm">
        <Link
          href="/dashboard/responses?tab=responded"
          className={`rounded-md px-3 py-2 text-center font-medium ${
            tab === "responded" ? "bg-white text-[var(--brand-dark)] shadow-sm" : "text-slate-600"
          }`}
        >
          ✅ Responded ({responded.length})
        </Link>
        <Link
          href="/dashboard/responses?tab=not-responded"
          className={`rounded-md px-3 py-2 text-center font-medium ${
            tab === "not-responded" ? "bg-white text-[var(--brand-dark)] shadow-sm" : "text-slate-600"
          }`}
        >
          ⏳ Not responded ({unresponded.length})
        </Link>
      </div>

      <ResponsesList
        contacts={active}
        emptyText={
          tab === "not-responded"
            ? "Everyone you've messaged has replied."
            : "No replies yet."
        }
        provider={provider}
      />
    </div>
  );
}
