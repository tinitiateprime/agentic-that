"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useState, type FormEvent } from "react";
import { VIEWPORT_ONCE, fadeInUp, scaleIn } from "../motion-presets.ts";
import { teamTestingFullAccessEnabled } from "../../../lib/team-testing-access.js";

const TESTING_FULL_ACCESS = teamTestingFullAccessEnabled();
const ASSURANCES = TESTING_FULL_ACCESS
  ? ["No credit card required", "All apps unlocked", "No testing usage quotas"]
  : ["No credit card required", "7-day free trial", "Cancel anytime"];

export function ClosingCta() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
  }

  return (
    <section id="pricing" className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8 lg:pb-20">
      <motion.div variants={scaleIn} initial="hidden" whileInView="visible" viewport={VIEWPORT_ONCE}>
        {/* Gradient border shell */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500/40 via-violet-500/20 to-indigo-500/40 p-px">
          <div className="relative overflow-hidden rounded-[calc(1rem-1px)] bg-[#0B0F17] px-6 py-10 sm:px-10 lg:px-12 lg:py-12">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_50%_0%,rgba(99,102,241,0.20),transparent_70%)]"
            />

            <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-12">
              <motion.div variants={fadeInUp}>
                <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-[2rem]">
                  Ship your first agent in under five minutes
                </h2>
                <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-slate-400">
                  Connect an account, pick a target, and let AgenticThat handle the sessions, scheduling and exports.
                </p>
                <ul className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
                  {ASSURANCES.map((item) => (
                    <li key={item} className="flex items-center gap-1.5 text-[13px] text-slate-500">
                      <Check className="size-3.5 text-emerald-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.div>

              <motion.div variants={fadeInUp} className="min-w-0">
                {submitted ? (
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4">
                    <Check className="size-5 shrink-0 text-emerald-400" />
                    <p className="text-[13.5px] text-emerald-200">
                      You are on the list — check <span className="font-medium">{email}</span> for your workspace link.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 sm:flex-row">
                    <label htmlFor="cta-email" className="sr-only">
                      Work email
                    </label>
                    <input
                      id="cta-email"
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@company.com"
                      className="h-11 min-w-0 flex-1 rounded-lg border border-[#1E293B] bg-white/[0.03] px-3.5 text-sm text-white placeholder:text-slate-600 transition-colors focus:border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                    />
                    <button
                      type="submit"
                      className="group inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-5 text-sm font-medium text-white shadow-[0_8px_24px_-8px_rgba(99,102,241,0.7)] transition-all duration-200 hover:from-indigo-400 hover:to-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17]"
                    >
                      {TESTING_FULL_ACCESS ? "Get Testing Access" : "Start Free Trial"}
                      <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </button>
                  </form>
                )}

                <p className="mt-3 text-center text-[12px] text-slate-600 sm:text-left">
                  Prefer a walkthrough?{" "}
                  <a
                    href="#preview"
                    className="font-medium text-slate-400 underline decoration-slate-700 underline-offset-4 transition-colors hover:text-indigo-300 hover:decoration-indigo-400"
                  >
                    Book a demo
                  </a>{" "}
                  instead.
                </p>
              </motion.div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

export default ClosingCta;
