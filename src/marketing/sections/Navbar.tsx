"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Menu, X } from "lucide-react";
import { useState } from "react";
import { NAV_LINKS } from "../content.ts";
import { EASE_OUT } from "../motion-presets.ts";
import { GhostButton, PrimaryButton } from "../components/primitives.tsx";

function Wordmark() {
  return (
    <a href="/" className="flex shrink-0 items-center gap-2.5" aria-label="AgenticThat home">
      <span className="relative flex size-2.5 items-center justify-center">
        <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-indigo-500 opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 shadow-[0_0_12px_rgba(99,102,241,0.9)]" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-white">AgenticThat</span>
    </a>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[#1E293B] bg-[#0B0F17]/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Wordmark />

        {/* Center links */}
        <ul className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                className="rounded-md px-3 py-2 text-[13px] font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-white"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* Wrapped rather than given `hidden` directly: the buttons carry an
              unprefixed `inline-flex`, which Tailwind emits after `.hidden` and
              would therefore win at the base breakpoint. */}
          <span className="hidden sm:flex sm:items-center sm:gap-2">
            <a
              href="/login"
              className="rounded-md px-3 py-2 text-[13px] font-medium text-slate-300 transition-colors hover:text-white"
            >
              Log In
            </a>
            <PrimaryButton href="/apps" size="sm">
              Launch App
              <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </PrimaryButton>
          </span>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex size-9 items-center justify-center rounded-md border border-[#1E293B] text-slate-300 transition-colors hover:border-slate-600 hover:text-white lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="mobile-nav"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
            className="overflow-hidden border-t border-[#1E293B] bg-[#0B0F17]/95 lg:hidden"
          >
            <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 sm:px-6">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white"
                >
                  {link.label}
                </a>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-2 sm:hidden">
                <GhostButton href="/login" size="sm">
                  Log In
                </GhostButton>
                <PrimaryButton href="/apps" size="sm">
                  Launch App
                  <ArrowRight className="size-3.5" />
                </PrimaryButton>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

export default Navbar;
