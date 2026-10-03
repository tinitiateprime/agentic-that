"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { CAPABILITIES, type Capability } from "../content.ts";
import { Chip, SectionHeading, SectionLabel, StatusTag } from "../components/primitives.tsx";
import { VIEWPORT_ONCE, fadeInUp, staggerContainer } from "../motion-presets.ts";

function CapabilityCard({ capability }: { capability: Capability }) {
  const Icon = capability.icon;

  return (
    <motion.a
      variants={fadeInUp}
      href={capability.href}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#1E293B] bg-white/[0.02] p-5 backdrop-blur-sm transition-all duration-300 hover:border-indigo-500/50 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17] sm:p-6"
    >
      {/* Hover wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(99,102,241,0.12),transparent_70%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <div className="relative flex items-start justify-between gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-lg border border-[#1E293B] bg-gradient-to-br from-indigo-500/15 to-violet-500/10 text-indigo-300 transition-colors duration-300 group-hover:border-indigo-500/40 group-hover:text-indigo-200">
          <Icon className="size-5" />
        </span>
        <StatusTag status={capability.status} />
      </div>

      <h3 className="relative mt-4 text-[15px] font-semibold tracking-tight text-white sm:text-base">
        {capability.title}
      </h3>
      <p className="relative mt-2 text-[13.5px] leading-relaxed text-slate-400">{capability.description}</p>

      {/* `mb-5` guarantees breathing room; `mt-auto` on the footer pins the link
          to the bottom so it lines up across cards of unequal copy length. */}
      <div className="relative mt-4 mb-5 flex flex-wrap gap-1.5">
        {capability.badges.map((badge) => (
          <Chip key={badge}>{badge}</Chip>
        ))}
      </div>

      <div className="relative mt-auto flex items-center gap-1.5 border-t border-[#1E293B] pt-4 text-[13px] font-medium text-slate-400 transition-colors group-hover:text-indigo-300">
        Explore feature
        <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
      </div>
    </motion.a>
  );
}

export function Capabilities() {
  return (
    <section id="capabilities" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
      <motion.div
        variants={staggerContainer(0.06)}
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT_ONCE}
        className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between"
      >
        <motion.div variants={fadeInUp}>
          <SectionLabel>Core capabilities</SectionLabel>
          <SectionHeading
            className="mt-4"
            title="Four agents. One control plane."
            subtitle="Every agent shares the same session layer, safety governor and export pipeline — so data collected in one place is instantly usable in the next."
          />
        </motion.div>
      </motion.div>

      <motion.div
        variants={staggerContainer(0.1, 0.05)}
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT_ONCE}
        className="mt-9 grid gap-4 sm:grid-cols-2"
      >
        {CAPABILITIES.map((capability) => (
          <CapabilityCard key={capability.title} capability={capability} />
        ))}
      </motion.div>
    </section>
  );
}

export default Capabilities;
