import Link from "next/link";
import { requireUser } from "@whatsapp/lib/auth";
import {
  getBusiness,
  eagleEye,
  dashboardStats,
  listContactThreads,
  respondedContacts,
  unrespondedContacts,
  unreadContacts,
  readContacts,
  messageStatusSummary,
} from "@whatsapp/lib/data";
import { timeAgo } from "@whatsapp/lib/format";
import { metaTemplatesConfigured, metaListPhoneNumbers } from "@whatsapp/lib/wa/provider";
// WATI CRM is no longer used for this project — kept commented (not deleted)
// in case it's needed again; see components/WatiContactsBox.jsx.
// import WatiContactsBox from "@whatsapp/components/WatiContactsBox";
import QuickSendBox from "@whatsapp/components/QuickSendBox";
import MessageStatCards from "@whatsapp/components/MessageStatCards";
import ResponseLists from "@whatsapp/components/ResponseLists";
import ReadUnreadLists from "@whatsapp/components/ReadUnreadLists";
import AllContactsCRM from "@whatsapp/components/AllContactsCRM";
import AutoRefresh from "@whatsapp/components/AutoRefresh";
import { credsForBusiness } from "@whatsapp/lib/tenant";

export const metadata = { title: "Dashboard — Tinitiate WA" };

const WINDOWS = [
  { key: "0", label: "All", days: 0 },
  { key: "7", label: "This week", days: 7 },
  { key: "15", label: "15 days", days: 15 },
];

export default async function DashboardPage({ searchParams }) {
  const user = await requireUser();
  const creds = await credsForBusiness(user.business_id);
  const business = await getBusiness(user.business_id);
  const sp = await searchParams;
  const windowDays = Number(sp?.window || 0);

  const stats = await dashboardStats(business.id);
  const contacts = await eagleEye(business.id, windowDays);
  const allContacts = await listContactThreads(business.id);
  const responded = await respondedContacts(business.id);
  const unresponded = await unrespondedContacts(business.id);
  const unread = await unreadContacts(business.id);
  const read = await readContacts(business.id);
  const messageStats = await messageStatusSummary(business.id);
  // Sender numbers on the WABA — lets Quick send pick which business number to
  // send from when there's more than one (multi-number WABA).
  const phoneNumbers = metaTemplatesConfigured(creds) ? await metaListPhoneNumbers(creds).catch(() => []) : [];

  return (
    <div className="space-y-5">
      {/* Re-pull dashboard data every 5 minutes without a full reload */}
      <AutoRefresh intervalMs={5 * 60 * 1000} />
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Eagle Eye — every contact at a glance, last activity and message status.
        </p>
      </div>

      {/* Message status summary */}
      <MessageStatCards stats={messageStats} />

      {/* Quick send — type any WhatsApp number and message it directly via
          the active provider (WA_PROVIDER=meta). */}
      <QuickSendBox phoneNumbers={phoneNumbers} />

      {/* WATI contacts box disabled — this project no longer uses the WATI
          CRM. Not deleted, just not rendered:
      <WatiContactsBox />
      */}

      {/* Replies you haven't opened yet vs chats you're caught up on */}
      <ReadUnreadLists unread={unread} read={read} />

      {/* Who's replied vs who's gone quiet */}
      <ResponseLists responded={responded} unresponded={unresponded} />

      {/* Full contact directory (CRM) — searchable, independent of the
          recent-activity window below */}
      <AllContactsCRM contacts={allContacts} />

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Contacts" value={stats.contacts} />
        <Stat label="Msgs (7d)" value={stats.messages7d} />
      </div>

      {/* Recent activity feed */}
      <div>
        <h2 className="mb-2 font-medium">Recent activity</h2>
      </div>

      {/* Window filter */}
      <div className="flex gap-2">
        {WINDOWS.map((w) => {
          const active = String(windowDays) === w.key;
          return (
            <Link
              key={w.key}
              href={w.days ? `/dashboard?window=${w.days}` : "/dashboard"}
              className={`rounded-full px-3 py-1 text-sm ${
                active
                  ? "bg-[var(--brand-dark)] text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200"
              }`}
            >
              {w.label}
            </Link>
          );
        })}
      </div>

      {/* Contact rows */}
      {contacts.length === 0 ? (
        <Empty windowDays={windowDays} />
      ) : (
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/contacts/${c.id}`}
                className="block rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 hover:ring-[var(--brand)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.phone}</p>
                    {c.last_message && (
                      <p className="mt-1 truncate text-sm text-slate-500">{c.last_message}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-400">
                    {timeAgo(c.last_activity_at || c.created_at)}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-200">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Empty({ windowDays }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
      {windowDays
        ? "No contact activity in this window."
        : "No contacts yet. Add one from the Contacts tab."}
    </div>
  );
}
