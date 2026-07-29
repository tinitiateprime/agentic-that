"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MetaEmbeddedSignupButton from "@whatsapp/components/MetaEmbeddedSignupButton";

// Three-step self-serve setup for a new workspace:
//   1. Business profile
//   2. Connect the customer's own WhatsApp Business Account (credentials are
//      validated against Meta before being stored, encrypted, server-side)
//   3. Choose the default sender number, then finish
//
const STEPS = [
  { key: "profile", label: "Business profile" },
  { key: "whatsapp", label: "Connect WhatsApp" },
  { key: "numbers", label: "Sender number" },
];

export default function OnboardingWizard({ initial }) {
  const router = useRouter();
  const [step, setStep] = useState(initial?.connected ? 2 : 0);
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [profile, setProfile] = useState({
    name: initial?.business?.name || "",
    adminNumber: initial?.business?.admin_number || "",
    currency: initial?.business?.currency || "INR",
  });
  const [wa, setWa] = useState({
    wabaId: initial?.account?.waba_id || "",
    accessToken: "",
    appId: initial?.account?.app_id || "",
    appSecret: "",
    apiVersion: initial?.account?.api_version || "v21.0",
  });

  const numbers = state?.numbers || [];
  const [defaultId, setDefaultId] = useState(
    numbers.find((n) => n.is_default)?.phone_number_id || ""
  );

  useEffect(() => {
    const d = (state?.numbers || []).find((n) => n.is_default)?.phone_number_id;
    if (d) setDefaultId(d);
  }, [state?.numbers]);

  async function post(payload) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/whatsapp/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    const data = await post({ step: "profile", ...profile });
    if (data) setStep(1);
  }

  async function connectWhatsApp(e) {
    e.preventDefault();
    const data = await post({ step: "whatsapp", ...wa });
    if (data) {
      setState((s) => ({ ...s, connected: true, numbers: data.numbers || [] }));
      setStep(2);
    }
  }

  function embeddedSignupComplete(data) {
    setState((s) => ({ ...s, connected: true, numbers: data.numbers || [] }));
    setStep(2);
  }

  async function finish() {
    if (defaultId) {
      const picked = await post({ step: "default-number", phoneNumberId: defaultId });
      if (!picked) return;
    }
    const done = await post({ step: "complete" });
    if (done) {
      router.push(done.next || "/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Set up your workspace</h1>
        <p className="text-sm text-slate-500">Three quick steps and you&apos;re live.</p>
      </div>

      {/* Step indicator */}
      <ol className="flex items-center gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold ${
                i < step
                  ? "bg-green-500 text-white"
                  : i === step
                  ? "bg-[var(--brand-dark)] text-white"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={i === step ? "font-medium text-slate-800" : "text-slate-500"}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
          </li>
        ))}
      </ol>

      {!state?.encryptionReady && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Server is missing <span className="font-mono">CREDENTIAL_ENCRYPTION_KEY</span> — WhatsApp
          credentials can&apos;t be stored securely until it&apos;s configured.
        </p>
      )}

      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        {step === 0 && (
          <form onSubmit={saveProfile} className="space-y-3">
            <p className="text-sm font-medium">Tell us about your business</p>
            <input
              value={profile.name}
              onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
              placeholder="Business name"
              required
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={profile.adminNumber}
                onChange={(e) => setProfile((p) => ({ ...p, adminNumber: e.target.value }))}
                placeholder="Admin WhatsApp number (optional)"
                className="rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
              />
              <input
                value={profile.currency}
                onChange={(e) => setProfile((p) => ({ ...p, currency: e.target.value }))}
                placeholder="Currency"
                className="rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[var(--brand-dark)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Continue"}
            </button>
          </form>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">Connect your existing WhatsApp number</p>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  Recommended
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Coexistence lets you use this workspace and the WhatsApp Business app with the
                same number.
              </p>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <ol className="mb-4 grid gap-3 text-xs text-slate-600 sm:grid-cols-3">
                <li><span className="mr-1 font-semibold text-emerald-700">1.</span> Sign in with Facebook</li>
                <li><span className="mr-1 font-semibold text-emerald-700">2.</span> Select your business number</li>
                <li><span className="mr-1 font-semibold text-emerald-700">3.</span> Confirm in WhatsApp</li>
              </ol>
              <MetaEmbeddedSignupButton
                appId={initial?.metaAppId}
                configId={initial?.metaConfigId}
                onSuccess={embeddedSignupComplete}
              />
            </div>

            <details className="rounded-lg border border-slate-200">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-slate-600">
                Advanced: use Cloud API credentials
              </summary>
              <form onSubmit={connectWhatsApp} className="space-y-3 border-t border-slate-100 p-3">
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Use a permanent System User token from <b>Meta App Dashboard → WhatsApp → API
                  Setup</b>. This connects a Cloud API number without coexistence.
                </p>
                <input
                  value={wa.wabaId}
                  onChange={(e) => setWa((w) => ({ ...w, wabaId: e.target.value }))}
                  placeholder="WhatsApp Business Account ID (WABA ID)"
                  required
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
                />
                <input
                  type="password"
                  value={wa.accessToken}
                  onChange={(e) => setWa((w) => ({ ...w, accessToken: e.target.value }))}
                  placeholder="Permanent access token"
                  required
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
                />
                <div className="grid gap-3 sm:grid-cols-3">
                  <input
                    value={wa.appId}
                    onChange={(e) => setWa((w) => ({ ...w, appId: e.target.value }))}
                    placeholder="App ID (optional)"
                    className="rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
                  />
                  <input
                    type="password"
                    value={wa.appSecret}
                    onChange={(e) => setWa((w) => ({ ...w, appSecret: e.target.value }))}
                    placeholder="App secret (optional)"
                    className="rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
                  />
                  <input
                    value={wa.apiVersion}
                    onChange={(e) => setWa((w) => ({ ...w, apiVersion: e.target.value }))}
                    placeholder="API version"
                    className="rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy || !state?.encryptionReady}
                  className="rounded-lg bg-[var(--brand-dark)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Verifying with Meta…" : "Connect with credentials"}
                </button>
              </form>
            </details>

            <button
              type="button"
              onClick={() => setStep(0)}
              className="rounded-lg px-3 py-2.5 text-sm text-slate-600"
            >
              Back
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Choose your default sender number</p>
            {numbers.length === 0 ? (
              <p className="text-sm text-slate-500">No numbers found on this account.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {numbers.map((n) => (
                  <li key={n.phone_number_id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                      <input
                        type="radio"
                        name="defaultNumber"
                        checked={defaultId === n.phone_number_id}
                        onChange={() => setDefaultId(n.phone_number_id)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {n.verified_name || "Business number"}
                        </span>
                        <span className="block text-xs text-slate-400">{n.display_number}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-400">
              Point your Meta webhook at <span className="font-mono">/api/webhooks/meta</span> and
              subscribe to the <span className="font-mono">messages</span> and{" "}
              <span className="font-mono">calls</span> fields to receive replies and call events.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg px-3 py-2.5 text-sm text-slate-600"
              >
                Back
              </button>
              <button
                type="button"
                onClick={finish}
                disabled={busy}
                className="rounded-lg bg-[var(--brand-dark)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Finishing…" : "Finish setup"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
