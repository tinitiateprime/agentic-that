"use client";

import { AlarmClock, Check, ClipboardCopy, ExternalLink, Inbox, Loader2, MessageSquareReply, RefreshCw, RotateCcw, Search, Trash2, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import PlatformLogo from "@platform/PlatformLogo";

const VIEWS = [
  ["open", "Needs reply"],
  ["mine", "Assigned to me"],
  ["snoozed", "Snoozed"],
  ["done", "Done"],
];
const PLATFORMS = [["all", "All platforms"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["youtube", "YouTube"], ["linkedin", "LinkedIn"], ["x", "X"]];
const SNOOZES = [["1h", "1 hour"], ["3h", "3 hours"], ["tomorrow", "Tomorrow 9 am"], ["week", "Next week"]];

function ago(value) {
  if (!value) return "";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d` : new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const when = (value) => (value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
const initials = (name) => String(name || "?").replace(/^@/, "").replace(/\(.*\)/, "").trim().split(/\s+/).slice(0, 2).map((word) => word[0] || "").join("").toUpperCase() || "?";

function sourceStatus(source) {
  if (!source.enabled) return { text: "Off: comments aren't collected", tone: "off" };
  if (!source.connected) return { text: "Sign in to this account again in the Companion", tone: "bad" };
  if (!source.companionReady) return { text: `Update the Companion to ${source.requiredVersion || "the latest version"} on the computer with this account`, tone: "bad" };
  if (source.status === "running") return { text: "Checking for new comments…", tone: "busy" };
  if (source.status === "never" || source.status === "queued") {
    return source.companionOnline ? { text: "First check within a minute…", tone: "busy" } : { text: "Waiting for the Companion to come online", tone: "wait" };
  }
  if (source.status === "failed") return { text: source.message, tone: "bad" };
  if (source.status === "collected") return { text: `Checked ${ago(source.lastCollectedAt)} ago · ${source.message}`, tone: "good" };
  return { text: source.message || "On", tone: "good" };
}

function Switch({ checked, label, disabled, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="sm-switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

// The accounts whose comments come into this inbox, always in view: each
// with its own switch and a one-line status.
function Accounts({ sources, busy, onChange }) {
  const on = sources.filter((source) => source.enabled);
  return (
    <section className="sm-accounts" aria-label="Accounts watched for comments">
      <header className="sm-accounts-head">
        <div>
          <h2>Accounts watched for comments</h2>
          <p>{sources.length
            ? `${on.length} of ${sources.length} on · new comments come in every 20 minutes`
            : "No account is connected yet. Connect your accounts in the Companion (Publishing → Accounts)."}</p>
        </div>
        {on.length > 0 && (
          <button type="button" className="sm-secondary" disabled={busy} onClick={() => on.forEach((source) => onChange({ accountId: source.accountId, checkNow: true }))}>
            <RefreshCw size={15} />Check all now
          </button>
        )}
      </header>
      {sources.length > 0 && on.length === 0 && (
        <p className="sm-accounts-prompt">Switch on the accounts whose comments, replies and mentions you want to answer here.</p>
      )}
      <div className="sm-accounts-grid">
        {(on.length ? on : sources).map((source) => {
          const status = sourceStatus(source);
          return (
            <article key={source.accountId} className={`sm-account ${source.enabled ? "on" : ""} ${status.tone}`}>
              <div className="sm-account-top">
                <span className="sm-account-logo"><PlatformLogo platform={source.platform} label={source.label} size={26} /></span>
                <div className="sm-account-name">
                  <strong title={source.name}>{source.name}</strong>
                  <small>{source.label}{source.pages?.length ? ` · + ${source.pages.length === 1 ? source.pages[0] : `${source.pages.length} Pages`}` : ""}</small>
                </div>
                <Switch checked={source.enabled} disabled={busy} label={`Collect comments from ${source.label} ${source.name}`}
                  onChange={(enabled) => onChange({ accountId: source.accountId, enabled })} />
              </div>
              <p className="sm-account-status">
                {status.tone === "busy" ? <Loader2 size={13} className="sm-spin" /> : <i aria-hidden="true" />}
                <span>{status.text}</span>
              </p>
              {source.enabled && source.companionReady && source.status !== "running" && (
                <button type="button" className="sm-link sm-account-check" disabled={busy} onClick={() => onChange({ accountId: source.accountId, checkNow: true })}>Check now</button>
              )}
            </article>
          );
        })}
      </div>
      {on.length > 0 && on.length < sources.length && (
        <div className="sm-accounts-off">
          <span>Not watched</span>
          {sources.filter((source) => !source.enabled).map((source) => (
            <span key={source.accountId} className="sm-account-chip">
              <PlatformLogo platform={source.platform} label={source.label} size={16} />
              <span title={`${source.label} · ${source.name}`}>{source.name}</span>
              <Switch checked={false} disabled={busy} label={`Collect comments from ${source.label} ${source.name}`}
                onChange={() => onChange({ accountId: source.accountId, enabled: true })} />
            </span>
          ))}
        </div>
      )}
      <details className="sm-accounts-more">
        <summary>What gets collected from each app?</summary>
        <ul>
          <li><PlatformLogo platform="youtube" size={14} /> <b>YouTube</b>: comments you haven&apos;t answered; answering on YouTube marks them Done here.</li>
          <li><PlatformLogo platform="linkedin" size={14} /> <b>LinkedIn</b>: comments and mentions on the person&apos;s posts and on every Page they manage.</li>
          <li><PlatformLogo platform="x" size={14} /> <b>X</b>: replies, mentions and quotes.</li>
          <li><PlatformLogo platform="facebook" size={14} /> <b>Facebook</b>: comments on the latest 6 reels and 6 photo posts.</li>
          <li><PlatformLogo platform="instagram" size={14} /> <b>Instagram</b>: comments, replies and mentions.</li>
        </ul>
        <p>The Companion reads these read-only, in each account&apos;s own signed-in browser. It never likes, replies or posts.</p>
      </details>
    </section>
  );
}

function SavedReplies({ replies, onCopy, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <div className="sm-inbox-replies">
      <div className="sm-inbox-replies-head">
        <strong>Saved replies</strong>
        <button type="button" className="sm-link" onClick={() => setEditing(!editing)}>{editing ? "Close" : "Add or edit"}</button>
      </div>
      {replies.length === 0 && !editing && <p className="sm-muted">Save answers you give often, like prices or timings, and copy them in one click.</p>}
      <div className="sm-inbox-reply-list">
        {replies.map((reply) => (
          <span key={reply.id} className="sm-inbox-reply-chip">
            <button type="button" onClick={() => onCopy(reply)} title={reply.body}><ClipboardCopy size={13} />{reply.title}</button>
            {editing && <button type="button" className="sm-icon" aria-label={`Delete ${reply.title}`} disabled={busy} onClick={() => onSave({ id: reply.id, remove: true })}><Trash2 size={13} /></button>}
          </span>
        ))}
      </div>
      {editing && (
        <form className="sm-inbox-reply-form" onSubmit={(event) => { event.preventDefault(); onSave({ title, body }).then((ok) => { if (ok) { setTitle(""); setBody(""); } }); }}>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name, e.g. Course fees" maxLength={120} />
          <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="The reply text" rows={3} maxLength={4000} />
          <button type="submit" className="sm-primary" disabled={busy || !title.trim() || !body.trim()}>Save reply</button>
        </form>
      )}
    </div>
  );
}

function Detail({ item, data, busy, act, saveReply, notice, setNotice }) {
  const [note, setNote] = useState(item.note);
  useEffect(() => setNote(item.note), [item.id, item.note]);
  const copy = async (reply) => {
    try {
      await navigator.clipboard.writeText(reply.body);
      setNotice(`Copied "${reply.title}". Click Reply and paste it.`);
    } catch {
      setNotice("Your browser blocked copying. Select the text and copy it by hand.");
    }
  };
  return (
    <article className="sm-inbox-detail" aria-label="Conversation">
      <header>
        <div className="sm-inbox-who">
          <span className="sm-avatar large">{initials(item.authorName)}<b><PlatformLogo platform={item.platform} size={16} /></b></span>
          <div>
            <h3>{item.authorUrl ? <a href={item.authorUrl} target="_blank" rel="noreferrer">{item.authorName}</a> : item.authorName}</h3>
            <small>{({ message: "Message", mention: "Mention", reply: "Reply" })[item.kind] || "Comment"} on {item.platformLabel} · {when(item.receivedAt)}</small>
          </div>
        </div>
        {item.permalink && (
          <a className="sm-primary" href={item.permalink} target="_blank" rel="noreferrer"><MessageSquareReply size={15} />Reply on {item.platformLabel}<ExternalLink size={13} /></a>
        )}
      </header>
      <p className="sm-inbox-body">{item.body}</p>
      {item.contextText && <p className="sm-inbox-context"><span>On your post:</span> {item.contextText}</p>}
      {notice && <p className="sm-message good" role="status">{notice}</p>}

      <SavedReplies replies={data.savedReplies} onCopy={copy} onSave={saveReply} busy={busy} />

      <div className="sm-inbox-actions">
        <label className="sm-select-inline"><UserRound size={14} />Assign to
          <select value={item.assignedTo || ""} disabled={busy} onChange={(event) => act({ action: "assign", assigneeId: event.target.value || null })}>
            <option value="">Nobody</option>
            {data.members.map((member) => <option key={member.id} value={member.id}>{member.id === data.userId ? `${member.name} (me)` : member.name}</option>)}
          </select>
        </label>
        {item.status === "open" && (
          item.view === "snoozed"
            ? <button type="button" className="sm-secondary" disabled={busy} onClick={() => act({ action: "unsnooze" })}><AlarmClock size={15} />Unsnooze (until {when(item.snoozedUntil)})</button>
            : (
              <label className="sm-select-inline"><AlarmClock size={14} />Snooze
                <select value="" disabled={busy} onChange={(event) => event.target.value && act({ action: "snooze", snooze: event.target.value, timezoneOffsetMinutes: new Date().getTimezoneOffset() })}>
                  <option value="">Choose…</option>
                  {SNOOZES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            )
        )}
        {item.status === "open"
          ? <button type="button" className="sm-primary sm-inbox-done" disabled={busy} onClick={() => act({ action: "done" })}><Check size={15} />Done</button>
          : <button type="button" className="sm-secondary" disabled={busy} onClick={() => act({ action: "reopen" })}><RotateCcw size={15} />Reopen{item.doneByName ? ` (done by ${item.doneByName})` : ""}</button>}
      </div>

      <label className="sm-inbox-note">Team note
        <textarea value={note} rows={2} maxLength={2000} placeholder="Only your team sees this, e.g. “Sent price list by DM”." onChange={(event) => setNote(event.target.value)}
          onBlur={() => { if (note !== item.note) act({ action: "note", note }); }} />
      </label>
    </article>
  );
}

export default function InboxView({ onCounts }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("open");
  const [platform, setPlatform] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/social-inbox");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The inbox could not be loaded.");
      setData(body); setError("");
      if (body?.counts) onCounts?.(body.counts);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [onCounts]);
  // Loads now and every minute while the tab is open.
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 60000);
    return () => clearInterval(timer);
  }, [load]);

  const items = useMemo(() => {
    if (!data?.items) return [];
    const needle = query.trim().toLowerCase();
    return data.items.filter((item) => (view === "open" ? item.view === "open" || item.view === "mine" : item.view === view)
      && (platform === "all" || item.platform === platform)
      && (!needle || `${item.authorName} ${item.body} ${item.contextText}`.toLowerCase().includes(needle)));
  }, [data, view, platform, query]);
  const selected = items.find((item) => item.id === selectedId) || items[0] || null;

  async function post(body) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/social-inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "That didn't save. Try again.");
      setData(result);
      if (result?.counts) onCounts?.(result.counts);
      return true;
    } catch (postError) {
      setError(postError.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const act = (change) => {
    setNotice("");
    // After Done or Snooze the item leaves this list; select the next one.
    if (["done", "snooze", "reopen", "unsnooze"].includes(change.action)) {
      const index = items.findIndex((item) => item.id === selected.id);
      setSelectedId(items[index + 1]?.id || items[index - 1]?.id || "");
    }
    return post({ type: "item", id: selected.id, ...change });
  };

  if (!data && !error) return <section className="sm-panel sm-coming"><Loader2 size={22} className="sm-spin" /><p>Loading the inbox…</p></section>;
  if (data?.unavailable) {
    return <section className="sm-panel sm-coming"><Inbox size={26} /><h2>The inbox is being switched on</h2><p>It will appear here as soon as the site&apos;s database is updated.</p></section>;
  }

  return (
    <section className="sm-inbox">
      {data?.sources && <Accounts sources={data.sources} busy={busy} onChange={(change) => post({ type: "source", ...change })} />}
      <div className="sm-controls">
        <div className="sm-range" role="group" aria-label="Inbox lists">
          {VIEWS.map(([id, label]) => (
            <button type="button" key={id} aria-pressed={view === id} onClick={() => { setView(id); setSelectedId(""); setNotice(""); }}>
              {label}{id !== "done" && data?.counts?.[id] ? <em className="sm-count">{data.counts[id]}</em> : null}
            </button>
          ))}
        </div>
        <label className="sm-select-inline">Platform
          <select value={platform} onChange={(event) => { setPlatform(event.target.value); setSelectedId(""); }}>
            {PLATFORMS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="sm-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search the inbox" /></label>
      </div>
      {error && <p className="sm-message bad" role="alert">{error}</p>}

      {items.length === 0 ? (
        <div className="sm-panel sm-coming">
          <Inbox size={26} />
          <h2>{view === "open" ? (data?.items?.length ? "All caught up" : "Nothing here yet") : "Nothing in this list"}</h2>
          {view === "open" && !data?.items?.length && (
            <p>Switch on your accounts above. New comments, replies and mentions land here within 20 minutes.</p>
          )}
        </div>
      ) : (
        <div className="sm-inbox-grid">
          <ul className="sm-inbox-list" aria-label="Conversations">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" aria-current={selected?.id === item.id} onClick={() => { setSelectedId(item.id); setNotice(""); }}>
                  <span className="sm-avatar">{initials(item.authorName)}<b><PlatformLogo platform={item.platform} size={13} /></b></span>
                  <span className="sm-inbox-row-main">
                    <span className="sm-inbox-row-top">
                      <strong>{item.authorName}</strong>
                      <time>{ago(item.receivedAt)}</time>
                    </span>
                    <span className="sm-inbox-snippet">{item.body}</span>
                    {item.assignedName && <span className="sm-inbox-assignee"><UserRound size={12} />{item.assignedTo === data.userId ? "You" : item.assignedName}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && <Detail key={selected.id} item={selected} data={data} busy={busy} act={act} saveReply={(reply) => post({ type: "reply", ...reply })} notice={notice} setNotice={setNotice} />}
        </div>
      )}
    </section>
  );
}
