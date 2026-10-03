"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Bundles every unread chat into a temporary group and drops you into it, so
// the backlog can be broadcast to — or welcomed — in one action instead of
// opening each thread. The group expires on its own (see lib/data.js).
export default function GroupUnread({ unreadCount, newCount }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (unreadCount === 0) return null;

  async function createGroup() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/groups/temp-from-unread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not group unread chats");
      setBusy(false);
      return;
    }
    router.push(`/groups/${data.id}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div className="min-w-0 text-sm">
        <p className="font-medium">Act on all {unreadCount} unread at once</p>
        <p className="text-xs text-slate-500">
          Groups them into a temporary group (auto-deletes after 24h)
          {newCount > 0 && ` — ${newCount} never messaged before, ready for a welcome template`}.
        </p>
      </div>
      <button
        onClick={createGroup}
        disabled={busy}
        className="ml-auto rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Grouping…" : "🗂 Group unread"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </div>
  );
}
