"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Read-only WhatsApp Web (Baileys) monitoring — NOT a send channel. A number
// linked here keeps working normally in the WhatsApp app; this only reports
// its inbound messages/calls into the dashboard alongside the Meta account.
// The connection service itself refuses to send (READ_ONLY=true) and the
// CRM's own adapter refuses too — this panel just configures/checks it.
export default function WhatsAppMonitoringCard({ serviceUrl: initialServiceUrl, hasSecret }) {
  const router = useRouter();
  const [serviceUrl, setServiceUrl] = useState(initialServiceUrl || "");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState(null);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg("");
    const res = await fetch("/api/baileys/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceUrl, secret: secret || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    setSaveMsg(res.ok ? "Saved" : body.error || "Save failed");
    setSecret("");
    router.refresh();
  }

  async function checkConnection() {
    setChecking(true);
    setStatus(null);
    const res = await fetch("/api/baileys/status");
    const body = await res.json().catch(() => ({}));
    setChecking(false);
    setStatus(res.ok ? body : { error: body.error || "Check failed" });
  }

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-1 font-medium">WhatsApp Web monitoring (read-only)</h2>
      <p className="mb-3 text-xs text-slate-400">
        Shows messages and calls from a number that stays live in the WhatsApp app on a phone —
        it never sends through the dashboard. Reply from the phone; this is visibility only.
      </p>
      <form onSubmit={save} className="space-y-2">
        <label className="block text-sm">
          <span className="text-slate-500">Service URL</span>
          <input
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            placeholder="http://localhost:3100"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-500">
            Shared secret
            {hasSecret && <span className="text-slate-400"> (already set — leave blank to keep it)</span>}
          </span>
          <input
            type="password"
            required={!hasSecret}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={hasSecret ? "••••••••" : "its API_SECRET, if set"}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={checkConnection}
            disabled={checking}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            {checking ? "Checking…" : "Check connection"}
          </button>
          {serviceUrl && (
            <a href={serviceUrl} target="_blank" rel="noreferrer" className="text-sm text-[var(--brand-dark)] underline">
              Open pairing page →
            </a>
          )}
          {saveMsg && <span className="text-sm text-slate-500">{saveMsg}</span>}
        </div>
      </form>
      {status && (
        <p className={`mt-2 text-sm ${status.error ? "text-red-600" : "text-slate-600"}`}>
          {status.error ||
            `Status: ${status.status}${status.me ? ` · linked as ${status.me}` : ""}${
              status.readOnly ? " · read-only ✓" : " · ⚠ not read-only — set READ_ONLY=true on the service"
            }`}
        </p>
      )}
    </section>
  );
}
