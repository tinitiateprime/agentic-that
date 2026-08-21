"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, Play, Zap } from "lucide-react";
import { TerminalMockup } from "../components/TerminalMockup.tsx";
import { GhostButton, PrimaryButton } from "../components/primitives.tsx";
import { fadeInRight, fadeInUp, staggerContainer } from "../motion-presets.ts";
import { teamTestingFullAccessEnabled } from "../../../lib/team-testing-access.js";

const TESTING_FULL_ACCESS = teamTestingFullAccessEnabled();
const TRUST_BADGES = TESTING_FULL_ACCESS
  ? ["All apps unlocked", "No testing usage quotas"]
  : ["No credit card required", "7-day free trial"];

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Background field */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(70%_50%_at_15%_0%,rgba(99,102,241,0.14),transparent_65%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(50%_45%_at_85%_10%,rgba(139,92,246,0.10),transparent_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(30,41,59,0.35)_1px,transparent_1px),linear-gradient(to_bottom,rgba(30,41,59,0.35)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(80%_60%_at_50%_0%,black,transparent)]" />
      </div>

      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:gap-12 lg:px-8 lg:py-20">
        {/* ------------------------------ Left ------------------------------ */}
        <motion.div variants={staggerContainer(0.09)} initial="hidden" animate="visible" className="min-w-0">
          <motion.div variants={fadeInUp}>
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-gradient-to-r from-indigo-500/15 to-violet-500/10 px-3 py-1.5 text-[12px] font-medium text-indigo-200 backdrop-blur-sm">
              <Zap className="size-3.5 fill-indigo-300 text-indigo-300" />
              AI-Powered Workflow Automation
            </span>
          </motion.div>

          <motion.h1
            variants={fadeInUp}
            className="mt-5 text-[2.1rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[3.3rem]"
          >
            Deploy{" "}
            <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-indigo-200 bg-clip-text text-transparent">
              Autonomous Agents
            </span>{" "}
            for Scraping, Publishing &amp; Messaging
          </motion.h1>

          <motion.p variants={fadeInUp} className="mt-5 max-w-xl text-[15px] leading-relaxed text-slate-400 sm:text-base">
            AgenticThat runs headless browser agents that extract clean, structured data from any platform — then
            schedule posts, drive outreach and track engagement from a single control plane.
          </motion.p>

          <motion.div variants={fadeInUp} className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <PrimaryButton href="/signup" className="w-full sm:w-auto">
              {TESTING_FULL_ACCESS ? "Get Full Testing Access" : "Start Free Trial"}
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </PrimaryButton>
            <GhostButton href="#pricing" className="w-full sm:w-auto">
              <Play className="size-3.5 fill-current" />
              Book Demo
            </GhostButton>
          </motion.div>

          <motion.ul variants={fadeInUp} className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
            {TRUST_BADGES.map((badge) => (
              <li key={badge} className="flex items-center gap-1.5 text-[13px] text-slate-500">
                <Check className="size-3.5 text-emerald-400" />
                {badge}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        {/* ------------------------------ Right ----------------------------- */}
        <motion.div variants={fadeInRight} initial="hidden" animate="visible" className="min-w-0 lg:pl-4">
          <TerminalMockup />
        </motion.div>
      </div>
    </section>
  );
}

export default Hero;
