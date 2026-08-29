"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// Settings card: pick the approved WhatsApp template that gets sent
// automatically the first time a brand-new contact messages the business.
// Only approved templates are listed — a greeting is business-initiated, so
// free text isn't an option (see maybeSendWelcome in lib/wa/messaging.js).
export default function WelcomeTemplateCard({ business, provider }) {
  const [state, setState] = useState({ loading: true, configured: true, approved: [], error: "" });
  const [enabled, setEnabled] = useState(Boolean(business.welcome_enabled));
  const [templateName, setTemplateName] = useState(business.welcome_template_name || "");
  const [params, setParams] = useState(() => parseParams(business.welcome_template_params));
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const router = useRouter();

  const isMeta = provider === "meta";
  const selected = state.approved.find((t) => t.name === templateName);

  useEffect(() => {
    const url = isMeta ? "/api/meta/templates" : "/api/wati/templates";
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) =>
        setState({
          loading: false,
          configured: data.configured !== false,
          approved: data.templates || [],
          error: data.error || "",
        })
      )
      .catch(() => setState((s) => ({ ...s, loading: false, error: "Couldn't load templates" })));
  }, [isMeta]);

  // Placeholder labels for the selected template ({{1}}, {{2}}… or Meta's
  // named ones), so the value inputs line up with what the customer will see.
  const placeholderNames = useMemo(() => {
    if (!selected) return [];
    return selected.placeholderNames?.length
      ? selected.placeholderNames
      : Array.from({ length: selected.placeholders || 0 }, (_, i) => String(i + 1));
  }, [selected]);

  function pickTemplate(nextName) {
    setTemplateName(nextName);
    // Values are positional, so they don't survive a template switch — start
    // the new one with {{name}} in the first slot, which is the usual greeting.
    const next = state.approved.find((t) => t.name === nextName);
    const count = next?.placeholderNames?.length || next?.placeholders || 0;
    setParams(Array.from({ length: count }, (_, i) => (i === 0 ? "{{name}}" : "")));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        welcome_enabled: enabled,
        welcome_template_name: templateName,
        welcome_template_language: selected?.language || business.welcome_template_language || "",
        welcome_template_params: params.slice(0, placeholderNames.length),
        // Cached so the chat thread can show what was actually sent.
        welcome_template_body: selected?.body || "",
      }),
    });
    setSaving(false);
    setSavedMsg("Saved");
    setTimeout(() => setSavedMsg(""), 1500);
    router.refresh();
  }

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-1 font-medium">Welcome message</h2>
      <p className="mb-3 text-sm text-slate-500">
        Sent automatically the first time someone new messages your WhatsApp number.
        Existing conversations are never greeted.
      </p>

      {state.loading ? (
        <p className="text-sm text-slate-400">Loading templates…</p>
      ) : !state.configured ? (
        <p className="text-sm text-amber-700">
          Connect a WhatsApp Business Account first — approved templates come from your provider.
        </p>
      ) : state.approved.length === 0 ? (
        <p className="text-sm text-slate-500">
          No approved templates yet. Create one under Dashboard → Templates and wait for
          approval, then pick it here.
        </p>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Send a welcome message to new contacts</span>
          </label>

          <label className="block text-sm">
            <span className="text-slate-500">Approved template</span>
            <select
              value={templateName}
              onChange={(e) => pickTemplate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select an approved template</option>
              {state.approved.map((t) => (
                <option key={`${t.name}-${t.language}`} value={t.name}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
          </label>

          {selected?.body && (
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
              {selected.body}
            </p>
          )}

          {placeholderNames.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">
                Values for the template placeholders. Use{" "}
                <span className="font-mono">{"{{name}}"}</span> for the contact&apos;s name and{" "}
                <span className="font-mono">{"{{business}}"}</span> for your business name.
              </p>
              {placeholderNames.map((label, i) => (
                <label key={label + i} className="block text-sm">
                  <span className="text-slate-500">{`{{${label}}}`}</span>
                  <input
                    value={params[i] ?? ""}
                    onChange={(e) =>
                      setParams((p) => {
                        const next = [...p];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              ))}
            </div>
          )}

          {enabled && !templateName && (
            <p className="text-sm text-amber-700">Pick a template — the welcome stays off without one.</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {savedMsg && <span className="text-sm text-green-600">{savedMsg}</span>}
          </div>
        </form>
      )}

      {state.error && !state.loading && <p className="mt-2 text-xs text-amber-700">{state.error}</p>}
    </section>
  );
}

function parseParams(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v ?? "")) : [];
  } catch {
    return [];
  }
}
