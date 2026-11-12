"use client";

import { Cpu, Download, Loader2, MonitorDown, Sparkles } from "lucide-react";
import Link from "next/link";
import styles from "./social-seo.module.css";

function formatGb(bytes) {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** Shows whether the free local AI in the Companion is available, and sets it up once. */
export default function AiStatusBar({ status, tierChoice, onTierChange, onInstall, installing }) {
  if (status === undefined) {
    return <div className={styles.aiBar}><Loader2 size={16} className={styles.spin} /> Checking for the free AI on this computer…</div>;
  }

  if (status === null) {
    return (
      <div className={`${styles.aiBar} ${styles.aiBarMuted}`}>
        <MonitorDown size={18} />
        <div>
          <strong>Get free AI for every post</strong>
          <span>Open the AgenticThat Companion to write captions, hashtags and alt text for Instagram, Facebook, LinkedIn and YouTube from your photo or video. Until then, basic Instagram SEO is used.</span>
        </div>
        <Link className={styles.secondaryButton} href="/companion/download">Get the Companion</Link>
      </div>
    );
  }

  if (status.phase === "unsupported") {
    return <div className={`${styles.aiBar} ${styles.aiBarMuted}`}><Cpu size={18} /> Free AI is not available for this computer type yet. Basic Instagram SEO is used.</div>;
  }

  if (status.phase === "downloading") {
    const progress = status.progress;
    const percent = progress ? Math.min(100, Math.round((progress.overallReceived / progress.overallTotal) * 100)) : 0;
    return (
      <div className={styles.aiBar}>
        <Download size={18} />
        <div className={styles.aiBarGrow}>
          <strong>Setting up the free AI… {percent}%</strong>
          <span>{progress ? `${formatGb(progress.overallReceived)} of ${formatGb(progress.overallTotal)} · one-time download` : "Starting the download…"}</span>
          <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${percent}%` }} /></div>
        </div>
      </div>
    );
  }

  if (status.phase === "not-installed" || status.phase === "error") {
    const selected = status.tiers.find((tier) => tier.id === tierChoice) || status.tiers[0];
    return (
      <div className={styles.aiBar}>
        <Sparkles size={18} />
        <div className={styles.aiBarGrow}>
          <strong>Turn on free AI for your posts</strong>
          <span>Runs on this computer: no cost, no limits, and your media never leaves it. One-time download of {selected.downloadGb} GB.</span>
          {status.phase === "error" && status.error && <span className={styles.aiError}>{status.error}</span>}
          <div className={styles.tierRow}>
            {status.tiers.map((tier) => (
              <label key={tier.id} className={tier.id === selected.id ? styles.tierOn : styles.tierOff}>
                <input type="radio" name="ai-tier" checked={tier.id === selected.id} onChange={() => onTierChange(tier.id)} />
                <span>
                  <strong>{tier.label}{tier.id === status.recommendedTier ? " · Recommended" : ""}</strong>
                  <small>{tier.description} {tier.downloadGb} GB · needs {tier.minimumRamGb} GB memory{status.memoryGb < tier.minimumRamGb ? " (more than this computer has)" : ""}.</small>
                </span>
              </label>
            ))}
          </div>
          <small className={styles.aiLicence}>
            The model is open-source ({selected.licence}). <a href={selected.licenceUrl} target="_blank" rel="noreferrer">Licence</a>
          </small>
        </div>
        <button type="button" className={styles.primaryButtonSmall} onClick={() => onInstall(selected.id)} disabled={installing}>
          {installing ? <Loader2 size={16} className={styles.spin} /> : <Download size={16} />}
          Set up free AI
        </button>
      </div>
    );
  }

  return (
    <div className={`${styles.aiBar} ${styles.aiBarReady}`}>
      <Sparkles size={18} />
      <div>
        <strong>Free AI is ready · {status.tier?.label}</strong>
        <span>Your photo or video is studied on this computer. A description is optional.</span>
      </div>
    </div>
  );
}
