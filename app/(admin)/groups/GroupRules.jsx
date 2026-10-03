"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const EMPTY = { name: "", keywords: "", minOccurrences: 2, windowDays: 7 };

async function request(path, init) {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "That did not work. Try again.");
  return data;
}

function RuleRow({ rule, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (work) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await onChanged();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {rule.name}
            {!rule.enabled && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Paused</span>}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {rule.keywords.join(", ")}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Joins after {rule.min_occurrences} message{rule.min_occurrences !== 1 ? "s" : ""} in {rule.window_days} day
            {rule.window_days !== 1 ? "s" : ""} · {rule.member_count || 0} member{rule.member_count === 1 ? "" : "s"}
            {rule.last_matched_at ? ` · last match ${new Date(rule.last_matched_at).toLocaleDateString()}` : " · no matches yet"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => request(`/api/groups/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) }))}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 disabled:opacity-50"
          >
            {rule.enabled ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Delete the rule “${rule.name}”? The group and its members stay.`)) return;
              return run(() => request(`/api/groups/rules/${rule.id}`, { method: "DELETE" }));
            }}
            className="rounded-lg px-3 py-1.5 text-sm text-red-600 ring-1 ring-red-100 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </li>
  );
}

export default function GroupRules({ rules }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { rule } = await request("/api/groups/rules", { method: "POST", body: JSON.stringify(form) });
      setForm(EMPTY);
      setOpen(false);
      // Creating a rule also checks the messages already in its window.
      setNotice(rule.member_count
        ? `“${rule.name}” added ${rule.member_count} contact${rule.member_count === 1 ? "" : "s"} from recent messages.`
        : `“${rule.name}” is on. The group is created when a contact matches.`);
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-slate-500">Automatic groups</h2>
          <p className="text-xs text-slate-400">
            Contacts join on their own when their incoming messages mention your keywords.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setOpen((value) => !value); setError(""); }}
          className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--brand-dark)]"
        >
          {open ? "Cancel" : "+ New rule"}
        </button>
      </div>

      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      {open && (
        <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-slate-600">Group name</span>
              <input
                value={form.name}
                onChange={update("name")}
                required
                placeholder="e.g. Pricing leads"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-600">Keywords, separated by commas</span>
              <input
                value={form.keywords}
                onChange={update("keywords")}
                required
                placeholder="price, pricing, quote"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-600">Messages needed</span>
              <input
                type="number"
                min={1}
                max={100}
                value={form.minOccurrences}
                onChange={update("minOccurrences")}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-600">Within how many days</span>
              <input
                type="number"
                min={1}
                max={365}
                value={form.windowDays}
                onChange={update("windowDays")}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <p className="text-xs text-slate-400">
            Whole words only, so “price” does not match “priceless”. Only messages customers send you count.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Create rule"}
            </button>
          </div>
        </form>
      )}

      {rules.length === 0 ? (
        !open && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            No automatic groups yet. Add a rule to sort incoming messages into groups for you.
          </p>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} onChanged={async () => router.refresh()} />
          ))}
        </ul>
      )}
    </div>
  );
}
