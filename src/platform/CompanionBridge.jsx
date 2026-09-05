"use client";

import Link from "next/link";
import { CheckCircle2, Download, MonitorDown, X } from "lucide-react";
import { useState } from "react";
import { companionDownloadUrl, useCompanionStatus } from "./use-companion-status";
import styles from "./companion-bridge.module.css";

const DISMISSED_KEY = "agenticthat-companion-bridge-dismissed";

function readDismissed() {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Offers the Companion download wherever a workspace page is shown. Renders nothing while
 * the probe is still running, and nothing at all once Companion answers on this device.
 */
export function CompanionBridgeBanner({ context = "Publishing and scraping" }) {
  const { status } = useCompanionStatus();
  const [dismissed, setDismissed] = useState(() => (typeof window === "undefined" ? false : readDismissed()));

  if (status.state !== "missing" || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Dismissal is a convenience; the banner simply returns on the next visit.
    }
  };

  return (
    <div className={styles.bannerSlot}>
      <aside className={styles.banner} role="status">
        <span className={styles.bannerIcon}><MonitorDown size={20} /></span>
        <span className={styles.bannerCopy}>
          <strong>AgenticThat Companion is not running on this device</strong>
          <small>{context} run from your own computer. Install Companion once, then pair it from Connections.</small>
        </span>
        <Link className={styles.bannerAction} href={companionDownloadUrl}>
          <Download size={16} />Get Companion
        </Link>
        <button aria-label="Dismiss for this session" className={styles.bannerDismiss} onClick={dismiss} type="button">
          <X size={16} />
        </button>
      </aside>
    </div>
  );
}

/** Persistent sidebar entry so the download stays one click away on every workspace page. */
export function CompanionBridgePill() {
  const { status } = useCompanionStatus();
  if (status.state === "checking") return null;

  if (status.state === "connected") {
    return (
      <span className={`${styles.pill} ${styles.pillReady}`}>
        <CheckCircle2 size={15} />
        <span className={styles.pillCopy}>
          <strong>Companion running</strong>
          <small>{status.version ? `Version ${status.version}` : "Ready on this device"}</small>
        </span>
      </span>
    );
  }

  return (
    <Link className={styles.pill} href={companionDownloadUrl}>
      <MonitorDown size={15} />
      <span className={styles.pillCopy}>
        <strong>Install Companion</strong>
        <small>Needed to publish and scrape</small>
      </span>
    </Link>
  );
}
