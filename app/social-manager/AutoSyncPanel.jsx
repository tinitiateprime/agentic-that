"use client";

import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const PLACEHOLDERS = {
  instagram: "https://www.instagram.com/yourcompany/",
  facebook: "https://www.facebook.com/yourcompany",
};

function ago(value) {
  if (!value) return "";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function SourceStatus({ source, companion }) {
  if (!source.enabled) return source.profileUrl ? <span className="sm-sync-state">Off</span> : null;
  if (source.status === "queued") {
    return <span className="sm-sync-state"><Loader2 size={14} className="sm-spin" />{companion === "online" ? "Starting on your Companion…" : "Waiting for your Companion to come online."}</span>;
  }
  if (source.status === "running") return <span className="sm-sync-state"><Loader2 size={14} className="sm-spin" />Collecting your posts…</span>;
  if (source.status === "failed") return <span className="sm-sync-state bad"><CircleAlert size={14} />{source.message}</span>;
  if (source.status === "synced") {
    return <span className="sm-sync-state good"><CheckCircle2 size={14} />Updated {ago(source.lastSyncedAt)}. {source.message}</span>;
  }
  return null;
}

function SourceRow({ source, companion, busy, onSave }) {
  const [value, setValue] = useState(source.profileUrl);
  useEffect(() => setValue(source.profileUrl), [source.profileUrl]);
  const saved = source.enabled && source.profileUrl && value.trim() === source.profileUrl;
  return (
    <div className="sm-sync-row">
      <label htmlFor={`sync-${source.platform}`}>{source.label}</label>
      <form onSubmit={(event) => { event.preventDefault(); onSave(source.platform, value); }}>
        <input id={`sync-${source.platform}`} value={value} onChange={(event) => setValue(event.target.value)} placeholder={PLACEHOLDERS[source.platform]} inputMode="url" autoComplete="off" spellCheck={false} />
        {!saved && <button type="submit" className="sm-primary" disabled={busy || !value.trim()}>{source.profileUrl ? "Save" : "Turn on"}</button>}
        {saved && <button type="button" className="sm-secondary" disabled={busy} onClick={() => onSave(source.platform, value, false)}>Turn off</button>}
      </form>
      <SourceStatus source={source} companion={companion} />
    </div>
  );
}

/**
 * Automatic nightly updates for the company's own Instagram and Facebook,
 * collected by the paired Companion. Hidden when the site's database doesn't
 * have automatic updates yet (autoSync is null).
 */
export default function AutoSyncPanel({ autoSync: initial, onSynced }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lastSynced = useRef(initial?.sources.map((source) => source.lastSyncedAt).join("|"));
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  useEffect(() => setState(initial), [initial]);

  const pending = state?.sources.some((source) => source.enabled && ["queued", "running"].includes(source.status));
  // While an update is waiting or running, check every 15 seconds and
  // refresh the numbers once it lands.
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(async () => {
      const response = await fetch("/api/social-analytics/sync").catch(() => null);
      const data = await response?.json().catch(() => null);
      if (!data?.autoSync) return;
      setState(data.autoSync);
      const synced = data.autoSync.sources.map((source) => source.lastSyncedAt).join("|");
      if (synced !== lastSynced.current) { lastSynced.current = synced; onSyncedRef.current?.(); }
    }, 15000);
    return () => clearInterval(timer);
  }, [pending]);

  if (!state) return null;

  async function send(body) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/social-analytics/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "That didn't save. Try again.");
      setState(data.autoSync);
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  }

  const save = (platform, profileUrl, enabled = true) => send({ action: "save", platform, profileUrl, enabled, timezoneOffsetMinutes: new Date().getTimezoneOffset() });
  const anyOn = state.sources.some((source) => source.enabled);
  const companion = state.companion.status;

  return (
    <section className="sm-panel sm-sync" aria-label="Automatic updates">
      <header className="sm-panel-head">
        <div>
          <h2>Automatic updates</h2>
          <p>Paste your own profile links once. Every night your Companion collects the likes, comments and views of your latest 50 posts, with nothing to download. Reach, impressions and saves still come from the export files.</p>
        </div>
        {anyOn && (
          <button type="button" className="sm-secondary" disabled={busy || pending} onClick={() => void send({ action: "run" })}>
            <RefreshCw size={15} />Update now
          </button>
        )}
      </header>
      <p className={`sm-sync-companion ${companion}`}>
        {companion === "online" && "Your Companion is online."}
        {companion === "offline" && "Your Companion is offline. Updates run as soon as a computer with the Companion is on."}
        {companion === "unpaired" && <>No Companion is paired with this company yet. <a href="/config-manager">Pair it in Config Manager</a> to turn on automatic updates.</>}
      </p>
      {state.sources.map((source) => <SourceRow key={source.platform} source={source} companion={companion} busy={busy} onSave={(platform, value, enabled) => void save(platform, value, enabled)} />)}
      {error && <p className="sm-message bad" role="alert">{error}</p>}
    </section>
  );
}
