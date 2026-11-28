"use client";

import { AtSign, CalendarClock, CheckCircle2, Clock3, ExternalLink, FileText, Film, ImageIcon, MessagesSquare, Search, TriangleAlert, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import PlatformLogo from "@platform/PlatformLogo";

const PAGE = 30;
const number = new Intl.NumberFormat();

export function fullDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleString([], {
    day: "numeric", month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function toCsv(header, rows) {
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll("\"", "\"\"")}"`).join(","))
    .join("\r\n");
}

export function downloadCsv(fileName, text) {
  const blob = new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

const POST_STATES = {
  published: { label: "Published", icon: CheckCircle2, tone: "completed", time: "Published" },
  failed: { label: "Failed", icon: TriangleAlert, tone: "failed", time: "Failed" },
  scheduled: { label: "Scheduled", icon: CalendarClock, tone: "scheduled", time: "Scheduled for" },
  waiting: { label: "Waiting", icon: Clock3, tone: "in_progress", time: "Created" },
};
const SCAN_STATES = {
  completed: { label: "Done", icon: CheckCircle2, tone: "completed" },
  failed: { label: "Failed", icon: TriangleAlert, tone: "failed" },
  in_progress: { label: "Running", icon: Clock3, tone: "in_progress" },
};

export const postCsv = (posts) => toCsv(
  ["When", "Status", "Platform", "Account", "Created by", "Title", "Caption", "Created", "Scheduled for", "Published", "Failure reason"],
  posts.map((post) => [post.at, POST_STATES[post.state].label, post.platformLabel, post.account, post.createdBy, post.title, post.caption,
    post.createdAt, post.scheduledAt, post.publishedAt, post.failureReason]),
);
export const scanCsv = (scans) => toCsv(
  ["When", "Status", "Platform", "Type", "Search", "Results", "Run by", "Finished", "Error"],
  scans.map((scan) => [scan.at, SCAN_STATES[scan.state].label, scan.platformLabel, scan.mode, scan.query, scan.results ?? "", scan.createdBy, scan.finishedAt, scan.error]),
);
export const messageCsv = (messages) => toCsv(
  ["Sent", "Group", "Sent by", "Message", "Apps"],
  messages.map((message) => [message.at, message.group, message.createdBy, message.text,
    message.apps.map((app) => `${app.label}: ${app.state}${app.error ? ` (${app.error})` : ""}`).join("; ")]),
);

function StatePill({ state }) {
  const Icon = state.icon;
  return <span className={`report-outcome ${state.tone}`}><Icon size={13} />{state.label}</span>;
}

function Select({ label, value, onChange, options }) {
  return (
    <label>{label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function peopleOptions(items) {
  const seen = new Map();
  for (const item of items) seen.set(item.userId || `name:${item.createdBy}`, item.createdBy);
  return [{ value: "all", label: "Everyone" }, ...[...seen].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
}
const personKey = (item) => item.userId || `name:${item.createdBy}`;

function Empty({ icon: Icon, title, text }) {
  return <div className="report-empty"><Icon size={20} /><span><strong>{title}</strong><small>{text}</small></span></div>;
}

function MoreButton({ shown, total, onMore }) {
  if (shown >= total) return null;
  return <button type="button" className="report-more" onClick={onMore}>Show more ({number.format(total - shown)} left)</button>;
}

// ---- Social posts ------------------------------------------------------------------------------

function PostThumb({ post }) {
  const [broken, setBroken] = useState(false);
  const Icon = post.format === "video" ? Film : post.format === "image" ? ImageIcon : FileText;
  return (
    <span className="report-thumb-wrap">
      {post.preview && !broken
        ? <img className="report-thumb" src={post.preview} alt="" loading="lazy" onError={() => setBroken(true)} />
        : <span className="report-thumb placeholder" aria-hidden="true"><Icon size={22} /></span>}
      <span className="report-thumb-platform"><PlatformLogo platform={post.platform} size={16} /></span>
    </span>
  );
}

// A long caption shows three lines, with a toggle for the rest.
function Caption({ post }) {
  const [open, setOpen] = useState(false);
  const text = post.caption || (post.format === "text" ? "No text" : `${post.format === "video" ? "Video" : "Picture"} without a caption`);
  const long = (post.caption || "").length > 220;
  return (
    <>
      <p className={`report-caption ${post.caption ? "" : "muted"} ${long && !open ? "clamped" : ""}`}>{text}</p>
      {long && <button type="button" className="report-caption-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Show less" : "Show more"}</button>}
    </>
  );
}

export function PostsReport({ posts, platforms, filteredRef }) {
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [state, setState] = useState("all");
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return posts.filter((post) =>
      (person === "all" || personKey(post) === person)
      && (platform === "all" || post.platform === platform)
      && (state === "all" || post.state === state)
      && (!text || `${post.title} ${post.caption} ${post.account}`.toLowerCase().includes(text)));
  }, [posts, query, person, platform, state]);
  if (filteredRef) filteredRef.current = filtered;

  return (
    <>
      {platforms.length > 0 && (
        <section className="report-platforms" aria-label="Posts by platform">
          {platforms.map((entry) => (
            <button type="button" key={entry.platform} className={platform === entry.platform ? "selected" : ""} aria-pressed={platform === entry.platform}
              onClick={() => { setPlatform(platform === entry.platform ? "all" : entry.platform); setShown(PAGE); }}>
              <span className="report-platform-name"><PlatformLogo platform={entry.platform} label={entry.label} size={22} /><strong>{entry.label}</strong></span>
              <span className="report-platform-total">{number.format(entry.total)} {entry.total === 1 ? "post" : "posts"}</span>
              <span className="report-platform-split">
                <em className="completed">{entry.published} published</em>
                {entry.failed > 0 && <em className="failed">{entry.failed} failed</em>}
                {entry.scheduled > 0 && <em className="scheduled">{entry.scheduled} scheduled</em>}
                {entry.waiting > 0 && <em className="in_progress">{entry.waiting} waiting</em>}
              </span>
            </button>
          ))}
        </section>
      )}

      <section className="report-panel">
        <header className="report-panel-head">
          <div><h2>Published and scheduled posts</h2><p>{number.format(filtered.length)} of {number.format(posts.length)} posts</p></div>
          <div className="report-filters">
            <label className="report-search">Search
              <span><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setShown(PAGE); }} placeholder="Caption, title or account" /></span>
            </label>
            <Select label="Person" value={person} onChange={(value) => { setPerson(value); setShown(PAGE); }} options={peopleOptions(posts)} />
            <Select label="Platform" value={platform} onChange={(value) => { setPlatform(value); setShown(PAGE); }}
              options={[{ value: "all", label: "All platforms" }, ...platforms.map((entry) => ({ value: entry.platform, label: entry.label }))]} />
            <Select label="Status" value={state} onChange={(value) => { setState(value); setShown(PAGE); }}
              options={[{ value: "all", label: "Any status" }, ...Object.entries(POST_STATES).map(([value, entry]) => ({ value, label: entry.label }))]} />
          </div>
        </header>
        {filtered.length ? (
          <ol className="report-posts">
            {filtered.slice(0, shown).map((post) => {
              const status = POST_STATES[post.state];
              return (
                <li key={post.id}>
                  <PostThumb post={post} />
                  <div className="report-post-body">
                    {post.title && <strong className="report-post-title">{post.title}</strong>}
                    <Caption post={post} />
                    <div className="report-post-meta">
                      <span className={`report-chip platform ${post.platform}`}><PlatformLogo platform={post.platform} size={14} />{post.platformLabel}</span>
                      {post.account && <span className="report-chip account" title="The account it was posted on"><AtSign size={13} />{post.account}</span>}
                      <span className="report-chip person" title="Who created it"><UserRound size={13} />by {post.createdBy}</span>
                    </div>
                    {post.failureReason && <small className="report-detail failed">{post.failureReason}</small>}
                  </div>
                  <div className="report-post-side">
                    <StatePill state={status} />
                    <time dateTime={post.at}>{status.time} {fullDate(post.at)}</time>
                    {post.link && (
                      <a className="report-open" href={post.link} target="_blank" rel="noopener noreferrer"
                        title={post.linkKind === "post" ? `Open this post on ${post.platformLabel}` : `This post's exact link isn't known yet; open ${post.account || "the account"} on ${post.platformLabel}`}>
                        {post.linkKind === "post" ? "Open post" : `Open on ${post.platformLabel}`}<ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <Empty icon={ImageIcon} title="No posts" text="Nothing matches these filters in the selected period." />}
        <MoreButton shown={shown} total={filtered.length} onMore={() => setShown(shown + PAGE)} />
      </section>
    </>
  );
}

// ---- Research scans ----------------------------------------------------------------------------

export function ScansReport({ scans, filteredRef }) {
  const [person, setPerson] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [state, setState] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const platforms = useMemo(() => [...new Map(scans.map((scan) => [scan.platform, scan.platformLabel]))], [scans]);
  const filtered = useMemo(() => scans.filter((scan) =>
    (person === "all" || personKey(scan) === person)
    && (platform === "all" || scan.platform === platform)
    && (state === "all" || scan.state === state)), [scans, person, platform, state]);
  if (filteredRef) filteredRef.current = filtered;
  const found = filtered.reduce((sum, scan) => sum + (scan.results || 0), 0);

  return (
    <section className="report-panel">
      <header className="report-panel-head">
        <div><h2>Research scans</h2><p>{number.format(filtered.length)} scans · {number.format(found)} results found</p></div>
        <div className="report-filters">
          <Select label="Person" value={person} onChange={(value) => { setPerson(value); setShown(PAGE); }} options={peopleOptions(scans)} />
          <Select label="Platform" value={platform} onChange={(value) => { setPlatform(value); setShown(PAGE); }}
            options={[{ value: "all", label: "All platforms" }, ...platforms.map(([value, label]) => ({ value, label }))]} />
          <Select label="Status" value={state} onChange={(value) => { setState(value); setShown(PAGE); }}
            options={[{ value: "all", label: "Any status" }, ...Object.entries(SCAN_STATES).map(([value, entry]) => ({ value, label: entry.label }))]} />
        </div>
      </header>
      {filtered.length ? (
        <div className="report-table-wrap">
          <table className="report-people report-scans">
            <thead><tr><th scope="col">When</th><th scope="col">Run by</th><th scope="col">Platform</th><th scope="col">Type</th><th scope="col">Searched for</th><th scope="col" className="num">Results</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {filtered.slice(0, shown).map((scan) => (
                <tr key={scan.id}>
                  <td>{fullDate(scan.at)}</td>
                  <td><span className="report-chip person"><UserRound size={13} />{scan.createdBy}</span></td>
                  <td><span className="report-platform-cell"><PlatformLogo platform={scan.platform} label={scan.platformLabel} size={16} />{scan.platformLabel}</span></td>
                  <td>{scan.mode}</td>
                  <td className="report-query" title={scan.query}>{scan.query || "—"}</td>
                  <td className={`num ${scan.results ? "" : "zero"}`}>{scan.results === null ? "—" : number.format(scan.results)}</td>
                  <td><StatePill state={SCAN_STATES[scan.state]} />{scan.error && <small className="report-detail failed">{scan.error}</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={Search} title="No research scans" text="Nothing matches these filters in the selected period." />}
      <MoreButton shown={shown} total={filtered.length} onMore={() => setShown(shown + PAGE)} />
    </section>
  );
}

// ---- Group messages ----------------------------------------------------------------------------

export function MessagesReport({ messages, filteredRef }) {
  const [person, setPerson] = useState("all");
  const [group, setGroup] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const groups = useMemo(() => [...new Set(messages.map((message) => message.group))].sort(), [messages]);
  const filtered = useMemo(() => messages.filter((message) =>
    (person === "all" || personKey(message) === person) && (group === "all" || message.group === group)), [messages, person, group]);
  if (filteredRef) filteredRef.current = filtered;

  return (
    <section className="report-panel">
      <header className="report-panel-head">
        <div><h2>Group messages</h2><p>{number.format(filtered.length)} messages</p></div>
        <div className="report-filters">
          <Select label="Person" value={person} onChange={(value) => { setPerson(value); setShown(PAGE); }} options={peopleOptions(messages)} />
          <Select label="Group" value={group} onChange={(value) => { setGroup(value); setShown(PAGE); }}
            options={[{ value: "all", label: "All groups" }, ...groups.map((name) => ({ value: name, label: name }))]} />
        </div>
      </header>
      {filtered.length ? (
        <ol className="report-messages">
          {filtered.slice(0, shown).map((message) => (
            <li key={message.id}>
              <header>
                <strong>{message.group}</strong>
                <span className="report-chip person"><UserRound size={13} />by {message.createdBy}</span>
                <time dateTime={message.at}>{fullDate(message.at)}</time>
              </header>
              <p>{message.text}</p>
              {message.apps.length > 0 && (
                <ul className="report-app-results">
                  {message.apps.map((app) => (
                    <li key={app.app} className={app.state} title={app.error || undefined}>
                      <PlatformLogo platform={app.app} label={app.label} size={14} />
                      {app.label}
                      <b>{app.state === "sent" ? <CheckCircle2 size={13} /> : app.state === "failed" ? <TriangleAlert size={13} /> : <Clock3 size={13} />}{app.state === "sent" ? "Sent" : app.state === "failed" ? "Failed" : "Sending"}</b>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      ) : <Empty icon={MessagesSquare} title="No group messages" text="Nothing matches these filters in the selected period." />}
      <MoreButton shown={shown} total={filtered.length} onMore={() => setShown(shown + PAGE)} />
    </section>
  );
}
