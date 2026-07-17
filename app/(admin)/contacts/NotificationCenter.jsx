"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/lib/format";
import SenderSelect from "@/components/SenderSelect";

const DEFAULT_BUTTONS = ["Sales", "Support", "Catalog"];

export default function NotificationCenter({ contacts, provider, phoneNumbers = [] }) {
  const [tab, setTab] = useState("messages");
  const [query, setQuery] = useState("");
  const isWati = provider === "wati";
  const isMeta = provider === "meta";
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((contact) =>
      [contact.name, contact.phone, contact.tags, contact.last_message]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [contacts, query]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Notification Center</h1>
        <p className="text-sm text-slate-500">Read customer messages or start a quick-button chat.</p>
      </div>

      <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm">
        <button
          type="button"
          onClick={() => setTab("messages")}
          className={`rounded-md px-3 py-2 font-medium ${
            tab === "messages" ? "bg-white text-[var(--brand-dark)] shadow-sm" : "text-slate-600"
          }`}
        >
          Messages
        </button>
        <button
          type="button"
          onClick={() => setTab("new")}
          className={`rounded-md px-3 py-2 font-medium ${
            tab === "new" ? "bg-white text-[var(--brand-dark)] shadow-sm" : "text-slate-600"
          }`}
        >
          New message
        </button>
      </div>

      {tab === "messages" ? (
        <MessagesTab contacts={filtered} query={query} setQuery={setQuery} />
      ) : (
        <NewMessageTab isWati={isWati} isMeta={isMeta} phoneNumbers={phoneNumbers} />
      )}
    </div>
  );
}

function MessagesTab({ contacts, query, setQuery }) {
  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search contacts or messages"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
      />

      {contacts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No saved conversations yet.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <Link href={`/contacts/${contact.id}`} className="block p-3 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{contact.name}</p>
                    <p className="text-xs text-slate-400">{contact.phone}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {timeAgo(contact.last_message_at || contact.last_activity_at || contact.created_at)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                  {contact.last_message ? (
                    <>
                      <span className="text-xs uppercase text-slate-400">
                        {contact.last_message_direction === "out" ? "You: " : "Customer: "}
                      </span>
                      {contact.last_message}
                    </>
                  ) : (
                    <span className="text-slate-400">No messages yet</span>
                  )}
                </p>
                {contact.last_message_status === "failed" && (
                  <p className="mt-1 text-xs text-red-600">Last send failed</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewMessageTab({ isWati, isMeta, phoneNumbers = [] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    body: "Hi {{name}}, how can we help you today?",
    buttons: DEFAULT_BUTTONS,
  });
  const [fromPhoneId, setFromPhoneId] = useState(""); // "" = default business number
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedContactId, setSavedContactId] = useState(null);
  const buttons = form.buttons.map((button) => button.trim()).filter(Boolean);

  function setField(key) {
    return (e) => setForm((current) => ({ ...current, [key]: e.target.value }));
  }

  function setButton(index) {
    return (e) =>
      setForm((current) => ({
        ...current,
        buttons: current.buttons.map((button, i) => (i === index ? e.target.value : button)),
      }));
  }

  async function saveContact() {
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        phone: form.phone,
        tags: "quick-chat",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save contact");
    setSavedContactId(data.id);
    return data.id;
  }

  async function saveOnly() {
    setBusy(true);
    setError("");
    try {
      const contactId = await saveContact();
      router.push(`/contacts/${contactId}`);
      router.refresh();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function sendQuickChat() {
    setBusy(true);
    setError("");
    try {
      const contactId = savedContactId || (await saveContact());
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          body: form.body,
          buttons,
          phoneNumberId: fromPhoneId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send message");
      router.push(`/contacts/${contactId}`);
      router.refresh();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <form className="space-y-3 rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
      {(isWati || isMeta) && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {isMeta
            ? "Quick-button chats are sent via the Meta WhatsApp Cloud API."
            : "Quick-button chats use WATI direct send when enabled, with automatic fallback to WATI's standard interactive API."}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={form.phone}
          onChange={setField("phone")}
          placeholder="Phone number"
          required
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={form.name}
          onChange={setField("name")}
          placeholder="Name (optional)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <textarea
        value={form.body}
        onChange={setField("body")}
        rows={3}
        placeholder="Quick chat message"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="grid gap-2 sm:grid-cols-3">
        {form.buttons.map((button, index) => (
          <input
            key={index}
            value={button}
            onChange={setButton(index)}
            maxLength={20}
            placeholder={`Button ${index + 1}`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <SenderSelect phoneNumbers={phoneNumbers} value={fromPhoneId} onChange={setFromPhoneId} />

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={saveOnly}
          disabled={busy || !form.phone.trim()}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
        >
          Save contact
        </button>
        <button
          type="button"
          onClick={sendQuickChat}
          disabled={busy || !form.phone.trim() || !form.body.trim() || buttons.length === 0}
          className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Working..." : "Send quick chat"}
        </button>
      </div>
    </form>
  );
}
