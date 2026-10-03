"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PREVIEW_TABS, SAMPLE_JSON, SAMPLE_PROFILES, type PreviewTabId } from "../content.ts";
import { SectionHeading, SectionLabel, cx } from "../components/primitives.tsx";
import { EASE_OUT, VIEWPORT_ONCE, fadeInUp } from "../motion-presets.ts";

/* ------------------------------------------------------------------ */
/* JSON highlighting                                                   */
/* ------------------------------------------------------------------ */

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;

/** Minimal tokeniser — enough to colour keys, strings, numbers and literals. */
function highlightJson(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  JSON_TOKEN.lastIndex = 0;
  while ((match = JSON_TOKEN.exec(source)) !== null) {
    const [full, quoted, colon, literal, numeric] = match;

    if (match.index > cursor) {
      nodes.push(
        <span key={key++} className="text-slate-600">
          {source.slice(cursor, match.index)}
        </span>,
      );
    }

    if (quoted && colon) {
      nodes.push(
        <span key={key++} className="text-indigo-300">
          {quoted}
        </span>,
        <span key={key++} className="text-slate-600">
          {colon}
        </span>,
      );
    } else if (quoted) {
      nodes.push(
        <span key={key++} className="text-emerald-300">
          {quoted}
        </span>,
      );
    } else if (literal) {
      nodes.push(
        <span key={key++} className="text-violet-300">
          {literal}
        </span>,
      );
    } else if (numeric) {
      nodes.push(
        <span key={key++} className="text-amber-300">
          {numeric}
        </span>,
      );
    }

    cursor = match.index + full.length;
  }

  if (cursor < source.length) {
    nodes.push(
      <span key={key++} className="text-slate-600">
        {source.slice(cursor)}
      </span>,
    );
  }

  return nodes;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function JsonView() {
  return (
    <pre className="h-full overflow-auto px-4 py-4 font-mono text-[12px] leading-[1.65] sm:px-5 sm:text-[12.5px]">
      <code>{highlightJson(SAMPLE_JSON)}</code>
    </pre>
  );
}

function TableView() {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
        <thead className="sticky top-0 bg-[#0D121C]">
          <tr className="border-b border-[#1E293B]">
            {["Username", "Followers", "Engagement", "Category", "Status"].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="whitespace-nowrap px-4 py-3 text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SAMPLE_PROFILES.map((profile) => (
            <tr
              key={profile.username}
              className="border-b border-[#1E293B]/70 transition-colors last:border-0 hover:bg-white/[0.03]"
            >
              <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-200">{profile.username}</td>
              <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-300">{profile.followers}</td>
              <td className="whitespace-nowrap px-4 py-3 tabular-nums text-cyan-300">{profile.engagement}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-400">{profile.category}</td>
              <td className="whitespace-nowrap px-4 py-3">
                <span
                  className={cx(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    profile.status === "Verified"
                      ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
                      : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
                  )}
                >
                  {profile.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

export function DataPreview() {
  const [tab, setTab] = useState<PreviewTabId>("json");
  const [copied, setCopied] = useState(false);

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(SAMPLE_JSON);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard unavailable (insecure origin or denied) — fail quietly. */
    }
  }

  return (
    <section id="preview" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-12">
        <motion.div variants={fadeInUp} initial="hidden" whileInView="visible" viewport={VIEWPORT_ONCE}>
          <SectionLabel>Live output</SectionLabel>
          <SectionHeading
            className="mt-4"
            title="Structured data, ready the moment the run ends"
            subtitle="Every run emits the same normalised schema. Read it as JSON, browse it as a table, or stream it straight into your warehouse."
          />
          <dl className="mt-7 grid grid-cols-2 gap-4 sm:max-w-md">
            {[
              { label: "Fields normalised", value: "38" },
              { label: "Avg. run time", value: "42s" },
              { label: "Duplicate rate", value: "0.0%" },
              { label: "Export formats", value: "JSON · CSV" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-[#1E293B] bg-white/[0.02] px-4 py-3">
                <dt className="text-[11px] uppercase tracking-[0.1em] text-slate-500">{stat.label}</dt>
                <dd className="mt-1 font-mono text-[15px] font-medium text-white">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </motion.div>

        <motion.div
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_ONCE}
          className="min-w-0"
        >
          <div className="overflow-hidden rounded-xl border border-[#1E293B] bg-[#0D121C]/90 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl">
            {/* Tab bar */}
            <div className="flex items-center justify-between gap-3 border-b border-[#1E293B] bg-white/[0.02] px-3 py-2">
              <div role="tablist" aria-label="Data preview format" className="flex items-center gap-1">
                {PREVIEW_TABS.map((item) => {
                  const Icon = item.icon;
                  const selected = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      id={`preview-tab-${item.id}`}
                      aria-selected={selected}
                      aria-controls={`preview-panel-${item.id}`}
                      onClick={() => setTab(item.id)}
                      className={cx(
                        "relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                        selected ? "text-white" : "text-slate-500 hover:text-slate-300",
                      )}
                    >
                      {selected ? (
                        <motion.span
                          layoutId="preview-tab-pill"
                          className="absolute inset-0 rounded-md border border-indigo-500/30 bg-indigo-500/10"
                          transition={{ duration: 0.25, ease: EASE_OUT }}
                        />
                      ) : null}
                      <Icon className="relative size-3.5" />
                      <span className="relative">{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={copyPayload}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#1E293B] px-2.5 py-1.5 text-[11.5px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
              >
                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>

            {/* Panel */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                id={`preview-panel-${tab}`}
                role="tabpanel"
                aria-labelledby={`preview-tab-${tab}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: EASE_OUT }}
                /* Fixed height keeps the card from jumping when tabs swap. */
                className="h-[300px] sm:h-[330px]"
              >
                {tab === "json" ? <JsonView /> : <TableView />}
              </motion.div>
            </AnimatePresence>

            {/* Footer strip */}
            <div className="flex items-center justify-between gap-3 border-t border-[#1E293B] bg-white/[0.02] px-4 py-2.5">
              <span className="font-mono text-[11px] text-slate-500">run_8f21c4 · 1,420 records</span>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400">
                <Download className="size-3.5" />
                profiles_2026-08-10.json
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default DataPreview;
