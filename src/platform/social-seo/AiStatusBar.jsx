"use client";

import { AppWindow, CheckCircle2, Loader2, LogIn, MonitorDown, Unplug } from "lucide-react";
import Link from "next/link";
import styles from "./social-seo.module.css";

const STATE_TEXT = {
  connected: "Connected",
  "not-connected": "Not connected",
  connecting: "Waiting for you to log in…",
  "needs-you": "Needs you",
  working: "Writing…",
};

/** The official logo of each AI app the user can connect. */
export function AiLogo({ id, size = 28 }) {
  return <img className={styles.aiLogo} src={`/ai-logos/${id}.svg`} alt="" width={size} height={size} />;
}

/** The user's AI accounts in the Companion: connect ChatGPT, Claude or Gemini once, by logging in. */
export default function AiStatusBar({ status, onConnect, onDisconnect, onShow, busy }) {
  if (status === undefined) {
    return <div className={styles.accounts}><p className={styles.accountsNote}><Loader2 size={16} className={styles.spin} /> Looking for the AgenticThat Companion on this computer…</p></div>;
  }

  if (status === null) {
    return (
      <div className={`${styles.accounts} ${styles.accountsMuted}`}>
        <div className={styles.accountsIntro}>
          <MonitorDown size={20} />
          <div>
            <strong>Write with your ChatGPT, Claude or Gemini</strong>
            <span>Open the AgenticThat Companion and log in to the AI apps you use. Until then, basic Instagram SEO is used.</span>
          </div>
        </div>
        <div className={styles.accountsLogos} aria-hidden="true">{["chatgpt", "claude", "gemini"].map((id) => <AiLogo key={id} id={id} size={26} />)}</div>
        <Link className={styles.secondaryButton} href="/companion/download">Get the Companion</Link>
      </div>
    );
  }

  if (!status.browserAvailable) {
    return (
      <div className={`${styles.accounts} ${styles.accountsMuted}`}>
        <div className={styles.accountsIntro}>
          <AppWindow size={20} />
          <div>
            <strong>Google Chrome or Microsoft Edge is needed</strong>
            <span>The Companion opens your AI apps in Chrome or Edge so you can log in safely, including with Google. Install one, restart the Companion and refresh this page.</span>
          </div>
        </div>
      </div>
    );
  }

  const connected = status.providers.filter((provider) => provider.connected);
  return (
    <section className={styles.accounts} aria-label="Your AI accounts">
      <div className={styles.accountsIntro}>
        <div>
          <strong>{connected.length ? "Your AI accounts" : "Connect your AI"}</strong>
          <span>
            {connected.length
              ? "Each connected AI writes its own version of your post, so you can pick the best."
              : `Log in once to ChatGPT, Claude or Gemini (Google, Microsoft, Apple or email). It opens in ${status.browserName} on this computer and stays remembered.`}
          </span>
        </div>
      </div>
      <div className={styles.providerRow}>
        {status.providers.map((provider) => {
          const acting = busy === provider.id;
          const waiting = provider.state === "connecting" || provider.state === "needs-you";
          return (
            <div key={provider.id} className={`${styles.providerCard} ${provider.connected ? styles.providerOn : ""} ${waiting ? styles.providerWaiting : ""}`}>
              <AiLogo id={provider.id} />
              <div className={styles.providerCopy}>
                <strong>{provider.label}</strong>
                <small>
                  {provider.connected && provider.state === "connected" && <CheckCircle2 size={12} />} {STATE_TEXT[provider.state] || provider.state}
                </small>
              </div>
              {waiting && (
                <button type="button" className={styles.copyButton} onClick={() => onShow(provider.id)} title={provider.detail}>
                  <AppWindow size={14} /> Show
                </button>
              )}
              {!provider.connected && !waiting && (
                <button type="button" className={styles.primaryButtonSmall} onClick={() => onConnect(provider.id)} disabled={acting}>
                  {acting ? <Loader2 size={14} className={styles.spin} /> : <LogIn size={14} />} Connect
                </button>
              )}
              {provider.connected && !waiting && (
                <button type="button" className={styles.iconButton} onClick={() => onDisconnect(provider.id)} disabled={acting} title={`Disconnect ${provider.label}`} aria-label={`Disconnect ${provider.label}`}>
                  {acting ? <Loader2 size={14} className={styles.spin} /> : <Unplug size={15} />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
