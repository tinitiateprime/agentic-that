"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SenderSelect from "@/components/SenderSelect";

export default function GroupDetail({ group, members, available, templates, phoneNumbers = [] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null); // { type, text }
  const [results, setResults] = useState(null); // per-recipient send results

  // ── Broadcast ────────────────────────────────────────────────────────────
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [mode, setMode] = useState("session"); // "session" | "template" | "bot"
  const [fromPhoneId, setFromPhoneId] = useState(""); // "" = default business number
  const [bcastBody, setBcastBody] = useState("");
  const [bcastTpl, setBcastTpl] = useState(""); // CRM template id
  const [watiTemplate, setWatiTemplate] = useState(""); // approved WATI template name
  const [botBody, setBotBody] = useState("Hi {{name}}, how can we help you today?");
  const [botButtons, setBotButtons] = useState(["Sales", "Support", "Catalog"]);
  const [wati, setWati] = useState({ loading: false, configured: true, approved: [], all: [] });

  // Load approved-template list when the broadcast panel opens — live wiring
  // is Meta Cloud API. Kept for reference / rollback (inactive while
  // WA_PROVIDER=meta):
  // fetch("/api/wati/templates").then((r) => r.json()),
  // fetch("/api/wati/templates?all=1").then((r) => r.json()),
  useEffect(() => {
    if (!showBroadcast) return;
    setWati((w) => ({ ...w, loading: true }));
    Promise.all([
      fetch("/api/meta/templates").then((r) => r.json()),
      fetch("/api/meta/templates?all=1").then((r) => r.json()),
    ])
      .then(([approvedRes, allRes]) => {
        setWati({
          loading: false,
          configured: approvedRes.configured !== false,
          approved: approvedRes.templates || [],
          all: allRes.templates || [],
        });
      })
      .catch(() => setWati((w) => ({ ...w, loading: false })));
  }, [showBroadcast]);

  async function broadcast(e) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    setResults(null);

    let payload;
    if (mode === "template") {
      if (!watiTemplate) {
        setBusy(false);
        return setFlash({ type: "err", text: "Pick an approved WhatsApp template." });
      }
      payload = {
        watiTemplate,
        templateParams: buildTemplateParams(wati.approved.find((t) => t.name === watiTemplate)),
        // Meta requires the exact template language on send; WATI ignores it.
        language: selectedWatiTemplate?.language,
      };
    } else if (mode === "bot") {
      const buttons = botButtons.map((b) => b.trim()).filter(Boolean);
      if (!botBody.trim() || buttons.length === 0) {
        setBusy(false);
        return setFlash({ type: "err", text: "Bot messages need text and at least one button." });
      }
      payload = { body: botBody, buttons };
    } else {
      payload = bcastTpl ? { templateId: Number(bcastTpl) } : { body: bcastBody };
    }

    const res = await fetch(`/api/groups/${group.id}/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, phoneNumberId: fromPhoneId || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const failed = data.total - data.sent;
      setFlash({
        type: failed ? "warn" : "ok",
        text: `Delivered ${data.sent}/${data.total}.${failed ? ` ${failed} failed — see below.` : ""}`,
      });
      setResults(data.results || []);
      setBcastBody("");
      setBcastTpl("");
      setWatiTemplate("");
      setShowBroadcast(false);
      router.refresh();
    } else {
      setFlash({ type: "err", text: data.error || "Broadcast failed" });
    }
    setBusy(false);
  }

  // ── Add / remove members ───────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState([]);
  function toggleSelect(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  async function addMembers(e) {
    e.preventDefault();
    if (!selected.length) return;
    setBusy(true);
    const res = await fetch(`/api/groups/${group.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: selected }),
    });
    if (res.ok) {
      setSelected([]);
      setShowAdd(false);
      router.refresh();
    }
    setBusy(false);
  }
  async function removeMember(contactId) {
    if (!confirm("Remove from group?")) return;
    await fetch(`/api/groups/${group.id}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId }),
    });
    router.refresh();
  }
  async function deleteGroup() {
    if (!confirm(`Delete group "${group.name}"? Members are not deleted.`)) return;
    await fetch(`/api/groups/${group.id}`, { method: "DELETE" });
    router.push("/groups");
  }

  const pendingOrRejected = wati.all.filter(
    (t) => String(t.status).toUpperCase() !== "APPROVED"
  );
  const selectedWatiTemplate = wati.approved.find((t) => t.name === watiTemplate);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div>
          <h1 className="text-lg font-semibold">{group.name}</h1>
          <p className="text-sm text-slate-500">
            {members.length} member{members.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowBroadcast((v) => !v); setFlash(null); setResults(null); }}
            className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white"
          >
            📢 Broadcast DM
          </button>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Flash */}
      {flash && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            flash.type === "ok"
              ? "bg-green-50 text-green-700"
              : flash.type === "warn"
              ? "bg-amber-50 text-amber-800"
              : "bg-red-50 text-red-700"
          }`}
        >
          {flash.text}
        </p>
      )}

      {/* Per-recipient results */}
      {results && (
        <ul className="overflow-hidden rounded-xl bg-white text-sm shadow-sm ring-1 ring-slate-200">
          {results.map((r) => (
            <li key={r.contactId} className="flex items-center justify-between gap-3 border-b border-slate-50 px-4 py-2 last:border-0">
              <span className="truncate">{r.name}</span>
              {r.status === "failed" ? (
                <span className="shrink-0 text-xs text-red-500" title={r.error || ""}>
                  ✗ {r.error || "failed"}
                </span>
              ) : (
                <span className="shrink-0 text-xs text-green-600">✓ {r.status}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Broadcast composer */}
      {showBroadcast && (
        <form onSubmit={broadcast} className="space-y-3 rounded-xl border border-[var(--brand)] bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-[var(--brand-dark)]">
            Broadcast — sends an individual DM to each member
          </p>

          {/* Mode tabs */}
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setMode("session")}
              className={`rounded-full px-3 py-1 ${mode === "session" ? "bg-[var(--brand-dark)] text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Quick message
            </button>
            <button
              type="button"
              onClick={() => setMode("template")}
              className={`rounded-full px-3 py-1 ${mode === "template" ? "bg-[var(--brand-dark)] text-white" : "bg-slate-100 text-slate-600"}`}
            >
              WhatsApp template
            </button>
            <button
              type="button"
              onClick={() => setMode("bot")}
              className={`rounded-full px-3 py-1 ${mode === "bot" ? "bg-[var(--brand-dark)] text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Chat bot
            </button>
          </div>

          {mode === "session" ? (
            <>
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠️ Quick (free-text) messages only deliver to contacts who messaged you in the
                last <b>24 hours</b>. To reach everyone, use an approved WhatsApp template.
              </div>
              {templates.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Use a CRM template (optional)</label>
                  <select
                    value={bcastTpl}
                    onChange={(e) => { setBcastTpl(e.target.value); if (e.target.value) setBcastBody(""); }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">— type a custom message instead —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>⚡ {t.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {!bcastTpl && (
                <textarea
                  value={bcastBody}
                  onChange={(e) => setBcastBody(e.target.value)}
                  rows={3}
                  placeholder="Type your message…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              )}
            </>
          ) : mode === "template" ? (
            <>
              <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
                ✅ Approved templates deliver to <b>any</b> contact (even cold ones). The first
                placeholder <code>{"{{1}}"}</code> is filled with each contact's name.
              </div>
              {wati.loading ? (
                <p className="text-sm text-slate-400">Loading templates…</p>
              ) : !wati.configured ? (
                <p className="text-sm text-amber-700">Meta isn&apos;t configured.</p>
              ) : wati.approved.length === 0 ? (
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  No <b>approved</b> WhatsApp templates on your Meta WABA yet.
                  {pendingOrRejected.length > 0 && (
                    <ul className="mt-1 list-disc pl-4">
                      {pendingOrRejected.map((t) => (
                        <li key={t.name}>
                          <span className="font-mono">{t.name}</span> — {t.status}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1">
                    Create &amp; get a template approved in Meta&apos;s WhatsApp Manager, then it appears here.
                  </p>
                </div>
              ) : (
                <select
                  value={watiTemplate}
                  onChange={(e) => setWatiTemplate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">— select an approved template —</option>
                  {wati.approved.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} ({t.language})
                    </option>
                  ))}
                </select>
              )}
              {selectedWatiTemplate?.body && (
                <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
                  {selectedWatiTemplate.body}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Interactive buttons are sent via the Meta WhatsApp Cloud API.
              </div>
              <textarea
                value={botBody}
                onChange={(e) => setBotBody(e.target.value)}
                rows={3}
                placeholder="Message text, supports {{name}} and {{business}}"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="grid gap-2 sm:grid-cols-3">
                {botButtons.map((button, index) => (
                  <input
                    key={index}
                    value={button}
                    onChange={(e) =>
                      setBotButtons((items) =>
                        items.map((item, i) => (i === index ? e.target.value : item))
                      )
                    }
                    maxLength={20}
                    placeholder={`Button ${index + 1}`}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                ))}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <SenderSelect phoneNumbers={phoneNumbers} value={fromPhoneId} onChange={setFromPhoneId} />
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setShowBroadcast(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600">
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  busy ||
                  (mode === "session" && !bcastTpl && !bcastBody.trim()) ||
                  (mode === "template" && !watiTemplate) ||
                  (mode === "bot" && (!botBody.trim() || botButtons.every((b) => !b.trim())))
                }
                className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? "Sending…" : `Send to ${members.length} member${members.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Add members panel */}
      {showAdd && (
        <form onSubmit={addMembers} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium">Add members</p>
          {available.length === 0 ? (
            <p className="text-sm text-slate-400">All contacts are already in this group.</p>
          ) : (
            <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
              {available.map((c) => (
                <li
                  key={c.id}
                  onClick={() => toggleSelect(c.id)}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${
                    selected.includes(c.id) ? "bg-[var(--bubble-out)]" : "hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border text-xs ${
                      selected.includes(c.id) ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-slate-300"
                    }`}
                  >
                    {selected.includes(c.id) && "✓"}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.phone}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowAdd(false); setSelected([]); }} className="rounded-lg px-3 py-2 text-sm text-slate-600">
              Cancel
            </button>
            <button type="submit" disabled={busy || !selected.length} className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Adding…" : `Add ${selected.length || ""} selected`}
            </button>
          </div>
        </form>
      )}

      {/* Member list */}
      {members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No members yet. Add contacts to this group.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{m.name}</p>
                <p className="text-xs text-slate-400">{m.phone}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link href={`/contacts/${m.id}`} className="text-xs text-[var(--brand-dark)]">DM →</Link>
                <button onClick={() => removeMember(m.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-slate-200 pt-4">
        <button onClick={deleteGroup} className="text-xs text-red-400 hover:text-red-600">
          Delete this group
        </button>
      </div>
    </div>
  );
}

function buildTemplateParams(template) {
  const names =
    template?.placeholderNames?.length
      ? template.placeholderNames
      : Array.from({ length: template?.placeholders || 0 }, (_, i) => String(i + 1));

  return names.map((name) => ({ name, value: "{{name}}" }));
}
