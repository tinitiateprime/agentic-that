"use client";

import { useState, useRef, useEffect } from "react";
import MessageBubble from "@whatsapp/components/MessageBubble";
import EmojiPicker from "@whatsapp/components/EmojiPicker";

const PHONE_COLORS = ["#128c7e", "#6366f1", "#ea580c", "#db2777"];

export default function Chat({
  contactId,
  initialMessages,
  templates,
  provider,
  phoneNumbers = [],
  canOperate = false,
}) {
  const [messages, setMessages] = useState(() => mergeMessages([], initialMessages));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showButtons, setShowButtons] = useState(false);
  // Approved-template state, shared by whichever BSP is active (wati or meta).
  const [wati, setWati] = useState({ loading: false, configured: true, approved: [] });
  const [watiTemplate, setWatiTemplate] = useState("");
  const [fromPhoneId, setFromPhoneId] = useState(""); // "" = auto (follow conversation)
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const lastIdRef = useRef(initialMessages.reduce((max, m) => Math.max(max, m.id), 0));
  const reactionsSinceRef = useRef(new Date(0).toISOString());
  const isMock = provider === "mock";
  const isWati = provider === "wati";
  const isMeta = provider === "meta";
  const selectedWatiTemplate = wati.approved.find((t) => t.name === watiTemplate);

  // Sending and polling can resolve at the same time with the same database
  // row. Merge by id so that race (and overlapping polls) cannot duplicate a
  // bubble in the chat.
  function appendMessages(incoming) {
    if (!incoming?.length) return;
    const maxId = incoming.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0);
    if (maxId > lastIdRef.current) lastIdRef.current = maxId;
    setMessages((current) => mergeMessages(current, incoming));
  }

  function applyReactions(reactions) {
    if (!reactions?.length) return;
    const byId = new Map(reactions.map((reaction) => [Number(reaction.id), reaction]));
    setMessages((current) => current.map((message) => {
      const update = byId.get(Number(message.id));
      return update ? { ...message, reaction: update.reaction || null } : message;
    }));
  }

  function insertEmoji(emoji) {
    const input = inputRef.current;
    if (!input) {
      setText((current) => current + emoji);
      return;
    }
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      input.focus();
      const position = start + emoji.length;
      input.setSelectionRange(position, position);
    });
  }

  // { phoneNumberId: { short, label, color } } for the per-bubble source tags
  // and the sender picker (only relevant with 2+ business numbers).
  const multiNumber = phoneNumbers.length > 1;
  const phoneMap = {};
  phoneNumbers.forEach((n, i) => {
    const digits = String(n.number || "").replace(/\D/g, "");
    phoneMap[n.id] = {
      short: `…${digits.slice(-4) || n.id.slice(-4)}`,
      label: `${n.name || "Business number"} (${n.number || n.id})`,
      color: PHONE_COLORS[i % PHONE_COLORS.length],
    };
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Keep track of the newest message id we've rendered, so polling only asks
  // for what's actually new (and doesn't re-add a message we just sent).
  useEffect(() => {
    const maxId = messages.reduce((max, m) => Math.max(max, m.id), 0);
    if (maxId > lastIdRef.current) lastIdRef.current = maxId;
  }, [messages]);

  // Poll for inbound replies (e.g. a customer's WhatsApp reply arriving via
  // webhook) so an open chat updates without a manual refresh.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/contacts/${contactId}/messages?afterId=${lastIdRef.current}&reactionsSince=${encodeURIComponent(reactionsSinceRef.current)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (data.messages?.length) {
          appendMessages(data.messages);
        }
        if (data.reactions?.length) applyReactions(data.reactions);
        if (data.reactionCursor) reactionsSinceRef.current = data.reactionCursor;
      } catch {
        // Transient network error — next tick retries.
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [contactId]);

  // The chat is open, so its replies are being seen — advance the read marker
  // on mount and again whenever a new inbound message arrives.
  const inboundCount = messages.filter((m) => m.direction === "in").length;
  useEffect(() => {
    fetch(`/api/contacts/${contactId}/read`, { method: "POST" }).catch(() => {});
  }, [contactId, inboundCount]);

  useEffect(() => {
    if (!isWati && !isMeta) return;
    setWati((w) => ({ ...w, loading: true }));
    // Live wiring — talks to whichever BSP is active via WA_PROVIDER.
    const url = isMeta ? "/api/meta/templates" : "/api/wati/templates";
    // Kept for reference / easy rollback to WATI (inactive while WA_PROVIDER=meta):
    // fetch("/api/wati/templates", { cache: "no-store" })
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setWati({
          loading: false,
          configured: data.configured !== false,
          approved: data.templates || [],
        });
      })
      .catch(() => setWati((w) => ({ ...w, loading: false })));
  }, [isWati, isMeta]);

  async function post(url, payload) {
    setBusy(true);
    setError("");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Failed");
      return null;
    }
    return data;
  }

  async function send(payload) {
    const data = await post("/api/messages", {
      contactId,
      phoneNumberId: fromPhoneId || undefined,
      ...payload,
    });
    if (data) {
      appendMessages([data.message]);
      setText("");
      setWatiTemplate("");
    }
  }

  async function react(messageId, emoji) {
    const reaction = emoji || null;
    const previous = messages.find((message) => Number(message.id) === Number(messageId))?.reaction || null;
    setMessages((current) => current.map((message) =>
      Number(message.id) === Number(messageId) ? { ...message, reaction } : message
    ));
    setError("");
    try {
      const response = await fetch("/api/messages/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, emoji: emoji || "" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Reaction failed");
      if (data.message) applyReactions([data.message]);
    } catch (requestError) {
      setMessages((current) => current.map((message) =>
        Number(message.id) === Number(messageId) && message.reaction === reaction
          ? { ...message, reaction: previous }
          : message
      ));
      setError(requestError.message || "Reaction failed");
    }
  }

  // Mock-only: pretend the customer tapped a button so the capture loop is visible.
  async function simulateTap(buttonText) {
    const data = await post("/api/messages/simulate-reply", {
      contactId,
      text: buttonText,
      buttonReply: true,
    });
    if (data) appendMessages([data.message]);
  }

  return (
    <div className="flex flex-col rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      {/* Message history — WhatsApp wallpaper + bubbles */}
      <div className="wa-wallpaper flex max-h-[55vh] min-h-[200px] flex-col gap-1.5 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="m-auto rounded-full bg-white/80 px-3 py-1 text-xs text-slate-500">
            No messages yet. Send a template or a 3-button prompt to start.
          </p>
        )}
        {messages.map((m) => {
          const buttons = m.buttons ? safeParse(m.buttons) : null;
          return (
            <MessageBubble
              key={m.id}
              m={m}
              phones={phoneMap}
              onReact={canOperate ? react : undefined}
              fallbackProvider={provider}
            >
              {/* Interactive buttons rendered under the bubble */}
              {buttons && buttons.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {buttons.map((b, i) => (
                    <button
                      key={i}
                      disabled={!isMock || busy}
                      onClick={() => isMock && simulateTap(b)}
                      title={isMock ? "Simulate the customer tapping this" : "Sent as a WhatsApp button"}
                      className="rounded-lg border border-[var(--brand)] bg-white px-2 py-1.5 text-center text-xs font-medium text-[var(--brand-dark)] disabled:opacity-60"
                    >
                      {b}
                    </button>
                  ))}
                  {isMock && (
                    <span className="text-center text-[10px] text-slate-400">
                      (mock: tap to simulate the customer's reply)
                    </span>
                  )}
                </div>
              )}
            </MessageBubble>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Template quick-send — live wiring is Meta Cloud API (isMeta); the WATI
          branch (isWati) is kept intact, unused while WA_PROVIDER=meta, so
          switching back is a one-line env change with no code changes. */}
      {(isWati || isMeta) && (
        <div className="space-y-2 border-t border-slate-100 p-2">
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {isMeta
              ? "Sending via the Meta WhatsApp Cloud API. Approved templates are available below for template-based outreach (required to message a contact outside the 24h window)."
              : "WATI direct send is used when enabled on your tenant; otherwise the app falls back to WATI session/interactive APIs. Approved templates are available below for template-based outreach."}
          </div>
          {wati.loading ? (
            <p className="text-xs text-slate-400">Loading WhatsApp templates...</p>
          ) : !wati.configured ? (
            <p className="text-xs text-amber-700">
              {isMeta ? "Meta isn't configured." : "WATI isn't configured."}
            </p>
          ) : wati.approved.length === 0 ? (
            <p className="text-xs text-slate-500">
              No approved WhatsApp templates found in {isMeta ? "Meta" : "WATI"}.
            </p>
          ) : (
            <div className="flex gap-2">
              <select
                value={watiTemplate}
                onChange={(e) => setWatiTemplate(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select approved WhatsApp template</option>
                {wati.approved.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !watiTemplate}
                onClick={() =>
                  send({
                    watiTemplate,
                    templateParams: buildTemplateParams(selectedWatiTemplate),
                    // Meta's Cloud API rejects a template send unless the
                    // language matches the approved template exactly; WATI
                    // ignores this field, so it's safe to always send it.
                    language: selectedWatiTemplate?.language,
                  })
                }
                className="rounded-lg bg-[var(--brand-dark)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Send template
              </button>
            </div>
          )}
          {selectedWatiTemplate?.body && (
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
              {selectedWatiTemplate.body}
            </p>
          )}
        </div>
      )}

      {templates.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 p-2">
          {(isWati || isMeta) && (
            <p className="basis-full text-xs text-slate-500">
              CRM templates are quick replies and still require an active WhatsApp conversation.
            </p>
          )}
          {templates.map((t) => (
            <button
              key={t.id}
              disabled={busy}
              onClick={() => send({ templateId: t.id })}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-50"
            >
              ⚡ {t.name}
            </button>
          ))}
        </div>
      )}

      {/* 3-button (Bot) composer */}
      {showButtons ? (
        <ButtonComposer
          busy={busy}
          onCancel={() => setShowButtons(false)}
          onSend={async ({ body, buttons }) => {
            await send({ body, buttons });
            setShowButtons(false);
          }}
        />
      ) : (
        <div className="border-t border-slate-100 px-2 pt-2">
          <button
            onClick={() => setShowButtons(true)}
            className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200"
          >
            ➕ 3-button prompt
          </button>
        </div>
      )}

      {/* Free-text composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send({ body: text });
        }}
        className="flex items-center gap-2 border-t border-slate-100 p-2"
      >
        {/* Sender-number picker — shows only when the business has several
            numbers. "Auto" replies from the number the customer wrote to. */}
        {multiNumber && (
          <select
            value={fromPhoneId}
            onChange={(e) => setFromPhoneId(e.target.value)}
            title="Send from which business number"
            className="w-24 shrink-0 rounded-full border border-slate-300 px-2 py-2 text-xs outline-none"
          >
            <option value="">Auto</option>
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
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-full bg-[var(--brand-dark)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {error && <p className="px-3 pb-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function mergeMessages(current, incoming) {
  const byId = new Map(current.map((message) => [String(message.id), message]));
  for (const message of incoming || []) {
    if (message?.id == null) continue;
    byId.set(String(message.id), message);
  }
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

function ButtonComposer({ onSend, onCancel, busy }) {
  const [body, setBody] = useState("");
  const [btns, setBtns] = useState(["", "", ""]);
  const setBtn = (i) => (e) =>
    setBtns((arr) => arr.map((b, idx) => (idx === i ? e.target.value : b)));
  const buttons = btns.map((b) => b.trim()).filter(Boolean);

  return (
    <div className="space-y-2 border-t border-slate-100 bg-slate-50 p-3">
      <p className="text-xs font-medium text-slate-500">Interactive 3-button prompt</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Message text (e.g. How can we help you today?)"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-3 gap-2">
        {btns.map((b, i) => (
          <input
            key={i}
            value={b}
            onChange={setBtn(i)}
            placeholder={`Button ${i + 1}`}
            maxLength={20}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-slate-600">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !body.trim() || buttons.length === 0}
          onClick={() => onSend({ body: body.trim(), buttons })}
          className="rounded-lg bg-[var(--brand-dark)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Send buttons
        </button>
      </div>
    </div>
  );
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function buildTemplateParams(template) {
  const names =
    template?.placeholderNames?.length
      ? template.placeholderNames
      : Array.from({ length: template?.placeholders || 0 }, (_, i) => String(i + 1));

  return names.map((name) => ({ name, value: "{{name}}" }));
}
