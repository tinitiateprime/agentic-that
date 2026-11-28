"use client";

import { useEffect, useRef, useState } from "react";
import { formatClock } from "@whatsapp/lib/format";
import { useMounted } from "./useMounted";
import { isInlineSafeMime, mediaLabel, mediaUrl } from "@whatsapp/lib/wa/media";

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
    <div className={`group flex max-w-[80%] items-center gap-1 ${out ? "self-end" : "self-start"}`}>
      <div
        className={`relative min-w-0 rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${
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

        {m.media_id && m.media_type && <MediaAttachment m={m} />}
        {(!m.media_id || isCaption(m)) && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
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

// The body of a media message is its caption, or a stand-in (file name or
// "📷 Photo") when there was none. Only show it under the file when it's a
// real caption.
function isCaption(m) {
  const body = String(m.body || "").trim();
  if (!body) return false;
  if (m.media_filename && body === m.media_filename) return false;
  const placeholders = [mediaLabel(m.media_type), mediaLabel(m.media_type, { voice: true })];
  return !placeholders.includes(body);
}

function fileKind(m) {
  const fromName = String(m.media_filename || "").split(".").pop();
  if (m.media_filename && fromName && fromName.length <= 5) return fromName.toUpperCase();
  const fromMime = String(m.media_mime || "").split("/")[1] || "";
  return fromMime.split(/[.+;-]/).pop().toUpperCase().slice(0, 5) || "FILE";
}

// Documents, photos, voice notes, videos and stickers sent to the business.
// Files load from /api/messages/:id/media, which fetches them from Meta.
function MediaAttachment({ m }) {
  const [broken, setBroken] = useState(false);
  const imageRef = useRef(null);
  // A server-rendered image can fail before React attaches onError; catch
  // that case once mounted.
  useEffect(() => {
    const image = imageRef.current;
    if (image && image.complete && image.naturalWidth === 0) setBroken(true);
  }, []);
  const src = mediaUrl(m.id);
  const downloadHref = mediaUrl(m.id, { download: true });
  const name = m.media_filename || mediaLabel(m.media_type);

  if (broken) {
    return (
      <p className="mb-1 rounded-md bg-slate-100 px-2 py-1.5 text-xs text-slate-500">
        {mediaLabel(m.media_type)} isn't available any more. WhatsApp only keeps received files for a limited time.
      </p>
    );
  }

  if (m.media_type === "image" || m.media_type === "sticker") {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="mb-1 block" title="Open full size">
        <img
          ref={imageRef}
          src={src}
          alt={isCaption(m) ? m.body : name}
          loading="lazy"
          onError={() => setBroken(true)}
          className={m.media_type === "sticker" ? "h-28 w-28 object-contain" : "max-h-72 max-w-full rounded-md object-contain"}
        />
      </a>
    );
  }

  if (m.media_type === "audio") {
    return <audio controls preload="none" src={src} onError={() => setBroken(true)} className="mb-1 h-10 w-64 max-w-full" />;
  }

  if (m.media_type === "video") {
    return (
      <video controls preload="metadata" src={src} onError={() => setBroken(true)} className="mb-1 max-h-72 max-w-full rounded-md" />
    );
  }

  const openable = isInlineSafeMime(m.media_mime);
  return (
    <div className="mb-1 flex w-60 max-w-full items-center gap-2.5 rounded-md bg-black/5 px-2.5 py-2">
      <span className="flex h-10 w-8 shrink-0 items-center justify-center rounded bg-white text-[9px] font-bold text-slate-500 ring-1 ring-slate-200">
        {fileKind(m)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={name}>{name}</span>
        <span className="flex gap-3 text-xs">
          {openable && (
            <a href={src} target="_blank" rel="noopener noreferrer" className="text-[var(--brand-dark)] hover:underline">
              Open
            </a>
          )}
          <a href={downloadHref} download className="text-[var(--brand-dark)] hover:underline">
            Download
          </a>
        </span>
      </span>
    </div>
  );
}

function Ticks({ status }) {
  if (status === "read") return <span className="tracking-tighter text-[#53bdeb]">✓✓</span>;
  if (status === "delivered") return <span className="tracking-tighter text-slate-400">✓✓</span>;
  return <span className="text-slate-400">✓</span>; // sent / queued
}
