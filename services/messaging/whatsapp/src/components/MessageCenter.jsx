"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MessageBubble from "./MessageBubble";
import EmojiPicker from "./EmojiPicker";
import { useMounted } from "./useMounted";
import { timeAgo, formatDayClock } from "@whatsapp/lib/format";

// WhatsApp-themed message center with four layouts, like a WA Web workspace:
//   Split   — chat list + one open conversation (WhatsApp Web style)
//   Compact — denser list, same split layout
//   Focus   — one conversation full-width, contact chips to switch
//   Multi   — grid of live chat cards, each with its own composer
const VIEWS = ["Split", "Compact", "Focus", "Multi"];

// One color per business sender number, so bubbles/tags are tellable apart.
const PHONE_COLORS = ["#128c7e", "#6366f1", "#ea580c", "#db2777"];

// { phoneNumberId: { short, label, color } } — short = last 4 digits.
function buildPhoneMap(phoneNumbers) {
  const map = {};
  (phoneNumbers || []).forEach((n, i) => {
    const digits = String(n.number || "").replace(/\D/g, "");
    map[n.id] = {
      short: `…${digits.slice(-4) || n.id.slice(-4)}`,
      label: `${n.name || "Business number"} (${n.number || n.id})`,
      color: PHONE_COLORS[i % PHONE_COLORS.length],
    };
  });
  return map;
}

