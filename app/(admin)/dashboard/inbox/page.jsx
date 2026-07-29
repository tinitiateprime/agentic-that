import Link from "next/link";
import { requireUser } from "@whatsapp/lib/auth";
import { getBusiness, unreadContacts, readContacts } from "@whatsapp/lib/data";
import ResponsesList from "@whatsapp/components/ResponsesList";
import GroupUnread from "./GroupUnread";
import { credsForBusiness } from "@whatsapp/lib/tenant";

export const metadata = { title: "Inbox — Tinitiate WA" };

export default async function InboxPage({ searchParams }) {
  const user = await requireUser();
  const business = await getBusiness(user.business_id);
  const creds = await credsForBusiness(user.business_id);
  const sp = await searchParams;
  const tab = sp?.tab === "read" ? "read" : "unread";
  const provider = creds.provider;

  const unread = (await unreadContacts(business.id)).map((c) => ({
    ...c,
    lastText: c.last_reply,
    lastAt: c.last_reply_at,
  }));
  const read = (await readContacts(business.id)).map((c) => ({
    ...c,
    lastText: c.last_reply,
    lastAt: c.last_reply_at,
  }));

  const active = tab === "read" ? read : unread;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-sm text-slate-500">← Dashboard</Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold">Inbox</h1>
        <p className="text-sm text-slate-500">
          Replies you haven&apos;t opened yet vs chats you&apos;re caught up on. Opening a chat marks it read.
        </p>
      </div>

      <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm">
        <Link
          href="/dashboard/inbox?tab=unread"
          className={`rounded-md px-3 py-2 text-center font-medium ${
            tab === "unread" ? "bg-white text-[var(--brand-dark)] shadow-sm" : "text-slate-600"
          }`}
        >
          📩 Unread ({unread.length})
        </Link>
        <Link
          href="/dashboard/inbox?tab=read"
          className={`rounded-md px-3 py-2 text-center font-medium ${
            tab === "read" ? "bg-white text-[var(--brand-dark)] shadow-sm" : "text-slate-600"
          }`}
        >
          📖 Read ({read.length})
        </Link>
      </div>

      {tab === "unread" && (
        <GroupUnread
          unreadCount={unread.length}
          newCount={unread.filter((c) => c.is_new).length}
        />
      )}

      <ResponsesList
        contacts={active}
        emptyText={tab === "read" ? "Nothing read yet." : "No unread replies — inbox zero."}
        provider={provider}
      />
    </div>
  );
}
