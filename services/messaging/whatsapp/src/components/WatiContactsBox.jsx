"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// Loads WATI contacts, imports them into the CRM, and pulls their conversation
// history into the same threads used by live webhook messages.
export default function WatiContactsBox() {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, contacts: [], error: "", configured: true });
  const [working, setWorking] = useState(false);
  const [flash, setFlash] = useState("");
  const [syncOffset, setSyncOffset] = useState(0);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const res = await fetch("/api/wati/contacts", { cache: "no-store" });
      const data = await res.json();
      setState({
        loading: false,
        contacts: data.contacts || [],
        error: data.error || "",
        configured: data.configured !== false,
      });
    } catch {
      setState({ loading: false, contacts: [], error: "Network error", configured: true });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function importContacts(phones) {
    setWorking(true);
    setFlash("");
    try {
      const res = await fetch("/api/wati/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(phones ? { phones } : {}),
      });
      const data = await res.json();
      if (res.ok) {
        setFlash(`Imported ${data.imported}, skipped ${data.skipped} (already in CRM).`);
        await load();
        router.refresh(); // refresh the Eagle-Eye list below
      } else {
        setFlash(data.error || "Import failed");
      }
    } catch {
      setFlash("Import failed");
    }
    setWorking(false);
  }

  async function syncMessages() {
    setWorking(true);
    setFlash("");
    try {
      const res = await fetch("/api/wati/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phones: state.contacts.map((contact) => contact.phone),
          offset: syncOffset,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Message sync failed");
      const remaining = data.remaining ? ` ${data.remaining} contacts remain for the next sync.` : "";
      setFlash(
        `Synced ${data.syncedContacts} chats: ${data.importedMessages} new messages, ${data.updatedMessages} statuses updated.${remaining}`
      );
      setSyncOffset(data.nextOffset || 0);
      await load();
      router.refresh();
    } catch (err) {
      setFlash(err.message || "Message sync failed");
    }
    setWorking(false);
  }

  const { loading, contacts, error, configured } = state;
  const newCount = contacts.filter((c) => !c.inCrm).length;

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--brand-dark)] text-xs font-bold text-white">
            W
          </span>
          <h2 className="font-medium">
            Primary contacts <span className="text-slate-400">(WATI)</span>
          </h2>
          {!loading && configured && !error && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {contacts.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!loading && !error && contacts.length > 0 && (
            <button
              onClick={syncMessages}
              disabled={working}
              className="rounded-lg bg-[var(--brand-dark)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {working ? "Syncing…" : syncOffset ? "Sync more messages" : "Sync messages"}
            </button>
          )}
          {!loading && !error && newCount > 0 && (
            <button
              onClick={() => importContacts(null)}
              disabled={working}
              className="rounded-lg border border-[var(--brand)] px-2.5 py-1 text-xs font-medium text-[var(--brand-dark)] disabled:opacity-50"
            >
              {working ? "Importing…" : `Import all new (${newCount})`}
            </button>
          )}
          <button
            onClick={load}
            disabled={loading || working}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {flash && <p className="mb-2 text-xs text-[var(--brand-dark)]">{flash}</p>}

      {/* States */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : error ? (
        <div className={`rounded-lg p-3 text-sm ${configured ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
          {error}
        </div>
      ) : contacts.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
          No contacts returned from WATI.
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="text-xs text-slate-400">{c.phone}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {c.optedIn != null && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      c.optedIn ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {c.optedIn ? "opted in" : "opted out"}
                  </span>
                )}
                {c.inCrm ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                    in CRM
                  </span>
                ) : (
                  <button
                    onClick={() => importContacts([c.phone])}
                    disabled={working}
                    className="rounded-lg border border-[var(--brand)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-dark)] disabled:opacity-50"
                  >
                    + Import
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
