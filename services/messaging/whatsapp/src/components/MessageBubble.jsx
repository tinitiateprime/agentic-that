"use client";

import { useState } from "react";
import { formatClock } from "@whatsapp/lib/format";
import { useMounted } from "./useMounted";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// WhatsApp-styled chat bubble: green for outgoing, white for incoming, with a
// corner tail, and the timestamp + delivery ticks inside the bubble like WA.
// `children` renders extra content under the body (e.g. interactive buttons).
// `phones` is a { phoneNumberId: { short, label, color } } map — when the
// business has multiple sender numbers, each bubble is tagged with the one it
// went through. onReact is provided only to operators and only inbound messages
// expose the reaction control.
export default function MessageBubble({ m, children, phones, onReact, fallbackProvider }) {
  const mounted = useMounted();
  const [pickerOpen, setPickerOpen] = useState(false);
  const out = m.direction === "out";
  const isButtonReply = m.kind === "button_reply";
  const failed = m.status === "failed";
  const phone = phones && Object.keys(phones).length > 1 ? phones[m.phone_number_id] : null;
  const reactionProvider = String(m.provider || fallbackProvider || "").toLowerCase();
  const canReact =
    typeof onReact === "function" &&
    !out &&
    ["meta", "mock"].includes(reactionProvider);

  function pick(emoji) {
    setPickerOpen(false);
    onReact?.(m.id, emoji);
  }

  return (
    <div className={`group flex items-center gap-1 ${out ? "self-end" : "self-start"}`}>
      <div
        className={`relative max-w-[80%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${
          out ? "rounded-tr-none bg-[var(--bubble-out)]" : "rounded-tl-none bg-white"
        } ${isButtonReply ? "ring-2 ring-[var(--brand)]" : ""} ${m.reaction ? "mb-2" : ""}`}
      >
        {out ? (
          <span className="absolute -right-1.5 top-0 h-3 w-2 bg-[var(--bubble-out)] [clip-path:polygon(0_0,100%_0,0_100%)]" />
        ) : (
          <span className="absolute -left-1.5 top-0 h-3 w-2 bg-white [clip-path:polygon(0_0,100%_0,100%_100%)]" />
        )}

        {m.template_name && (
          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
            {m.template_name}
          </span>
        )}
        {isButtonReply && (
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-dark)]">
            👆 button tapped
          </span>
        )}

        <p className="whitespace-pre-wrap break-words">{m.body}</p>
        {children}

        <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none text-slate-500">
          {phone && (
            <span className="mr-auto flex items-center gap-0.5" title={phone.label}>
              <span className="text-[8px]" style={{ color: phone.color }}>
                ●
              </span>
              {phone.short}
            </span>
          )}
          {mounted ? formatClock(m.created_at) : ""}
          {out && (failed ? <span className="font-semibold text-red-500">!</span> : <Ticks status={m.status} />)}
        </span>

        {m.reaction && (
          <span
            className={`absolute -bottom-2.5 flex items-center rounded-full bg-white px-1 text-xs leading-none shadow ring-1 ring-slate-200 ${
              out ? "left-1.5" : "right-1.5"
            }`}
            title="Message reaction"
          >
            {m.reaction}
          </span>
        )}
      </div>

      {canReact && (
        <div className={`flex items-center transition-opacity ${pickerOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}>
          {pickerOpen ? (
            <div className="flex items-center gap-0.5 rounded-full bg-white px-1.5 py-1 shadow ring-1 ring-slate-200">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => pick(emoji)}
                  aria-label={`React with ${emoji}`}
                  className="rounded-full px-0.5 text-base leading-none hover:scale-125 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
                >
                  {emoji}
                </button>
              ))}
              {m.reaction && (
                <button
                  type="button"
                  onClick={() => pick("")}
                  aria-label="Remove reaction"
                  className="ml-0.5 rounded-full px-1 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-label="React to message"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs shadow ring-1 ring-slate-200 hover:bg-slate-50"
            >
              🙂
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Ticks({ status }) {
  if (status === "read") return <span className="tracking-tighter text-[#53bdeb]">✓✓</span>;
  if (status === "delivered") return <span className="tracking-tighter text-slate-400">✓✓</span>;
  return <span className="text-slate-400">✓</span>; // sent / queued
}
