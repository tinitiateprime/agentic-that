"use client";

import { BarChart3, CheckCircle2, Clock3, Download, MessagesSquare, Search, SquarePen, TriangleAlert, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CompanyTile } from "@platform/CompanySwitcher";
import { MessagesReport, PostsReport, ScansReport, downloadCsv, messageCsv, postCsv, scanCsv } from "./ServiceReports";

const RANGES = [7, 30, 90];
const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "posts", label: "Publishing", icon: SquarePen, count: (report) => report.posts.length },
  { id: "research", label: "Research", icon: Search, count: (report) => report.scans.length },
  { id: "groups", label: "Group messages", icon: MessagesSquare, count: (report) => report.groupMessages.length },
];
const PRODUCTS = [
  { id: "all", label: "Everything" },
  { id: "publishing", label: "Publishing" },
  { id: "scraping", label: "Research" },
  { id: "groups", label: "Groups" },
  { id: "team", label: "Team" },
];
const COLUMNS = [
  { key: "postsCreated", label: "Posts created" },
  { key: "postsPublished", label: "Published" },
  { key: "postsFailed", label: "Failed" },
  { key: "submissions", label: "Submitted" },
  { key: "scrapingRuns", label: "Research scans" },
  { key: "groupMessages", label: "Group messages" },
];

