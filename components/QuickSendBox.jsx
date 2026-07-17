"use client";

import { useState } from "react";
import Link from "next/link";
import SenderSelect from "@/components/SenderSelect";

// Accessory: type any WhatsApp number + message and send immediately, without
// first adding the number as a contact. Known contacts get the typed text;
// a number not yet in contacts gets an approved template to open the chat,
// and the typed text stays in the box to send after the customer replies.
export default function QuickSendBox({ phoneNumbers = [] }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [fromPhoneId, setFromPhoneId] = useState(""); // "" = default business number
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, error, contactId, usedTemplate }

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/messages/quick-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name, body, phoneNumberId: fromPhoneId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult({
          ok: true,
          contactId: data.contact?.id,
          usedTemplate: data.usedTemplate || null,
          sendError: data.message?.error || null,
        });
        // Template opener: keep the typed message so it can be sent once the
        // customer replies. Plain text send: clear the form.
        if (!data.usedTemplate) {
          setBody("");
          setName("");
        }
      } else {
        setResult({ ok: false, error: data.error || "Send failed" });
      }
    } catch {
      setResult({ ok: false, error: "Network error" });
    }
    setBusy(false);
  }

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--brand-dark)] text-sm font-bold text-white">
          ⚡
        </span>
        <h2 className="font-medium">Quick send</h2>
      </div>
      <form onSubmit={send} className="space-y-2.5">
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="WhatsApp number, e.g. +919876543210"
            className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
            required
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional, if known)"
            className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
          />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Message text…"
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
          required
        />
        {/* Sender-number picker — only when the business has several numbers.
            "Default" uses the number configured as META_PHONE_NUMBER_ID. */}
        <SenderSelect phoneNumbers={phoneNumbers} value={fromPhoneId} onChange={setFromPhoneId} />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !phone.trim() || !body.trim()}
            className="rounded-lg bg-[var(--brand-dark)] px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send"}
          </button>
          {result?.ok && !result.usedTemplate && (
            <span className="text-sm text-green-600">
              Sent.{" "}
              {result.contactId && (
                <Link href={`/contacts/${result.contactId}`} className="underline">
                  Open chat
                </Link>
              )}
            </span>
          )}
          {result && !result.ok && <span className="text-sm text-red-600">{result.error}</span>}
        </div>

        {/* New number: an approved template went out instead of the free text */}
        {result?.ok && result.usedTemplate && (
          <div
            className={`rounded-lg px-3 py-2 text-sm ${
              result.sendError ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
            }`}
          >
            {result.sendError ? (
              <>Template send failed: {result.sendError}</>
            ) : (
              <>
                🆕 New conversation — sent approved template{" "}
                <span className="font-mono">{result.usedTemplate}</span> to open the chat. Your
                message is kept above; send it once they reply.{" "}
                {result.contactId && (
                  <Link href={`/contacts/${result.contactId}`} className="underline">
                    Open chat
                  </Link>
                )}
              </>
            )}
          </div>
        )}
      </form>
      <p className="mt-2 text-xs text-slate-400">
        Known contacts get your text directly; a number not yet in your contacts is opened
        with an approved WhatsApp template first.
      </p>
    </section>
  );
}