export default function MessageCenter({ contacts, initialMessages, provider, phoneNumbers = [], canOperate = false }) {
  const mounted = useMounted();
  const router = useRouter();
  const [view, setView] = useState("Split");
  const [msgs, setMsgs] = useState(initialMessages); // { [contactId]: Message[] }
  const [selectedId, setSelectedId] = useState(contacts[0]?.id ?? null);
  const [mobileOpen, setMobileOpen] = useState(false); // split/compact on phones: list vs convo
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [templates, setTemplates] = useState([]); // approved WhatsApp templates

  const lastIdRef = useRef(maxMessageId(initialMessages));
  const reactionsSinceRef = useRef(new Date(0).toISOString());

  // Known contact ids, refreshed every render so appendMessages (called from
  // the poll) can spot messages from brand-new senders.
  const contactIdsRef = useRef(new Set());
  contactIdsRef.current = new Set(contacts.map((c) => c.id));
  const lastRouterRefreshRef = useRef(0);

  // One poll for every chat on screen: any message newer than the last id we
  // hold (inbound webhook replies AND sends from other tabs) gets appended.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/messages/updates?afterId=${lastIdRef.current}&reactionsSince=${encodeURIComponent(reactionsSinceRef.current)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (data.messages?.length) appendMessages(data.messages);
        if (data.reactions?.length) applyReactions(data.reactions);
        if (data.reactionCursor) reactionsSinceRef.current = data.reactionCursor;
      } catch {
        // transient network error — next tick retries
      }
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Approved templates — the only way to message a contact whose 24h session
  // window has closed, so every chat pane offers them next to the composer.
  useEffect(() => {
    if (provider !== "meta" && provider !== "wati") return;
    const url = provider === "meta" ? "/api/meta/templates" : "/api/wati/templates";
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates || []))
      .catch(() => {});
  }, [provider]);

  function appendMessages(newMessages) {
    setMsgs((current) => {
      const next = { ...current };
      for (const m of newMessages) {
        const existing = next[m.contact_id] || [];
        if (existing.some((e) => e.id === m.id)) continue;
        next[m.contact_id] = [...existing, m];
        if (m.id > lastIdRef.current) lastIdRef.current = m.id;
      }
      return next;
    });

    // A message from a first-time sender: the webhook auto-created a contact
    // the server-rendered list doesn't know yet. Re-render the page's server
    // data so they appear live (throttled while the refresh is in flight).
    const hasUnknown = newMessages.some((m) => !contactIdsRef.current.has(m.contact_id));
    if (hasUnknown && Date.now() - lastRouterRefreshRef.current > 5000) {
      lastRouterRefreshRef.current = Date.now();
      router.refresh();
    }
  }

  function applyReactions(reactions) {
    if (!reactions?.length) return;
    const byId = new Map(reactions.map((reaction) => [Number(reaction.id), reaction]));
    setMsgs((current) => {
      const next = {};
      for (const [contactId, list] of Object.entries(current)) {
        next[contactId] = list.map((message) => {
          const update = byId.get(Number(message.id));
          return update ? { ...message, reaction: update.reaction || null } : message;
        });
      }
      return next;
    });
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/messages/updates?afterId=0", { cache: "no-store" });
      const data = await res.json();
      const rebuilt = {};
      for (const c of contacts) rebuilt[c.id] = [];
      for (const m of data.messages || []) {
        (rebuilt[m.contact_id] ??= []).push(m);
        if (m.id > lastIdRef.current) lastIdRef.current = m.id;
      }
      setMsgs(rebuilt);
      if (data.reactionCursor) reactionsSinceRef.current = data.reactionCursor;
    } catch {
      // keep current state on failure
    }
    setRefreshing(false);
  }

  async function send(contactId, fromPhoneId) {
    const text = (drafts[contactId] || "").trim();
    if (!text) return;
    setBusy((b) => ({ ...b, [contactId]: true }));
    setErrors((e) => ({ ...e, [contactId]: "" }));
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, body: text, phoneNumberId: fromPhoneId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Send failed");
      appendMessages([data.message]);
      setDrafts((d) => ({ ...d, [contactId]: "" }));
      if (data.message?.error) setErrors((e) => ({ ...e, [contactId]: data.message.error }));
    } catch (err) {
      setErrors((e) => ({ ...e, [contactId]: err.message }));
    }
    setBusy((b) => ({ ...b, [contactId]: false }));
  }

  // Send an approved WhatsApp template — reopens a closed 24h session so the
  // conversation stays active.
  async function sendTemplate(contactId, templateName, fromPhoneId) {
    const t = templates.find((x) => x.name === templateName);
    if (!t) return;
    setBusy((b) => ({ ...b, [contactId]: true }));
    setErrors((e) => ({ ...e, [contactId]: "" }));
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          watiTemplate: t.name,
          templateParams: buildTemplateParams(t),
          language: t.language,
          phoneNumberId: fromPhoneId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Template send failed");
      appendMessages([data.message]);
      if (data.message?.error) setErrors((e) => ({ ...e, [contactId]: data.message.error }));
    } catch (err) {
      setErrors((e) => ({ ...e, [contactId]: err.message }));
    }
    setBusy((b) => ({ ...b, [contactId]: false }));
  }

  async function react(contactId, messageId, emoji) {
    const reaction = emoji || null;
    const previous = (msgs[contactId] || []).find(
      (message) => Number(message.id) === Number(messageId)
    )?.reaction || null;
    setMsgs((current) => ({
      ...current,
      [contactId]: (current[contactId] || []).map((message) =>
        Number(message.id) === Number(messageId) ? { ...message, reaction } : message
      ),
    }));
    setErrors((current) => ({ ...current, [contactId]: "" }));
    try {
      const response = await fetch("/api/messages/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, emoji: emoji || "" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Reaction failed");
      if (data.message) applyReactions([data.message]);
    } catch (error) {
      setMsgs((current) => ({
        ...current,
        [contactId]: (current[contactId] || []).map((message) =>
          Number(message.id) === Number(messageId) && message.reaction === reaction
            ? { ...message, reaction: previous }
            : message
        ),
      }));
      setErrors((current) => ({
        ...current,
        [contactId]: error.message || "Reaction failed",
      }));
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.name, c.phone, lastOf(msgs[c.id])?.body]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [contacts, msgs, query]);

  const selected = contacts.find((c) => c.id === selectedId) || contacts[0];

  // Fire-and-forget read marker (feeds the dashboard's Read/Unread lists).
  function markRead(contactId) {
    fetch(`/api/contacts/${contactId}/read`, { method: "POST" }).catch(() => {});
  }

  // In list+pane views the selected conversation is on screen — mark it read
  // when selected, and again when a new inbound message lands while it's open.
  const selectedInbound = (msgs[selected?.id] || []).filter((m) => m.direction === "in").length;
  useEffect(() => {
    if (view === "Multi" || !selected) return;
    markRead(selected.id);
  }, [view, selected?.id, selectedInbound]);

  const phoneMap = useMemo(() => buildPhoneMap(phoneNumbers), [phoneNumbers]);

  const paneProps = (contact) => ({
    contact,
    messages: msgs[contact.id] || [],
    draft: drafts[contact.id] || "",
    onDraft: (v) => setDrafts((d) => ({ ...d, [contact.id]: v })),
    onSend: (fromPhoneId) => send(contact.id, fromPhoneId),
    busy: !!busy[contact.id],
    error: errors[contact.id] || "",
    templates,
    onSendTemplate: (name, fromPhoneId) => sendTemplate(contact.id, name, fromPhoneId),
    onReact: canOperate ? (messageId, emoji) => react(contact.id, messageId, emoji) : undefined,
    reactionProvider: provider,
    phoneNumbers,
    phoneMap,
  });

  return (
    <div className="space-y-3">
      {/* View switcher + refresh, like the reference workspace */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Views</span>
          {VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 text-sm ${
                view === v ? "bg-[var(--brand-dark)] font-medium text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {contacts.length === 0 ? (
        <p className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
          No contacts yet — replies will appear here as chats.
        </p>
      ) : view === "Multi" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            /* Cards share the screen, so a chat only counts as read once the
               user actually interacts with that card. */
            <div key={c.id} onClick={() => markRead(c.id)}>
              <ChatPane {...paneProps(c)} height="h-64" />
            </div>
          ))}
        </div>
      ) : view === "Focus" ? (
        <div className="space-y-2">
          {/* Contact chips to switch conversations */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {contacts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-sm ${
                  c.id === selected?.id
                    ? "bg-[var(--brand-dark)] font-medium text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          {selected && <ChatPane {...paneProps(selected)} height="h-[65vh]" />}
        </div>
      ) : (
        /* Split & Compact — list + open conversation */
        <div className="grid gap-3 md:grid-cols-[300px_1fr]">
          <div className={`${mobileOpen ? "hidden md:block" : ""} space-y-2`}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages or chats"
              className="w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-[var(--brand)]"
            />
            <ul className="max-h-[65vh] divide-y divide-slate-100 overflow-y-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              {filtered.map((c) => {
                const last = lastOf(msgs[c.id]);
                const active = c.id === selected?.id;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        setSelectedId(c.id);
                        setMobileOpen(true);
                      }}
                      className={`flex w-full items-center gap-3 px-3 text-left hover:bg-slate-50 ${
                        view === "Compact" ? "py-1.5" : "py-2.5"
                      } ${active ? "bg-[#f0f2f5]" : ""}`}
                    >
                      <Avatar name={c.name} size={view === "Compact" ? "h-7 w-7 text-xs" : "h-10 w-10 text-sm"} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{c.name}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">
                            {mounted && last ? timeAgo(last.created_at) : ""}
                          </span>
                        </span>
                        {view !== "Compact" && (
                          <span className="block truncate text-xs text-slate-500">
                            {last ? last.body : c.phone}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="p-4 text-center text-sm text-slate-400">No chats match.</li>
              )}
            </ul>
          </div>

          <div className={mobileOpen ? "" : "hidden md:block"}>
            {selected && (
              <ChatPane
                {...paneProps(selected)}
                height="h-[60vh]"
                onBack={() => setMobileOpen(false)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// One WhatsApp-looking conversation: green header, wallpaper thread, composer.
function ChatPane({
  contact,
  messages,
  draft,
  onDraft,
  onSend,
  busy,
  error,
  height = "h-72",
  onBack,
  templates = [],
  onSendTemplate,
  onReact,
  reactionProvider,
  phoneNumbers = [],
  phoneMap = {},
}) {
  const mounted = useMounted();
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const [tplName, setTplName] = useState("");
  const [fromPhoneId, setFromPhoneId] = useState(""); // "" = auto (follow conversation)

  function insertEmoji(emoji) {
    const input = inputRef.current;
    if (!input) {
      onDraft(draft + emoji);
      return;
    }
    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? draft.length;
    onDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      input.focus();
      const position = start + emoji.length;
      input.setSelectionRange(position, position);
    });
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const last = lastOf(messages);

  // WhatsApp's 24h customer-service window: free text only delivers within
  // 24h of the customer's LAST inbound message. Outside it, only an approved
  // template gets through — surface that so the conversation can be kept alive.
  const lastInbound = [...messages].reverse().find((m) => m.direction === "in");
  const windowOpen =
    mounted &&
    lastInbound &&
    Date.now() - new Date(lastInbound.created_at.replace(" ", "T") + "Z").getTime() < 24 * 3600000;

  // Where "Auto" routes: the number the customer last wrote to, else default.
  const multiNumber = phoneNumbers.length > 1;
  const autoTarget =
    phoneMap[lastInbound?.phone_number_id] ||
    phoneMap[phoneNumbers.find((n) => n.isDefault)?.id] ||
    null;

  return (
    <div className="relative flex flex-col rounded-xl shadow-sm ring-1 ring-slate-200">
      {/* Header — classic WA green */}
      <div className="flex items-center gap-3 rounded-t-xl bg-[var(--brand-dark)] px-3 py-2 text-white">
        {onBack && (
          <button onClick={onBack} className="md:hidden" aria-label="Back to chats">
            ←
          </button>
        )}
        <Avatar name={contact.name} light />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{contact.name}</p>
          <p className="truncate text-[11px] text-white/70">{contact.phone}</p>
        </div>
        {mounted && last && (
          <span className="shrink-0 text-[10px] text-white/70">{formatDayClock(last.created_at)}</span>
        )}
      </div>

      {/* Thread on WA wallpaper */}
      <div ref={scrollRef} className={`wa-wallpaper flex ${height} flex-col gap-1.5 overflow-y-auto p-3`}>
        {messages.length === 0 ? (
          <p className="m-auto rounded-full bg-white/80 px-3 py-1 text-xs text-slate-500">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              m={m}
              phones={phoneMap}
              onReact={onReact}
              fallbackProvider={reactionProvider}
            />
          ))
        )}
      </div>

      {/* Session-window hint + approved-template sender — keeps the chat
          active when free text can no longer deliver */}
      {mounted && !windowOpen && (
        <p className="bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          ⏳ 24h window closed — free text won&apos;t deliver. Send an approved template to reopen the chat.
        </p>
      )}
      {templates.length > 0 && (
        <div className="flex items-center gap-2 border-t border-slate-200 bg-[#f0f2f5] px-2 pt-2">
          <select
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
            className="min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none"
          >
            <option value="">📨 Approved template…</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.language})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !tplName}
            onClick={() => {
              onSendTemplate?.(tplName, fromPhoneId);
              setTplName("");
            }}
            className="shrink-0 rounded-full bg-[var(--brand-dark)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Send template
          </button>
        </div>
      )}

      {/* Composer — WA-style pill input + round send button */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend(fromPhoneId);
        }}
        className="flex items-center gap-2 rounded-b-xl bg-[#f0f2f5] p-2"
      >
        {/* Sender-number picker — only when the business has several numbers.
            "Auto" follows the conversation (the number the customer wrote to). */}
        {multiNumber && (
          <select
            value={fromPhoneId}
            onChange={(e) => setFromPhoneId(e.target.value)}
            title="Send from which business number"
            className="w-24 shrink-0 rounded-full border border-slate-200 bg-white px-2 py-2 text-xs outline-none"
          >
            <option value="">Auto{autoTarget ? ` ${autoTarget.short}` : ""}</option>
            {phoneNumbers.map((n) => (
              <option key={n.id} value={n.id}>
                {phoneMap[n.id]?.short || n.id}
              </option>
            ))}
          </select>
        )}
        <EmojiPicker onPick={insertEmoji} />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder={`Message ${contact.name}`}
          className="min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-[var(--brand)]"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-white disabled:opacity-50"
        >
          ➤
        </button>
      </form>
      {error && <p className="bg-[#f0f2f5] px-3 pb-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Avatar({ name, size = "h-9 w-9 text-sm", light }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full font-semibold ${
        light ? "bg-white/20 text-white" : "bg-[var(--brand)] text-white"
      }`}
    >
      {initial}
    </span>
  );
}

function lastOf(list) {
  return list?.length ? list[list.length - 1] : null;
}

function maxMessageId(byContact) {
  let max = 0;
  for (const list of Object.values(byContact || {})) {
    for (const m of list) if (m.id > max) max = m.id;
  }
  return max;
}

// One param per template placeholder; "{{name}}" is substituted server-side
// with the contact's name (same convention as the chat + broadcast senders).
function buildTemplateParams(template) {
  const names = template?.placeholderNames?.length
    ? template.placeholderNames
    : Array.from({ length: template?.placeholders || 0 }, (_, i) => String(i + 1));
  return names.map((name) => ({ name, value: "{{name}}" }));
}
