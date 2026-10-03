"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function WatiConnectionCard({
  apiUrl,
  hasAccessToken,
  hasWebhookSecret,
  active,
}) {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [form, setForm] = useState({
    apiUrl: apiUrl || "",
    accessToken: "",
    webhookSecret: "",
    makeActive: !active,
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const setField = (key) => (event) =>
    setForm((current) => ({
      ...current,
      [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
    }));

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setResult(null);
    const res = await fetch("/api/wati/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setResult({ error: data.error || "WATI connection failed" });
      return;
    }
    setForm((current) => ({ ...current, accessToken: "", webhookSecret: "" }));
    setResult({ ok: true, secured: data.webhookSecured });
    router.refresh();
  }

  const connected = hasAccessToken && Boolean(apiUrl);
  const callbackUrl = `${origin || "https://your-domain"}/api/webhooks/wati`;

  async function copyCallback() {
    if (!origin) return;
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setResult({ ok: false, error: "Copy failed. Select the callback URL and copy it manually." });
    }
  }
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">Connect WATI</h2>
          <p className="mt-1 text-xs text-slate-500">
            Import contacts and conversation history, receive replies, and send through your WATI account.
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
          connected ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
        }`}>
          {connected ? "API connected" : "Setup required"}
        </span>
      </div>

      <form onSubmit={save} className="space-y-3">
        <label className="block text-sm">
          <span className="text-slate-500">WATI API endpoint</span>
          <input
            type="url"
            required
            value={form.apiUrl}
            onChange={setField("apiUrl")}
            placeholder="https://live-mt-server.wati.io/your-tenant-id"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-500">Access token{hasAccessToken && " (already set)"}</span>
            <input
              type="password"
              required={!hasAccessToken}
              value={form.accessToken}
              onChange={setField("accessToken")}
              placeholder={hasAccessToken ? "Leave blank to keep it" : "Bearer token from WATI"}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-500">Webhook secret{hasWebhookSecret && " (already set)"}</span>
            <input
              type="password"
              required={!hasWebhookSecret}
              value={form.webhookSecret}
              onChange={setField("webhookSecret")}
              placeholder={hasWebhookSecret ? "Leave blank to keep it" : "Choose a long random secret"}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-slate-700">Live-message webhook</p>
            <span className={`rounded-full px-2 py-0.5 font-medium ${
              hasWebhookSecret ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
            }`}>
              {hasWebhookSecret ? "Secured" : "Setup incomplete"}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <p className="min-w-0 flex-1 break-all font-mono">{callbackUrl}</p>
            <button
              type="button"
              onClick={copyCallback}
              disabled={!origin}
              className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 disabled:opacity-50"
            >
              {copied ? "Copied" : "Copy URL"}
            </button>
          </div>
          <p className="mt-2">
            {hasWebhookSecret || form.webhookSecret
              ? "Append ?token=<your webhook secret> when adding this URL in WATI."
              : "Choose a webhook secret before connecting so callbacks can be authenticated."}
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>In WATI, open Connectors → Webhooks and add the callback URL.</li>
            <li>Append the secret token, enable received-message events, and save.</li>
            <li>Send a test message and confirm WATI receives HTTP 200.</li>
          </ol>
          <p className="mt-2 text-slate-500">
            The Customer CRM also performs a bounded recovery sync every 60 seconds while an operator has it open.
          </p>
        </div>

        {!active && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.makeActive} onChange={setField("makeActive")} />
            Use WATI as the default provider for new conversations
          </label>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={
              saving ||
              !form.apiUrl ||
              (!hasAccessToken && !form.accessToken) ||
              (!hasWebhookSecret && !form.webhookSecret)
            }
            className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Verifying…" : connected ? "Update WATI" : "Connect WATI"}
          </button>
          {result?.ok && <span className="text-sm text-emerald-600">Verified and saved</span>}
          {result?.error && <span className="text-sm text-red-600">{result.error}</span>}
        </div>
      </form>
    </section>
  );
}
