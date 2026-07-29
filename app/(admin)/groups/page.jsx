import Link from "next/link";
import { requireUser } from "@whatsapp/lib/auth";
import { listGroups, listTempGroups } from "@whatsapp/lib/data";
import { timeUntil } from "@whatsapp/lib/format";
import CreateGroup from "./CreateGroup";

export const metadata = { title: "Groups — Tinitiate WA" };

export default async function GroupsPage() {
  const user = await requireUser();
  const groups = await listGroups(user.business_id);
  // Throwaway groups built from the inbox — kept in their own section so they
  // don't get mistaken for standing groups. They expire on their own.
  const tempGroups = await listTempGroups(user.business_id);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Groups</h1>
          <p className="text-sm text-slate-500">
            Broadcast individual DMs to everyone in a group at once.
          </p>
        </div>
        <CreateGroup />
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No groups yet. Create one to start broadcasting.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/groups/${g.id}`}
                className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-[var(--brand)]"
              >
                <div>
                  <p className="font-medium">{g.name}</p>
                  <p className="text-xs text-slate-400">
                    {g.member_count} member{g.member_count !== 1 ? "s" : ""}
                  </p>
                </div>
                <span className="text-slate-400">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {tempGroups.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-slate-500">Temporary</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {tempGroups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/groups/${g.id}`}
                  className="flex items-center justify-between rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4 hover:border-amber-400"
                >
                  <div>
                    <p className="font-medium">{g.name}</p>
                    <p className="text-xs text-slate-400">
                      {g.member_count} member{g.member_count !== 1 ? "s" : ""} · deletes{" "}
                      {timeUntil(g.expires_at)}
                    </p>
                  </div>
                  <span className="text-slate-400">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
