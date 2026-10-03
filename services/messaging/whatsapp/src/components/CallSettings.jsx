"use client";

import { useEffect, useState } from "react";
import { phoneShortLabel } from "@whatsapp/components/SenderSelect";

// Manage the WhatsApp Business Calling API settings per business number.
// Enabling calling shows the in-chat call button to customers and starts
// delivering `calls` webhook events (which feed the call log + missed alerts).
// Meta requires a messaging limit of 2000+ before calling can be enabled.

const STATUS_STYLES = {
  ENABLED: "bg-green-50 text-green-700",
  DISABLED: "bg-slate-100 text-slate-600",
  NOT_SET: "bg-amber-50 text-amber-800",
};

export default function CallSettings({ phoneNumbers = [] }) {
  const [selected, setSelected] = useState(phoneNumbers[0]?.id || "");
  const [calling, setCalling] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  async function load(id) {
    if (!id) return;
    setLoading(true);
    setError("");
    setFlash("");
    try {
      const res = await fetch(`/api/meta/phone/call-settings?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load call settings");
      setCalling(data.calling || {});
    } catch (err) {
      setError(err.message);
      setCalling(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    load(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function update(patch) {
    setBusy(true);
    setError("");
    setFlash("");
    try {
      const res = await fetch("/api/meta/phone/call-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId: selected, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Update failed");
      setCalling(data.calling || {});
      setFlash("Call settings updated.");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  if (!phoneNumbers.length) return null;

  const status = calling?.status || "NOT_SET";
  const enabled = status === "ENABLED";

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--brand-dark)] text-sm text-white">
          📞
        </span>
        <h2 className="font-medium">WhatsApp calling</h2>
      </div>

      <label className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className="font-medium">Number</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
        >
          {phoneNumbers.map((n) => (
            <option key={n.id} value={n.id}>
              {phoneShortLabel(n)}
            </option>
          ))}
        </select>
      </label>

      {loading ? (
        <p className="text-sm text-slate-400">Loading call settings…</p>
      ) : calling ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Calling</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] || STATUS_STYLES.NOT_SET}`}>
              {status}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => update({ status: enabled ? "DISABLED" : "ENABLED" })}
              className={`ml-auto rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                enabled ? "bg-red-500" : "bg-[var(--brand-dark)]"
              }`}
            >
              {busy ? "Saving…" : enabled ? "Disable calling" : "Enable calling"}
            </button>
          </div>

          {/* These only matter once calling is on. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">Call button in chat</span>
              <select
                value={calling.call_icon_visibility || "NOT_SET"}
                disabled={busy || !enabled}
                onChange={(e) => update({ callIconVisibility: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none disabled:opacity-50"
              >
                <option value="NOT_SET" disabled>
                  Not set
                </option>
                <option value="DEFAULT">Show call button</option>
                <option value="DISABLE_ALL">Hide call button</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">Callback requests</span>
              <select
                value={calling.callback_permission_status || "NOT_SET"}
                disabled={busy || !enabled}
                onChange={(e) => update({ callbackPermissionStatus: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none disabled:opacity-50"
              >
                <option value="NOT_SET" disabled>
                  Not set
                </option>
                <option value="ENABLED">Allow callback requests</option>
                <option value="DISABLED">No callback requests</option>
              </select>
            </label>
          </div>

          <p className="text-xs text-slate-400">
            Hiding the call button doesn&apos;t stop customers calling you — it only removes the
            shortcut. Callback requests let them ask for a call back when you don&apos;t pick up.
            Meta requires a messaging limit of 2000+ to enable calling.
          </p>
        </div>
      ) : null}

      {flash && <p className="mt-2 text-sm text-green-600">{flash}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
