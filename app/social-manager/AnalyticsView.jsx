"use client";

import { CalendarClock, ChevronDown, Download, ExternalLink, Eye, FileUp, Heart, Loader2, Search, Trash2, TrendingUp, UserPlus, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";

const RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"], ["all", "All time"]];
const PLATFORMS = [["all", "All platforms"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["youtube", "YouTube"], ["linkedin", "LinkedIn"], ["x", "X"]];
const GUIDES = [
  { id: "instagram", label: "Instagram & Facebook", steps: ["Open Meta Business Suite (business.facebook.com) and choose your account.", "Go to Insights → Content.", "Pick the date range, then Export data → CSV.", "Upload the file here. Do the same for Facebook if you post there."] },
  { id: "youtube", label: "YouTube", steps: ["Open YouTube Studio → Analytics → Advanced mode.", "Stay on the Content tab and pick the date range.", "Click the download arrow (top right) → Comma-separated values.", "Upload the .zip file it gives you, as it is."] },
  { id: "linkedin", label: "LinkedIn", steps: ["Open your company Page → Analytics → Content.", "Click Export and pick the date range.", "Upload the .xlsx file. If you get an old .xls file, save it as .xlsx first."] },
  { id: "x", label: "X", steps: ["Open X → More → Analytics (or analytics.x.com).", "Go to Content and pick the date range.", "Click Export data, then upload the CSV here."] },
];

const number = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const date = (value) => (value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const dayLabel = (value) => new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const rateText = (value) => (value === null || value === undefined ? "—" : `${value}%`);

function toCsv(posts) {
  const header = ["Published", "Platform", "Account", "Post", "Link", "Views", "Reach", "Impressions", "Likes", "Comments", "Shares", "Saves", "Clicks", "New followers", "Engagement", "Engagement rate %"];
  const rows = posts.map((post) => [post.publishedAt || "", post.platformLabel, post.account, post.text, post.permalink, post.metrics.views ?? "", post.metrics.reach ?? "", post.metrics.impressions ?? "",
    post.metrics.likes ?? "", post.metrics.comments ?? "", post.metrics.shares ?? "", post.metrics.saves ?? "", post.metrics.clicks ?? "", post.metrics.follows ?? "", post.engagement, post.engagementRate ?? ""]);
  return [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll("\"", "\"\"")}"`).join(",")).join("\r\n");
}

function Tile({ icon: Icon, label, value, note }) {
  return <article className="sm-tile"><span><Icon size={17} /></span><div><small>{label}</small><strong>{value}</strong>{note && <em>{note}</em>}</div></article>;
}

/** One series of bars with a hover tooltip and a table view. */
function Bars({ title, subtitle, data, valueLabel }) {
  const [hover, setHover] = useState(null);
  if (!data.length) return null;
  const width = 720;
  const height = 190;
  const pad = { top: 12, right: 8, bottom: 26, left: 40 };
  const max = Math.max(1, ...data.map((entry) => entry.value));
  const step = Math.max(1, Math.ceil(max / 4 / Math.pow(10, Math.floor(Math.log10(max / 4 || 1)))) * Math.pow(10, Math.floor(Math.log10(max / 4 || 1))));
  const top = step * Math.ceil(max / step);
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / data.length;
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = (value) => pad.top + plotH - (value / top) * plotH;
  const ticks = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  const labelEvery = Math.ceil(data.length / 8);
  return (
    <section className="sm-panel">
      <header className="sm-panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></header>
      <div className="sm-chart" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${data.map((entry) => `${entry.label}: ${entry.value}`).join(", ")}`}>
          {ticks.map((value) => (
            <g key={value}>
              <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} className={value === 0 ? "sm-baseline" : "sm-grid"} />
              <text x={pad.left - 8} y={y(value) + 4} textAnchor="end" className="sm-axis">{compact.format(value)}</text>
            </g>
          ))}
          {data.map((entry, index) => {
            const x = pad.left + index * slot + (slot - barW) / 2;
            const barH = entry.value ? Math.max(2, (entry.value / top) * plotH) : 0;
            const r = Math.min(4, barW / 2, barH);
            const base = pad.top + plotH;
            return (
              <g key={entry.key}>
                {barH > 0 && <path className={`sm-bar ${hover === index ? "active" : ""}`} d={`M${x},${base} V${base - barH + r} Q${x},${base - barH} ${x + r},${base - barH} H${x + barW - r} Q${x + barW},${base - barH} ${x + barW},${base - barH + r} V${base} Z`} />}
                <rect x={pad.left + index * slot} y={pad.top} width={slot} height={plotH} fill="transparent" tabIndex={0} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} aria-label={`${entry.label}: ${number.format(entry.value)} ${valueLabel}`} />
                {index % labelEvery === 0 && <text x={pad.left + index * slot + slot / 2} y={height - 8} textAnchor="middle" className="sm-axis">{entry.short || entry.label}</text>}
              </g>
            );
          })}
        </svg>
        {hover !== null && data[hover] && (
          <div className="sm-tooltip" style={{ left: `${((pad.left + hover * slot + slot / 2) / width) * 100}%` }}>
            <strong>{data[hover].label}</strong><span>{number.format(data[hover].value)} {valueLabel}{data[hover].note ? ` · ${data[hover].note}` : ""}</span>
          </div>
        )}
      </div>
      <details className="sm-table-toggle"><summary>Show as table</summary>
        <table><tbody>{data.map((entry) => <tr key={entry.key}><td>{entry.label}</td><td>{number.format(entry.value)} {valueLabel}</td></tr>)}</tbody></table>
      </details>
    </section>
  );
}

function Uploader({ onImported, compactMode }) {
  const input = useRef(null);
  const [platform, setPlatform] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [drag, setDrag] = useState(false);
  const [guide, setGuide] = useState(compactMode ? "" : "instagram");

  async function upload(file) {
    if (!file || busy) return;
    setBusy(true); setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (platform) form.append("platform", platform);
      const response = await fetch("/api/social-analytics", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The file could not be imported.");
      const label = PLATFORMS.find(([id]) => id === data.platform)?.[1] || data.platform;
      setMessage({ tone: "good", text: `Imported ${number.format(data.posts)} ${label} posts: ${number.format(data.added)} new, ${number.format(data.updated)} updated with the latest numbers.` });
      await onImported();
    } catch (error) {
      setMessage({ tone: "bad", text: error.message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className={`sm-panel sm-upload ${compactMode ? "compact" : ""}`}>
      <header className="sm-panel-head">
        <div><h2>{compactMode ? "Add newer numbers" : "Bring in your analytics"}</h2><p>Export the analytics file from each platform and drop it here. Uploading a newer export updates every post's numbers. Nothing logs in to your accounts.</p></div>
      </header>
      <div
        className={`sm-drop ${drag ? "dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(event) => { event.preventDefault(); setDrag(false); void upload(event.dataTransfer.files?.[0]); }}
      >
        {busy ? <Loader2 size={22} className="sm-spin" /> : <FileUp size={22} />}
        <div><strong>{busy ? "Reading your file…" : "Drop the export file here"}</strong><small>.csv, .xlsx, or the .zip from YouTube Studio · up to 5 MB</small></div>
        <label className="sm-select-inline">Platform
          <select value={platform} onChange={(event) => setPlatform(event.target.value)} disabled={busy}>
            <option value="">Detect automatically</option>
            {PLATFORMS.slice(1).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="sm-primary" disabled={busy} onClick={() => input.current?.click()}>Choose file</button>
        <input ref={input} type="file" accept=".csv,.xlsx,.xls,.zip,.tsv,.txt" hidden onChange={(event) => void upload(event.target.files?.[0])} />
      </div>
      {message && <p className={`sm-message ${message.tone}`} role={message.tone === "bad" ? "alert" : "status"}>{message.text}</p>}
      <div className="sm-guides">
        <span>How to export:</span>
        {GUIDES.map((entry) => <button type="button" key={entry.id} aria-expanded={guide === entry.id} className={guide === entry.id ? "active" : ""} onClick={() => setGuide(guide === entry.id ? "" : entry.id)}>{entry.label}<ChevronDown size={14} /></button>)}
      </div>
      {guide && <ol className="sm-guide-steps">{GUIDES.find((entry) => entry.id === guide).steps.map((step) => <li key={step}>{step}</li>)}</ol>}
    </section>
  );
}

export default function AnalyticsView({ initialReport }) {
  const [report, setReport] = useState(initialReport);
  const [days, setDays] = useState(initialReport.rangeDays);
  const [platform, setPlatform] = useState(initialReport.platform);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("engagement");
  const [shown, setShown] = useState(25);

  async function load(nextDays = days, nextPlatform = platform) {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/social-analytics?days=${nextDays}&platform=${nextPlatform}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Analytics could not be loaded.");
      setReport(data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function removeImport(entry) {
    if (!window.confirm(`Remove "${entry.fileName}"? Posts whose latest numbers came from this upload are removed too.`)) return;
    const response = await fetch(`/api/social-analytics/imports/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "The upload could not be removed."); return; }
    await load();
  }

  const posts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = report.posts.filter((post) => !needle || `${post.text} ${post.account}`.toLowerCase().includes(needle));
    const value = (post) => (sort === "date" ? Date.parse(post.publishedAt || 0) : sort === "views" ? post.metrics.views || post.audience : sort === "rate" ? post.engagementRate ?? -1 : post.engagement);
    return [...list].sort((a, b) => value(b) - value(a));
  }, [report.posts, query, sort]);

  const empty = report.library.totalPosts === 0;
  const { totals } = report;
  const download = () => {
    const blob = new Blob([`﻿${toCsv(posts)}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `social-analytics-${report.rangeDays}-days.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (empty) {
    return (
      <>
        <div className="sm-intro">
          <h2>See how every post performs, in one place</h2>
          <p>Views, reach, likes, comments, shares, saves and new followers for Instagram, Facebook, YouTube, LinkedIn and X, with your best posts and the best time to post. Start by uploading one export below.</p>
        </div>
        <Uploader onImported={() => load()} compactMode={false} />
      </>
    );
  }

  const audienceLabel = totals.reach ? "Reach" : totals.impressions ? "Impressions" : "Views";
  const best = report.bestTimes.bestSlots[0];
  return (
    <>
      <div className="sm-controls">
        <div className="sm-range" role="group" aria-label="Time range">
          {RANGES.map(([value, label]) => <button type="button" key={value} aria-pressed={days === value} disabled={loading} onClick={() => { setDays(value); void load(value, platform); }}>{label}</button>)}
        </div>
        <label className="sm-select-inline">Platform
          <select value={platform} onChange={(event) => { setPlatform(event.target.value); void load(days, event.target.value); }} disabled={loading}>
            {PLATFORMS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        {loading && <Loader2 size={16} className="sm-spin" />}
        <span className="sm-updated">Numbers as of your latest upload{report.library.lastUpdate ? `: ${date(report.library.lastUpdate)}` : ""}</span>
      </div>
      {error && <p className="sm-message bad" role="alert">{error}</p>}

      <section className={`sm-tiles ${loading ? "loading" : ""}`} aria-label="Summary">
        <Tile icon={CalendarClock} label="Posts" value={number.format(totals.posts)} />
        <Tile icon={Eye} label="Views" value={compact.format(totals.views)} />
        <Tile icon={Users} label={audienceLabel} value={compact.format(totals.reach || totals.impressions || totals.views)} />
        <Tile icon={Heart} label="Engagement" value={compact.format(totals.engagement)} note="likes, comments, shares, saves" />
        <Tile icon={TrendingUp} label="Engagement rate" value={rateText(totals.engagementRate)} note={`of ${audienceLabel.toLowerCase()}`} />
        <Tile icon={UserPlus} label="New followers" value={compact.format(totals.follows)} />
      </section>

      {report.hiddenByRange > 0 && (
        <p className="sm-message sm-hidden-note">
          {number.format(report.hiddenByRange)} {report.hiddenByRange === 1 ? "post was" : "posts were"} published before this range, so {report.hiddenByRange === 1 ? "it isn't" : "they aren't"} shown.
          <button type="button" className="sm-secondary" onClick={() => { setDays("all"); void load("all", platform); }}>Show all time</button>
        </p>
      )}
      {totals.posts === 0 && !report.hiddenByRange && <p className="sm-message">No posts were published in this period. Choose a longer range, or upload a newer export.</p>}

      <Bars title="Engagement per day" subtitle="Likes, comments, shares and saves on posts published each day" valueLabel="engagements"
        data={report.daily.map((day) => ({ key: day.date, label: dayLabel(day.date), value: day.engagement, note: `${day.posts} ${day.posts === 1 ? "post" : "posts"}` }))} />

      {report.platforms.length > 0 && (
        <section className="sm-panel">
          <header className="sm-panel-head"><div><h2>By platform</h2><p>How each platform did in this period</p></div></header>
          <div className="sm-table-wrap">
            <table className="sm-table">
              <thead><tr><th scope="col">Platform</th><th scope="col" className="num">Posts</th><th scope="col" className="num">Views</th><th scope="col" className="num">Reach / impressions</th><th scope="col" className="num">Engagement</th><th scope="col" className="num">Engagement rate</th><th scope="col" className="num">New followers</th></tr></thead>
              <tbody>{report.platforms.map((entry) => (
                <tr key={entry.platform}><th scope="row">{entry.label}</th><td className="num">{number.format(entry.posts)}</td><td className="num">{number.format(entry.views)}</td><td className="num">{number.format(entry.reach || entry.impressions)}</td><td className="num">{number.format(entry.engagement)}</td><td className="num">{rateText(entry.engagementRate)}</td><td className="num">{number.format(entry.follows)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      <section className="sm-panel">
        <header className="sm-panel-head"><div><h2>Best time to post</h2><p>Average engagement rate by when posts were published, in each account&apos;s own time</p></div></header>
        {best ? (
          <div className="sm-best">
            <strong>{best.weekday} {best.daypart.toLowerCase()}</strong>
            <span>Posts published then averaged {best.averageRate}% engagement ({best.posts} posts).</span>
            {report.bestTimes.bestSlots.slice(1).map((slot) => <em key={`${slot.weekday}-${slot.daypart}`}>Also good: {slot.weekday} {slot.daypart.toLowerCase()} · {slot.averageRate}%</em>)}
          </div>
        ) : <p className="sm-muted">Upload more posts to see a best time: each time slot needs at least two posts.</p>}
        <div className="sm-best-grid">
          {[...report.bestTimes.weekdays, ...report.bestTimes.dayparts].map((entry) => {
            const top = Math.max(1, ...[...report.bestTimes.weekdays, ...report.bestTimes.dayparts].map((item) => item.averageRate || 0));
            return (
              <div key={entry.label} className="sm-best-row">
                <span>{entry.label}</span>
                <i><b style={{ width: `${((entry.averageRate || 0) / top) * 100}%` }} /></i>
                <small>{entry.averageRate === null ? "—" : `${entry.averageRate}%`} · {entry.posts} {entry.posts === 1 ? "post" : "posts"}</small>
              </div>
            );
          })}
        </div>
      </section>

      <section className="sm-panel">
        <header className="sm-panel-head">
          <div><h2>Posts</h2><p>{number.format(posts.length)} posts · top 3 by engagement are marked</p></div>
          <div className="sm-filters">
            <label className="sm-search"><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setShown(25); }} placeholder="Search posts" aria-label="Search posts" /></label>
            <label className="sm-select-inline">Sort by
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="engagement">Engagement</option><option value="views">Views / reach</option><option value="rate">Engagement rate</option><option value="date">Newest</option>
              </select>
            </label>
            <button type="button" className="sm-secondary" onClick={download}><Download size={15} />Download CSV</button>
          </div>
        </header>
        <div className="sm-table-wrap">
          <table className="sm-table sm-posts">
            <thead><tr><th scope="col">Post</th><th scope="col">Published</th><th scope="col" className="num">Views / reach</th><th scope="col" className="num">Likes</th><th scope="col" className="num">Comments</th><th scope="col" className="num">Shares</th><th scope="col" className="num">Saves</th><th scope="col" className="num">Rate</th></tr></thead>
            <tbody>{posts.slice(0, shown).map((post) => {
              const rank = report.topPosts.findIndex((item) => item.id === post.id);
              return (
                <tr key={post.id}>
                  <th scope="row">
                    <span className="sm-post">
                      <strong>{rank >= 0 && rank < 3 && <em className="sm-rank">#{rank + 1}</em>}{post.platformLabel}{post.account ? ` · ${post.account}` : ""}{post.type ? ` · ${post.type}` : ""}</strong>
                      <span>{post.text || <i>No text in the export</i>}</span>
                      {post.permalink && <a href={post.permalink} target="_blank" rel="noreferrer">Open post <ExternalLink size={12} /></a>}
                    </span>
                  </th>
                  <td>{date(post.publishedAt)}</td>
                  <td className="num">{number.format(post.metrics.views ?? post.audience)}</td>
                  <td className="num">{number.format(post.metrics.likes ?? 0)}</td>
                  <td className="num">{number.format(post.metrics.comments ?? 0)}</td>
                  <td className="num">{number.format(post.metrics.shares ?? 0)}</td>
                  <td className="num">{number.format(post.metrics.saves ?? 0)}</td>
                  <td className="num">{rateText(post.engagementRate)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        {shown < posts.length && <button type="button" className="sm-more" onClick={() => setShown(shown + 25)}>Show more ({number.format(posts.length - shown)} left)</button>}
      </section>

      <Uploader onImported={() => load()} compactMode />

      {report.imports.length > 0 && (
        <section className="sm-panel">
          <header className="sm-panel-head"><div><h2>Uploads</h2><p>Every file brought in, newest first</p></div></header>
          <ul className="sm-imports">
            {report.imports.map((entry) => (
              <li key={entry.id}>
                <span><strong>{entry.fileName}</strong><small>{entry.platformLabel} · {number.format(entry.posts)} posts · {date(entry.at)}{entry.importedBy ? ` · by ${entry.importedBy}` : ""}</small></span>
                <button type="button" className="sm-icon" onClick={() => void removeImport(entry)} aria-label={`Remove ${entry.fileName}`}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
