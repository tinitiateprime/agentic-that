"use client";

import { useEffect, useRef, useState } from "react";

const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😇", "🙂", "😉",
  "😍", "😘", "😜", "🤪", "🤗", "🤔", "😎", "🥳",
  "😴", "😢", "😭", "😤", "😡", "🥺", "😳", "😱",
  "👍", "👎", "👏", "🙌", "🙏", "👌", "🤝", "💪",
  "👋", "✌️", "🤞", "👇", "👆", "🫶", "🤙", "✍️",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔",
  "🔥", "⭐", "✨", "🎉", "🎊", "✅", "❌", "⚠️",
  "💯", "🚀", "📞", "📩", "📅", "⏰", "💰", "🛒",
];

export default function EmojiPicker({ onPick, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Insert emoji"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-slate-500 hover:bg-slate-200"
      >
        😊
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Choose an emoji"
          className="absolute bottom-full left-0 z-30 mb-2 grid max-h-52 w-64 grid-cols-8 gap-0.5 overflow-y-auto rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-200"
        >
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onPick(emoji)}
              aria-label={`Insert ${emoji}`}
              className="rounded p-1 text-lg leading-none hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