const number = new Intl.NumberFormat();
function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString([], { day: "numeric", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" });

function csv(report) {
  const header = ["Name", "Email", "Roles", "Status", "Last sign-in", "Last activity", ...COLUMNS.map((column) => column.label)];
  const rows = report.people.map((person) => [
    person.name, person.email, person.roles.join("; "), person.status, person.lastSignIn || "", person.lastActivity || "",
    ...COLUMNS.map((column) => person[column.key]),
  ]);
  return [header, ...rows].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll("\"", "\"\"")}"`).join(",")).join("\r\n");
}

function Tile({ icon: Icon, label, value, note }) {
  return (
    <article className="report-tile">
      <span><Icon size={17} /></span>
      <div><small>{label}</small><strong>{value}</strong>{note && <em>{note}</em>}</div>
    </article>
  );
}

function DailyChart({ daily }) {
  const [hover, setHover] = useState(null);
  const width = 720;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 26, left: 32 };
  const max = Math.max(1, ...daily.map((day) => day.actions));
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * Math.ceil(max / step);
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / daily.length;
  const barW = Math.max(2, Math.min(22, slot - 2));
  const y = (value) => pad.top + plotH - (value / top) * plotH;
  const ticks = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  const labelEvery = Math.ceil(daily.length / 7);
  const total = daily.reduce((sum, day) => sum + day.actions, 0);

  return (
    <section className="report-panel">
      <header className="report-panel-head">
        <div><h2>Actions per day</h2><p>{number.format(total)} actions by the team in this period</p></div>
      </header>
      <div className="report-chart" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Actions per day. ${daily.map((day) => `${dayLabel(day.date)}: ${day.actions}`).join(", ")}`}>
          {ticks.map((value) => (
            <g key={value}>
              <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} className={value === 0 ? "report-baseline" : "report-grid"} />
              <text x={pad.left - 8} y={y(value) + 4} textAnchor="end" className="report-axis">{value}</text>
            </g>
          ))}
          {daily.map((day, index) => {
            const x = pad.left + index * slot + (slot - barW) / 2;
            const barH = day.actions ? Math.max(2, (day.actions / top) * plotH) : 0;
            const radius = Math.min(4, barW / 2, barH);
            const baseY = pad.top + plotH;
            return (
              <g key={day.date}>
                {barH > 0 && (
                  <path
                    className={`report-bar ${hover === index ? "active" : ""}`}
                    d={`M${x},${baseY} V${baseY - barH + radius} Q${x},${baseY - barH} ${x + radius},${baseY - barH} H${x + barW - radius} Q${x + barW},${baseY - barH} ${x + barW},${baseY - barH + radius} V${baseY} Z`}
                  />
                )}
                <rect x={pad.left + index * slot} y={pad.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} tabIndex={0} aria-label={`${dayLabel(day.date)}: ${day.actions} actions`} />
                {index % labelEvery === 0 && <text x={pad.left + index * slot + slot / 2} y={height - 8} textAnchor="middle" className="report-axis">{dayLabel(day.date)}</text>}
              </g>
            );
          })}
        </svg>
        {hover !== null && daily[hover] && (
          <div className="report-tooltip" style={{ left: `${((pad.left + hover * slot + slot / 2) / width) * 100}%` }}>
            <strong>{dayLabel(daily[hover].date)}</strong>
            <span>{number.format(daily[hover].actions)} {daily[hover].actions === 1 ? "action" : "actions"}</span>
          </div>
        )}
      </div>
      <details className="report-table-toggle">
        <summary>Show as table</summary>
        <table><thead><tr><th>Day</th><th>Actions</th></tr></thead><tbody>{daily.map((day) => <tr key={day.date}><td>{dayLabel(day.date)}</td><td>{day.actions}</td></tr>)}</tbody></table>
      </details>
    </section>
  );
}

export default function WorkspaceReports({ initialReport, currentUserId, workspaceId = "" }) {
  const [report, setReport] = useState(initialReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [person, setPerson] = useState("all");
  const [product, setProduct] = useState("all");
  const [tab, setTab] = useState("overview");
  const filteredRef = useRef(null);

  async function changeRange(days) {
    if (days === report.rangeDays || loading) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/workspace-reports?days=${days}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The report could not be loaded.");
      setReport(data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  // Downloads what the open tab shows, with its filters applied.
  function download() {
    const base = `${(report.workspaceName || "company").replace(/[^\w-]+/g, "-")}-${report.rangeDays}-days`;
    const rows = filteredRef.current;
    if (tab === "posts") downloadCsv(`${base}-social-posts.csv`, postCsv(rows || report.posts));
    else if (tab === "research") downloadCsv(`${base}-research.csv`, scanCsv(rows || report.scans));
    else if (tab === "groups") downloadCsv(`${base}-group-messages.csv`, messageCsv(rows || report.groupMessages));
    else downloadCsv(`${base}-people.csv`, csv(report));
  }

  const events = useMemo(() => report.events.filter((event) =>
    (person === "all" || event.userId === person || (!event.userId && `former:${event.actorName}` === person))
    && (product === "all" || event.product === product)), [report.events, person, product]);
  const { totals } = report;

  return (
    <main className="report-shell">
      <header className="report-header">
        <div className="report-title">
          <CompanyTile id={workspaceId || report.workspaceName} name={report.workspaceName || "Your company"} size={56} />
          <div>
            <p>Company reports · last {report.rangeDays} days</p>
            <h1>{report.workspaceName || "Your company"}</h1>
            <span>What everyone in this company did: the posts, research and group messages, and who did them. Everyone in the company can see this page.</span>
          </div>
        </div>
        <div className="report-controls">
          <div className="report-range" role="group" aria-label="Time range">
            {RANGES.map((days) => (
              <button type="button" key={days} aria-pressed={report.rangeDays === days} disabled={loading} onClick={() => changeRange(days)}>{days} days</button>
            ))}
          </div>
          <button type="button" className="report-download" onClick={download}><Download size={15} />Download CSV</button>
        </div>
      </header>

      {error && <p className="report-error" role="alert">{error}</p>}
      {report.publishingUnavailable && <p className="report-note" role="status">Social post activity could not be loaded right now, so those numbers may be missing. Try again in a minute.</p>}

      <nav className="report-tabs" role="tablist" aria-label="Report sections">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          return (
            <button type="button" role="tab" key={entry.id} aria-selected={tab === entry.id} onClick={() => { filteredRef.current = null; setTab(entry.id); }}>
              <Icon size={16} />{entry.label}{entry.count && <span>{number.format(entry.count(report))}</span>}
            </button>
          );
        })}
      </nav>

      {tab === "posts" && <PostsReport key={`posts-${report.rangeDays}`} posts={report.posts} platforms={report.postPlatforms} filteredRef={filteredRef} />}
      {tab === "research" && <ScansReport key={`scans-${report.rangeDays}`} scans={report.scans} filteredRef={filteredRef} />}
      {tab === "groups" && <MessagesReport key={`messages-${report.rangeDays}`} messages={report.groupMessages} filteredRef={filteredRef} />}

      {tab === "overview" && <>

      <section className={`report-tiles ${loading ? "loading" : ""}`} aria-label="Summary">
        <Tile icon={CheckCircle2} label="Posts published" value={number.format(totals.postsPublished)} />
        <Tile icon={TriangleAlert} label="Posts failed" value={number.format(totals.postsFailed)} />
        <Tile icon={Clock3} label="Waiting to publish" value={number.format(totals.postsWaiting)} note="right now" />
        <Tile icon={Search} label="Research scans" value={number.format(totals.scrapingRuns)} />
        <Tile icon={MessagesSquare} label="Group messages" value={number.format(totals.groupMessages)} />
        <Tile icon={Users} label="Active members" value={`${totals.activeMembers} of ${totals.members}`} />
      </section>

      <DailyChart daily={report.daily} />

      <section className="report-panel">
        <header className="report-panel-head">
          <div><h2>Activity by person</h2><p>Select a person to see only their activity below.</p></div>
        </header>
        <div className="report-table-wrap">
          <table className="report-people">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Last sign-in</th>
                {COLUMNS.map((column) => <th scope="col" key={column.key} className="num">{column.label}</th>)}
                <th scope="col">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {report.people.map((row) => (
                <tr key={row.id} className={person === row.id ? "selected" : ""}>
                  <th scope="row">
                    <button type="button" onClick={() => setPerson(person === row.id ? "all" : row.id)} aria-pressed={person === row.id}>
                      <strong>{row.name}{row.id === currentUserId ? " (you)" : ""}</strong>
                      <small>{row.status === "former" ? "No longer in this company" : row.roles.join(", ") || row.email}</small>
                    </button>
                    {row.status === "suspended" && <em className="report-badge">Suspended</em>}
                  </th>
                  <td>{when(row.lastSignIn)}</td>
                  {COLUMNS.map((column) => <td key={column.key} className={`num ${row[column.key] ? "" : "zero"}`}>{number.format(row[column.key])}</td>)}
                  <td>{when(row.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="report-panel">
        <header className="report-panel-head">
          <div><h2>Recent activity</h2><p>{events.length === report.events.length && report.eventCount > report.events.length ? `Latest ${report.events.length} of ${number.format(report.eventCount)} actions` : `${number.format(events.length)} actions`}</p></div>
          <div className="report-filters">
            <label>Person
              <select value={person} onChange={(event) => setPerson(event.target.value)}>
                <option value="all">Everyone</option>
                {report.people.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label>Area
              <select value={product} onChange={(event) => setProduct(event.target.value)}>
                {PRODUCTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </div>
        </header>
        {events.length ? (
          <ol className="report-feed">
            {events.map((event) => (
              <li key={event.id}>
                <span className={`report-dot ${event.product}`} aria-hidden="true">
                  {event.product === "publishing" ? <SquarePen size={14} /> : event.product === "scraping" ? <Search size={14} /> : event.product === "groups" ? <MessagesSquare size={14} /> : <Users size={14} />}
                </span>
                <div>
                  <p><strong>{event.actorName}</strong> {event.label}</p>
                  {event.detail && <small className="report-detail">{event.detail}</small>}
                </div>
                <span className={`report-outcome ${event.outcome}`}>
                  {event.outcome === "failed" ? <><TriangleAlert size={13} />Failed</> : event.outcome === "in_progress" ? <><Clock3 size={13} />In progress</> : <><CheckCircle2 size={13} />Done</>}
                </span>
                <time dateTime={event.at}>{when(event.at)}</time>
              </li>
            ))}
          </ol>
        ) : (
          <div className="report-empty"><BarChart3 size={20} /><span><strong>No activity yet</strong><small>Nothing matches this person and area in the selected period.</small></span></div>
        )}
      </section>
      </>}
    </main>
  );
}
