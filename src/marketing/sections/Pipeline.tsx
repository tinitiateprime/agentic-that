"use client";

import { motion } from "framer-motion";
import { PIPELINE_STEPS, type PipelineStep } from "../content.ts";
import { SectionHeading, SectionLabel } from "../components/primitives.tsx";
import { VIEWPORT_ONCE, fadeInUp, staggerContainer } from "../motion-presets.ts";

function StepCard({ step, isLast }: { step: PipelineStep; isLast: boolean }) {
  const Icon = step.icon;

  return (
    <motion.li variants={fadeInUp} className="relative">
      {/* Connector — only between cards, and only once the row is side-by-side */}
      {!isLast ? (
        <span
          aria-hidden
          className="absolute right-[-1.05rem] top-[2.4rem] hidden h-px w-[2.1rem] bg-gradient-to-r from-indigo-500/50 to-transparent md:block"
        />
      ) : null}

      <div className="group h-full rounded-2xl border border-[#1E293B] bg-white/[0.02] p-5 backdrop-blur-sm transition-colors duration-300 hover:border-indigo-500/40 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-lg border border-[#1E293B] bg-gradient-to-br from-indigo-500/15 to-violet-500/10 text-indigo-300">
            <Icon className="size-5" />
          </span>
          <span className="font-mono text-2xl font-semibold text-slate-700 transition-colors duration-300 group-hover:text-indigo-500/60">
            {step.index}
          </span>
        </div>

        <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-white sm:text-base">{step.title}</h3>
        <p className="mt-2 text-[13.5px] leading-relaxed text-slate-400">{step.description}</p>
      </div>
    </motion.li>
  );
}

export function Pipeline() {
  return (
    <section id="pipeline" className="border-y border-[#1E293B] bg-white/[0.015]">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <motion.div variants={fadeInUp} initial="hidden" whileInView="visible" viewport={VIEWPORT_ONCE}>
          <SectionLabel>How it works</SectionLabel>
          <SectionHeading
            className="mt-4"
            title="From target to export in three steps"
            subtitle="No scripts to maintain and no proxies to babysit. Configure the run once and the agent handles sessions, pagination and retries."
          />
        </motion.div>

        <motion.ol
          variants={staggerContainer(0.12, 0.05)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_ONCE}
          className="mt-9 grid gap-4 md:grid-cols-3 md:gap-x-[2.1rem]"
        >
          {PIPELINE_STEPS.map((step, index) => (
            <StepCard key={step.index} step={step} isLast={index === PIPELINE_STEPS.length - 1} />
          ))}
        </motion.ol>
      </div>
    </section>
  );
}

export default Pipeline;
