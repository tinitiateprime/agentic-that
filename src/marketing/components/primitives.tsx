"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import type { CapabilityStatus } from "../content.ts";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  size?: "sm" | "md";
};

const SIZES = {
  sm: "h-9 px-3.5 text-[13px]",
  md: "h-11 px-5 text-sm",
} as const;

/** Filled indigo→violet CTA. */
export function PrimaryButton({ children, className, size = "md", ...rest }: ButtonLinkProps) {
  return (
    <a
      {...rest}
      className={cx(
        "group inline-flex items-center justify-center gap-1.5 rounded-lg font-medium text-white",
        "bg-gradient-to-r from-indigo-500 to-violet-500",
        "shadow-[0_0_0_1px_rgba(99,102,241,0.4),0_8px_24px_-8px_rgba(99,102,241,0.7)]",
        "transition-all duration-200 hover:from-indigo-400 hover:to-violet-400",
        "hover:shadow-[0_0_0_1px_rgba(129,140,248,0.6),0_10px_30px_-8px_rgba(99,102,241,0.9)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17]",
        SIZES[size],
        className,
      )}
    >
      {children}
    </a>
  );
}

/** Bordered, translucent secondary action. */
export function GhostButton({ children, className, size = "md", ...rest }: ButtonLinkProps) {
  return (
    <a
      {...rest}
      className={cx(
        "group inline-flex items-center justify-center gap-1.5 rounded-lg font-medium text-slate-200",
        "border border-[#1E293B] bg-white/[0.03] backdrop-blur-sm",
        "transition-all duration-200 hover:border-slate-600 hover:bg-white/[0.06] hover:text-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17]",
        SIZES[size],
        className,
      )}
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Tags & chips                                                        */
/* ------------------------------------------------------------------ */

export function StatusTag({ status }: { status: CapabilityStatus }) {
  const active = status === "Active";
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide",
        active
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-slate-600/40 bg-slate-500/10 text-slate-400",
      )}
    >
      <span
        className={cx(
          "size-1.5 rounded-full",
          active ? "animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" : "bg-slate-500",
        )}
      />
      {status}
    </span>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-[#1E293B] bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors group-hover:border-indigo-500/25 group-hover:text-slate-300">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Section headings                                                    */
/* ------------------------------------------------------------------ */

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#1E293B] bg-white/[0.03] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-indigo-300">
      {children}
    </span>
  );
}

export function SectionHeading({
  title,
  subtitle,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("max-w-2xl", className)}>
      <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-[2rem]">{title}</h2>
      {subtitle ? <p className="mt-3 text-[15px] leading-relaxed text-slate-400">{subtitle}</p> : null}
    </div>
  );
}
