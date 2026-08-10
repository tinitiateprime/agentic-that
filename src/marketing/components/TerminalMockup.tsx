"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Activity, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { TERMINAL_LINES, type TerminalLineKind } from "../content.ts";
import { EASE_OUT } from "../motion-presets.ts";
import { cx } from "./primitives.tsx";

const LINE_TONE: Record<TerminalLineKind, string> = {
  cmd: "text-slate-100",
  ok: "text-emerald-300",
  info: "text-slate-500",
  data: "text-cyan-300",
  warn: "text-amber-300",
};

const LINE_PREFIX: Record<TerminalLineKind, string> = {
  cmd: ">",
  ok: "✓",
  info: "·",
  data: "→",
  warn: "!",
};

const STEP_MS = 520;
const RESTART_MS = 2800;

function useStreamingLog(enabled: boolean) {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setVisible(TERMINAL_LINES.length);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    let index = 0;

    const tick = () => {
      index = index >= TERMINAL_LINES.length ? 0 : index + 1;
      setVisible(index);
      timer = setTimeout(tick, index >= TERMINAL_LINES.length ? RESTART_MS : STEP_MS);
    };

    timer = setTimeout(tick, 350);
    return () => clearTimeout(timer);
  }, [enabled]);

  return visible;
}

function StatCell({
  label,
  value,
  accent,
  icon = false,
}: {
  label: string;
  value: string;
  accent?: string;
  icon?: boolean;
}) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={cx("mt-0.5 flex items-center gap-1.5 truncate font-mono text-sm font-medium", accent ?? "text-slate-200")}>
        {icon ? <Activity className="size-3.5 shrink-0" /> : null}
        {value}
      </p>
    </div>
  );
}

/**
 * Hero visualiser: a fake agent console whose log streams in, loops, and
 * collapses to a static list when the visitor prefers reduced motion.
 */
export function TerminalMockup() {
  const reduceMotion = useReducedMotion();
  const visible = useStreamingLog(!reduceMotion);
  const lines = TERMINAL_LINES.slice(0, visible);

  return (
    <div className="relative">
      {/* Ambient glow behind the console */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[28px] bg-[radial-gradient(60%_60%_at_60%_10%,rgba(99,102,241,0.22),transparent_70%)] blur-2xl"
      />

      <div className="overflow-hidden rounded-xl border border-[#1E293B] bg-[#0D121C]/90 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl">
        {/* Title bar */}
        <div className="flex items-center gap-3 border-b border-[#1E293B] bg-white/[0.02] px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-slate-500">
            <Terminal className="size-3.5 shrink-0" />
            <span className="truncate font-mono text-[11px]">agent-runner — instagram_scraper.py</span>
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 sm:inline-flex">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
            LIVE
          </span>
        </div>

        {/* Log body */}
        <div className="h-[286px] overflow-hidden px-4 py-3.5 font-mono text-[12px] leading-relaxed sm:h-[318px] sm:text-[12.5px]">
          {lines.map((line, index) => (
            <motion.p
              key={`${line.text}-${index}`}
              initial={reduceMotion ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
              className="flex gap-2 py-[3px]"
            >
              <span className={cx("shrink-0 select-none", line.kind === "cmd" ? "text-indigo-400" : "text-slate-600")}>
                {LINE_PREFIX[line.kind]}
              </span>
              <span className={cx("min-w-0 break-words", LINE_TONE[line.kind])}>{line.text}</span>
            </motion.p>
          ))}

          {/* Blinking caret */}
          <p className="flex gap-2 py-[3px]">
            <span className="shrink-0 select-none text-indigo-400">&gt;</span>
            <span className="inline-block h-4 w-2 animate-pulse rounded-[1px] bg-indigo-400/80" />
          </p>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-4 divide-x divide-[#1E293B] border-t border-[#1E293B] bg-white/[0.02]">
          <StatCell label="Agents" value="3" icon accent="text-indigo-300" />
          <StatCell label="Profiles" value="1,420" accent="text-cyan-300" />
          <StatCell label="Runtime" value="00:42s" />
          <StatCell label="Errors" value="0" accent="text-emerald-300" />
        </div>
      </div>
    </div>
  );
}

export default TerminalMockup;
