"use client";

import { motion } from "framer-motion";
import { Github, Linkedin, Twitter } from "lucide-react";
import { FOOTER_COLUMNS } from "../content.ts";
import { VIEWPORT_ONCE, fadeInUp, staggerContainer } from "../motion-presets.ts";

const SOCIALS = [
  { label: "GitHub", href: "#", icon: Github },
  { label: "X", href: "#", icon: Twitter },
  { label: "LinkedIn", href: "#", icon: Linkedin },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[#1E293B] bg-white/[0.015]">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <motion.div
          variants={staggerContainer(0.07)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_ONCE}
          className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2.4fr)] lg:gap-12"
        >
          {/* Brand block */}
          <motion.div variants={fadeInUp}>
            <div className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 shadow-[0_0_12px_rgba(99,102,241,0.9)]" />
              <span className="text-[15px] font-semibold tracking-tight text-white">AgenticThat</span>
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-slate-500">
              Autonomous agents for web scraping, messaging automation, social publishing and engagement.
            </p>
            <div className="mt-5 flex items-center gap-2">
              {SOCIALS.map((social) => {
                const Icon = social.icon;
                return (
                  <a
                    key={social.label}
                    href={social.href}
                    aria-label={social.label}
                    className="inline-flex size-8 items-center justify-center rounded-md border border-[#1E293B] text-slate-500 transition-colors hover:border-indigo-500/40 hover:text-indigo-300"
                  >
                    <Icon className="size-3.5" />
                  </a>
                );
              })}
            </div>
          </motion.div>

          {/* Link columns */}
          <motion.div variants={fadeInUp} className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading}>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  {column.heading}
                </h3>
                <ul className="mt-3.5 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-[13px] text-slate-400 transition-colors hover:text-white"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </motion.div>
        </motion.div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-[#1E293B] pt-6 sm:flex-row">
          <p className="text-[12.5px] text-slate-600">
            © {new Date().getFullYear()} AgenticThat. All rights reserved.
          </p>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11.5px] font-medium text-emerald-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            All systems operational
          </span>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
