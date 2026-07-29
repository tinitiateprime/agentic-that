"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WhatsAppConnectionCard from "@whatsapp/components/WhatsAppConnectionCard";
import WhatsAppMonitoringCard from "@whatsapp/components/WhatsAppMonitoringCard";
import WatiConnectionCard from "@whatsapp/components/WatiConnectionCard";

// Display labels only — never show the internal provider id (e.g. "baileys")
// on screen.
const PROVIDER_LABELS = {
  meta: "Meta Cloud API",
  baileys: "WhatsApp Web",
  wati: "WATI",
  mock: "Mock (simulated)",
};

export default function SettingsForm({
  business,
  provider,
  metaWabaId,
  hasMetaToken,
  baileysServiceUrl,
  hasBaileysSecret,
  metaAppId,
  metaConfigId,
  watiApiUrl,
  hasWatiToken,
  hasWatiWebhookSecret,
}) {
  const router = useRouter();
  const [biz, setBiz] = useState({
    name: business.name,
    admin_number: business.admin_number || "",
    currency: business.currency,
    active_wa_provider: business.active_wa_provider || provider || "mock",
  });
  const [savedMsg, setSavedMsg] = useState("");
  const setB = (k) => (e) => setBiz((b) => ({ ...b, [k]: e.target.value }));

  async function saveBiz(e) {
    e.preventDefault();
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(biz),
    });
    const body = await res.json().catch(() => ({}));
    setSavedMsg(res.ok ? "Saved" : body.error || "Save failed");
    setTimeout(() => setSavedMsg(""), 1500);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Business profile */}
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 font-medium">Business profile</h2>
        <form onSubmit={saveBiz} className="space-y-3">
          <label className="block text-sm">
            <span className="text-slate-500">Business name</span>
            <input value={biz.name} onChange={setB("name")}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="flex gap-2">
            <label className="block flex-1 text-sm">
              <span className="text-slate-500">Admin WhatsApp number</span>
              <input value={biz.admin_number} onChange={setB("admin_number")} placeholder="+9198…"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="block w-28 text-sm">
              <span className="text-slate-500">Currency</span>
              <input value={biz.currency} onChange={setB("currency")} placeholder="INR"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-500">Default outbound provider</span>
            <select
              value={biz.active_wa_provider}
              onChange={setB("active_wa_provider")}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {hasMetaToken && <option value="meta">Meta Cloud API</option>}
              {hasWatiToken && <option value="wati">WATI</option>}
              <option value="mock">Mock (simulated)</option>
            </select>
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white">
              Save
            </button>
            {savedMsg && (
              <span className={`text-sm ${savedMsg === "Saved" ? "text-green-600" : "text-red-600"}`}>
                {savedMsg}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* Provider status */}
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-1 font-medium">Messaging provider</h2>
        <p className="text-sm text-slate-500">
          Active provider: <span className="font-medium text-slate-700">{PROVIDER_LABELS[provider] || provider}</span>
          {provider === "mock" && " — messages are simulated and stored locally."}
        </p>
        {provider === "wati" && (
          <p className="mt-1 text-xs text-slate-400">
            Point your WATI webhook to{" "}
            <span className="font-mono">/api/webhooks/wati</span> to capture replies
            and 3-button taps.
          </p>
        )}
        {provider === "meta" && (
          <p className="mt-1 text-xs text-slate-400">
            Point your Meta app&apos;s WhatsApp webhook to{" "}
            <span className="font-mono">/api/webhooks/meta</span> (verify token ={" "}
            <span className="font-mono">META_WEBHOOK_VERIFY_TOKEN</span>) to capture
            replies and button taps.
          </p>
        )}
      </section>

      <WhatsAppConnectionCard
        metaWabaId={metaWabaId}
        hasMetaToken={hasMetaToken}
        metaAppId={metaAppId}
        metaConfigId={metaConfigId}
      />
      <WatiConnectionCard
        apiUrl={watiApiUrl}
        hasAccessToken={hasWatiToken}
        hasWebhookSecret={hasWatiWebhookSecret}
        active={provider === "wati"}
      />
      <WhatsAppMonitoringCard serviceUrl={baileysServiceUrl} hasSecret={hasBaileysSecret} />
    </div>
  );
}
