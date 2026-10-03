"use client";

import { motion, useReducedMotion } from "framer-motion";
import { PLATFORMS, type Platform } from "../content.ts";

function PlatformPill({ platform, className = "" }: { platform: Platform; className?: string }) {
  const Icon = platform.icon;
  return (
    <div
      className={`flex shrink-0 items-center gap-2.5 rounded-lg border border-[#1E293B] bg-white/[0.02] px-4 py-2.5 transition-colors hover:border-indigo-500/40 hover:bg-white/[0.05] ${className}`}
    >
      <Icon className={`size-4 ${platform.tint}`} />
      <span className="whitespace-nowrap text-[13px] font-medium text-slate-300">{platform.name}</span>
    </div>
  );
}

export function EcosystemBar() {
  const reduceMotion = useReducedMotion();
  const track = [...PLATFORMS, ...PLATFORMS];

  return (
    <section id="ecosystem" className="border-y border-[#1E293B] bg-white/[0.015]">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:gap-8 lg:px-8">
        <p className="shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
          Supported ecosystem
        </p>

        {reduceMotion ? (
          <div className="flex flex-wrap gap-2.5">
            {PLATFORMS.map((platform) => (
              <PlatformPill key={platform.name} platform={platform} />
            ))}
          </div>
        ) : (
          <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
            {/* Spacing lives on each pill (mr-2.5) rather than on the flex gap so
                that shifting by exactly -50% lands seamlessly on the second copy. */}
            <motion.div
              className="flex w-max"
              animate={{ x: ["0%", "-50%"] }}
              transition={{ duration: 26, ease: "linear", repeat: Infinity }}
            >
              {track.map((platform, index) => (
                <PlatformPill key={`${platform.name}-${index}`} platform={platform} className="mr-2.5" />
              ))}
            </motion.div>
          </div>
        )}
      </div>
    </section>
  );
}

export default EcosystemBar;
