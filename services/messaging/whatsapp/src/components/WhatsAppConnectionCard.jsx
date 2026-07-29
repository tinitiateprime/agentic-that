"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MetaEmbeddedSignupButton from "./MetaEmbeddedSignupButton";

// Lets a business connect/update its Meta WABA — either through Meta's own
// Embedded Signup (preferred: no id/token copy-pasting, verifies itself), or
// by hand for cases without a Configuration set up. Both paths verify
// against Meta before saving and sync the sender-number list to match.
//
// A WhatsApp Web (Baileys) channel option used to live here too; it's been
// dropped from the UI. The backend for it (lib/wa/provider.js's baileys
// adapter, the /api/baileys/* routes, the webhook route, and the DB columns)
// is left in place dormant, not deleted, in case it's wanted again.
export default function WhatsAppConnectionCard({ metaWabaId, hasMetaToken, metaAppId, metaConfigId }) {
  const router = useRouter();
  const [wabaId, setWabaId] = useState(metaWabaId || "");
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  async function saveMeta(e) {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    const res = await fetch("/api/meta/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wabaId, accessToken }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setResult({ error: body.error || "Save failed" });
      return;
    }
    setAccessToken("");
    setResult({ numbers: body.numbers || [] });
    router.refresh();
  }

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">Connect WhatsApp</h2>
          <p className="mt-1 text-xs text-slate-500">
            Add automation while continuing to use your current WhatsApp Business app.
          </p>
        </div>
        {hasMetaToken && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Connected
          </span>
        )}
      </div>

      <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-lg text-white">
            ✓
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Use your existing number</h3>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                Coexistence
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Keep chatting from the WhatsApp Business app while this workspace uses the same
              number through Meta Cloud API.
            </p>
          </div>
        </div>
        <ul className="mb-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
          <li>✓ Keep the Business app</li>
          <li>✓ Keep your existing number</li>
          <li>✓ Connect securely with Meta</li>
        </ul>
        <MetaEmbeddedSignupButton appId={metaAppId} configId={metaConfigId} />
      </div>

      <details className="mt-4 rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-slate-600">
          Advanced: connect with API credentials
        </summary>
        <form onSubmit={saveMeta} className="space-y-3 border-t border-slate-100 p-3">
          <p className="text-xs text-slate-500">
            For numbers already registered directly on Cloud API. This does not enable coexistence.
          </p>
          <label className="block text-sm">
            <span className="text-slate-500">WABA id</span>
            <input
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              placeholder="e.g. 1072968292062699"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-500">
              Access token
              {hasMetaToken && <span className="text-slate-400"> (already set)</span>}
            </span>
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={hasMetaToken ? "Enter a replacement token" : "System User permanent token"}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={saving || !wabaId.trim() || !accessToken.trim()}
            className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Verifying…" : "Save credentials"}
          </button>
          {result?.error && <p className="text-sm text-red-600">{result.error}</p>}
          {result?.numbers && (
            <p className="text-sm text-slate-600">
              Verified — {result.numbers.length} number{result.numbers.length === 1 ? "" : "s"} found:{" "}
              {result.numbers.map((n) => n.display_number || n.phone_number_id).join(", ")}
            </p>
          )}
        </form>
      </details>
    </section>
  );
}
