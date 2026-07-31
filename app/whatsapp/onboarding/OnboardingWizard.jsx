"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MetaEmbeddedSignupButton from "@whatsapp/components/MetaEmbeddedSignupButton";

// Three-step self-serve setup for a new workspace:
//   1. Business profile
//   2. Choose Meta/Cloud API or WATI. Provider credentials are verified live,
//      then encrypted before they are stored server-side.
//   3. Choose the Meta sender number, or confirm the WATI webhook, then finish.
//
const STEPS = [
  { key: "profile", label: "Business profile" },
  { key: "whatsapp", label: "Connect WhatsApp" },
  { key: "numbers", label: "Sender number" },
];

function createWebhookSecret() {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function OnboardingWizard({ initial }) {
  const router = useRouter();
  const [step, setStep] = useState(initial?.connected ? 2 : 0);
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");
  const [connectionType, setConnectionType] = useState(
    initial?.account?.provider === "wati" ? "wati" : "meta"
  );

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
  const [wati, setWati] = useState({
    apiUrl: initial?.account?.service_url || "",
    accessToken: "",
    webhookSecret: "",
  });

  const numbers = state?.numbers || [];
  const activeProvider = state?.provider || state?.account?.provider || connectionType;
  const usingWati = activeProvider === "wati";
  const steps = STEPS.map((item) =>
    item.key === "numbers" && usingWati ? { ...item, label: "Finish setup" } : item
  );
  const webhookUrl = `${origin || "https://your-domain"}/api/webhooks/wati${
    wati.webhookSecret ? `?token=${encodeURIComponent(wati.webhookSecret)}` : "?token=<your-webhook-secret>"
  }`;
  const [defaultId, setDefaultId] = useState(
    numbers.find((n) => n.is_default)?.phone_number_id || ""
  );

  useEffect(() => setOrigin(window.location.origin), []);

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
      setState((s) => ({
        ...s,
        connected: true,
        provider: "meta",
        numbers: data.numbers || [],
      }));
      setStep(2);
    }
  }

  function embeddedSignupComplete(data) {
    setState((s) => ({
      ...s,
      connected: true,
      provider: "meta",
      numbers: data.numbers || [],
    }));
    setStep(2);
  }

  function chooseConnection(type) {
    setConnectionType(type);
    setState((current) => ({ ...current, provider: type }));
    setError("");
    if (type === "wati" && !wati.webhookSecret) {
      setWati((current) => ({ ...current, webhookSecret: createWebhookSecret() }));
    }
  }

  async function connectWati(e) {
    e.preventDefault();
    const data = await post({ step: "wati", ...wati });
    if (data) {
      setState((current) => ({
        ...current,
        connected: true,
        provider: "wati",
        numbers: [],
      }));
      setWati((current) => ({ ...current, apiUrl: data.apiUrl || current.apiUrl }));
      setStep(2);
    }
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
        {steps.map((s, i) => (
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
            {i < steps.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
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
              <p className="text-base font-semibold text-slate-900">Choose your WhatsApp connection</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Connect directly through Meta or use an existing WATI account. You can add the
                other connection later from Settings.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={connectionType === "meta"}
                onClick={() => chooseConnection("meta")}
                className={`flex min-h-28 items-start gap-3 rounded-xl border p-3.5 text-left transition ${
                  connectionType === "meta"
                    ? "border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-100"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                  <img src="/whatsapp-logo.svg" alt="" className="h-8 w-8" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">Meta / Cloud API</span>
                  <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                    Recommended
                  </span>
                  <span className="mt-1 block text-xs leading-4 text-slate-500">
                    Connect with Facebook or enter Cloud API credentials.
                  </span>
                </span>
              </button>

              <button
                type="button"
                aria-pressed={connectionType === "wati"}
                onClick={() => chooseConnection("wati")}
                className={`flex min-h-28 items-start gap-3 rounded-xl border p-3.5 text-left transition ${
                  connectionType === "wati"
                    ? "border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-100"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                  <img src="/wati-logo.svg" alt="" className="h-8 w-8" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">WATI</span>
                  <span className="mt-1 block text-xs leading-4 text-slate-500">
                    Use your WATI endpoint and access token.
                  </span>
                </span>
              </button>
            </div>

            {connectionType === "meta" && (
              <>
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
              </>
            )}

            {connectionType === "wati" && (
              <form onSubmit={connectWati} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Connect your WATI workspace</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Find the endpoint and bearer token under API Docs in your WATI account.
                    AgenticThat verifies them before saving anything.
                  </p>
                </div>

                <label className="block text-sm">
                  <span className="font-medium text-slate-700">WATI API endpoint</span>
                  <input
                    type="url"
                    value={wati.apiUrl}
                    onChange={(e) => setWati((current) => ({ ...current, apiUrl: e.target.value }))}
                    placeholder="https://live-mt-server.wati.io/your-tenant-id"
                    required
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
                  />
                </label>

                <label className="block text-sm">
                  <span className="font-medium text-slate-700">WATI access token</span>
                  <input
                    type="password"
                    value={wati.accessToken}
                    onChange={(e) => setWati((current) => ({ ...current, accessToken: e.target.value }))}
                    placeholder="Bearer token from WATI"
                    required
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
                  />
                </label>

                <label className="block text-sm">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-700">Webhook security key</span>
                    <button
                      type="button"
                      onClick={() => setWati((current) => ({ ...current, webhookSecret: createWebhookSecret() }))}
                      className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                    >
                      Generate a new key
                    </button>
                  </span>
                  <input
                    type="text"
                    value={wati.webhookSecret}
                    onChange={(e) => setWati((current) => ({ ...current, webhookSecret: e.target.value }))}
                    minLength={24}
                    required
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-xs outline-none focus:border-[var(--brand)]"
                  />
                </label>

                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">Webhook callback for WATI</p>
                  <p className="mt-1 break-all font-mono leading-5">{webhookUrl}</p>
                  <p className="mt-1 text-slate-500">
                    Copy this complete URL into WATI after the connection is verified.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={
                    busy ||
                    !state?.encryptionReady ||
                    !wati.apiUrl ||
                    !wati.accessToken ||
                    wati.webhookSecret.length < 24
                  }
                  className="inline-flex items-center justify-center rounded-lg bg-[var(--brand-dark)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Verifying with WATI…" : "Verify and connect WATI"}
                </button>
              </form>
            )}

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
            {usingWati ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-emerald-100">
                    <img src="/wati-logo.svg" alt="" className="h-8 w-8" />
                  </span>
                  <span>
                    <strong className="block text-sm text-slate-900">WATI is verified and connected</strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">
                      AgenticThat will use this WATI workspace for customer conversations,
                      templates, contacts, and delivery.
                    </span>
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">Add your WATI webhook</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Paste this complete callback URL into WATI to receive replies and delivery events.
                  </p>
                  <p className="mt-3 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">
                    {webhookUrl}
                  </p>
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
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
