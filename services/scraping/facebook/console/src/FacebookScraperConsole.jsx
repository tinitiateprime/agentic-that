"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, RotateCcw, Search, Square, X } from "lucide-react";
import { getFacebookCompanionStatus, runFacebookCompanionJob } from "./companionClient";

const API_URL = process.env.NEXT_PUBLIC_FACEBOOK_API_URL || "/api/scraping/facebook";
const ENGINES = [
  { id: "server", label: "Server", detail: "Runs in the cloud" },
  { id: "companion", label: "Local Companion", detail: "Runs privately on this computer" },
];
const INPUTS = [
  { id: "profile", label: "Profile", symbol: "f", placeholder: "Page or public profile username" },
  { id: "keyword", label: "Keyword / hashtag", symbol: "#", placeholder: "Enter a Facebook keyword or hashtag" },
  { id: "profile_url", label: "Profile URL", symbol: "URL", placeholder: "https://www.facebook.com/pagename" },
  { id: "post_url", label: "Post URL", symbol: "POST", placeholder: "Facebook post, Reel, photo, or video URL" },
];
const COLLECTIONS = [
  { id: "latest", label: "Latest" },
  { id: "range", label: "Range" },
  { id: "engagement", label: "Analyze Profile" },
  { id: "compare", label: "Compare Profiles" },
];

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function defaultRange(type) {
  const now = new Date();
  const earlier = new Date(now);
  earlier.setDate(earlier.getDate() - 6);
  if (type === "month") return { from: localDate(now).slice(0, 7), to: localDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7) };
  if (type === "year") return { from: String(now.getFullYear()), to: String(now.getFullYear() - 1) };
  return { from: localDate(now), to: localDate(earlier) };
}

async function responseData(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Facebook scrape request failed (${response.status}).`);
  return data;
}

async function apiPost(path, body, signal) {
  return responseData(await fetch(`${API_URL}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }));
}

async function apiGet(path, signal) {
  return responseData(await fetch(`${API_URL}${path}`, { cache: "no-store", signal }));
}

async function runServerJob(payload, onStatus = () => {}, signal) {
  const created = await apiPost("/jobs", payload, signal);
  const jobId = created?.job?.id;
  if (!jobId) throw new Error("The Facebook background job could not be created.");
  onStatus("Opening fresh public Facebook pages");
  let current = await apiPost(`/jobs/${jobId}/run`, {}, signal);
  const deadline = Date.now() + 16 * 60_000;
  let failures = 0;
  while (current?.job?.status !== "complete") {
    if (current?.job?.status === "failed") throw new Error(current.job.error || "Facebook scrape failed.");
    if (Date.now() >= deadline) throw new Error("The Facebook scrape took too long. Try a smaller count or range.");
    onStatus(current?.job?.status === "running" ? "Collecting visible Facebook data" : "Waiting for the background worker");
    await new Promise(resolve => window.setTimeout(resolve, 2_000));
    try { current = await apiGet(`/jobs/${jobId}`, signal); failures = 0; }
    catch (error) { failures += 1; if (failures >= 5) throw error; onStatus("Reconnecting to the Facebook job"); }
  }
  return current;
}

function metric(value, display) {
  if (value === null || value === undefined) return "N/A";
  return display || Number(value).toLocaleString("en-US");
}

function dateLabel(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "N/A";
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function download(name, body, type) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Thumbnail({ post }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [post.thumbnail_url]);
  return <div className="facebook-thumb">{post.thumbnail_url && !failed
    ? <img src={post.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />
    : <span>{post.media_type === "video" || post.media_type === "reel" ? "▶" : "f"}</span>}</div>;
}

function Analysis({ analysis }) {
  if (!analysis) return null;
  const cards = [
    ["Followers", metric(analysis.follower_count, analysis.follower_count_display)],
    ["Posts analyzed", analysis.analyzed_posts],
    ["Reels scanned", analysis.analyzed_reels],
    ["Avg. reactions", metric(analysis.averages?.reactions)],
    ["Avg. comments", metric(analysis.averages?.comments)],
    ["Avg. Reel views", metric(analysis.averages?.views)],
    ["Engagement rate", analysis.engagement_rate === null ? "N/A" : `${analysis.engagement_rate}%`],
  ];
  const rankings = [
    ["Most reacted", analysis.top_reacted],
    ["Most discussed", analysis.top_discussed],
    ["Most viewed", analysis.top_viewed],
  ];
  return <section className="facebook-analysis">
    <div className="facebook-stat-grid">{cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <div className="facebook-rank-grid">{rankings.map(([label, posts]) => <article key={label}>
      <h3>{label}</h3>
      {posts?.length ? posts.slice(0, 3).map((post, index) => <a href={post.post_url} target="_blank" rel="noreferrer" key={post.post_url}>
        <span>{index + 1}</span><p>{post.content || post.author_name || "Facebook post"}</p><ExternalLink size={14} />
      </a>) : <p className="facebook-empty-small">No trustworthy public metric.</p>}
    </article>)}</div>
    <div className="facebook-patterns">
      <h3>Content patterns</h3>
      {["formats", "hashtags", "keywords", "posting_days"].map(key => <div key={key}><span>{key.replace("_", " ")}</span><p>{analysis.patterns?.[key]?.slice(0, 8).map(item => `${item.label} (${item.count})`).join(" · ") || "N/A"}</p></div>)}
    </div>
    <div className="facebook-accuracy"><strong>Accuracy</strong>{["followers", "reactions", "comments", "views"].map(key => <span key={key}>{key}: {analysis.accuracy?.[key] || "N/A"}</span>)}</div>
  </section>;
}

function Comparison({ comparisons }) {
  if (!comparisons?.length) return null;
  return <section className="facebook-comparison">
    <h2>Profile comparison</h2>
    <div>{comparisons.map(item => <article key={item.run?.requestedQuery || item.run?.query}>
      <p>{item.run?.requestedQuery || item.run?.query}</p>
      <h3>{item.analysis?.profile_name || "Public profile"}</h3>
      <dl>
        <div><dt>Followers</dt><dd>{metric(item.analysis?.follower_count, item.analysis?.follower_count_display)}</dd></div>
        <div><dt>Avg. reactions</dt><dd>{metric(item.analysis?.averages?.reactions)}</dd></div>
        <div><dt>Avg. comments</dt><dd>{metric(item.analysis?.averages?.comments)}</dd></div>
        <div><dt>Avg. Reel views</dt><dd>{metric(item.analysis?.averages?.views)}</dd></div>
        <div><dt>Engagement</dt><dd>{item.analysis?.engagement_rate === null ? "N/A" : `${item.analysis?.engagement_rate}%`}</dd></div>
      </dl>
    </article>)}</div>
  </section>;
}

export default function FacebookScraperConsole({ publishingIdentityToken = "" }) {
  const [engine, setEngine] = useState("server");
  const [companion, setCompanion] = useState({ ready: false, checking: false, message: "" });
  const [inputMode, setInputMode] = useState("profile");
  const [profileType, setProfileType] = useState("page");
  const [query, setQuery] = useState("");
  const [compareQuery, setCompareQuery] = useState("");
  const [collection, setCollection] = useState("latest");
  const [maxResults, setMaxResults] = useState(10);
  const [rangeType, setRangeType] = useState("date");
  const initialRange = useMemo(() => defaultRange("date"), []);
  const [rangeFrom, setRangeFrom] = useState(initialRange.from);
  const [rangeTo, setRangeTo] = useState(initialRange.to);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [comparisons, setComparisons] = useState(null);
  const controllerRef = useRef(null);

  const profileInput = inputMode === "profile" || inputMode === "profile_url";
  const postInput = inputMode === "post_url";
  const input = INPUTS.find(item => item.id === inputMode);

  useEffect(() => {
    const saved = window.localStorage.getItem("agenticthat-facebook-scrape-engine");
    if (saved === "server" || saved === "companion") setEngine(saved);
  }, []);

  useEffect(() => {
    if (engine !== "companion") return;
    let live = true;
    setCompanion(previous => ({ ...previous, checking: true }));
    getFacebookCompanionStatus(publishingIdentityToken).then(status => {
      if (live) setCompanion({ ...status, checking: false });
    });
    return () => { live = false; };
  }, [engine, publishingIdentityToken]);

  function chooseEngine(next) {
    setEngine(next);
    window.localStorage.setItem("agenticthat-facebook-scrape-engine", next);
  }

  function chooseInput(next) {
    setInputMode(next);
    if (!["profile", "profile_url"].includes(next) && ["engagement", "compare"].includes(collection)) setCollection("latest");
    if (next === "post_url") setCollection("latest");
    setResult(null); setComparisons(null); setError("");
  }

  function chooseRangeType(next) {
    setRangeType(next);
    const values = defaultRange(next);
    setRangeFrom(values.from); setRangeTo(values.to);
  }

  function payloadFor(target, mode = collection) {
    return {
      mode: inputMode,
      profile_type: profileType,
      query: target.trim(),
      max_results: postInput ? 1 : Number(maxResults),
      collection_mode: mode,
      timezone_offset_minutes: new Date().getTimezoneOffset(),
      ...(mode === "range" ? { range_type: rangeType, range_from: rangeFrom, range_to: rangeTo } : {}),
    };
  }

  async function selectedJob(payload, signal) {
    return engine === "companion"
      ? runFacebookCompanionJob(payload, setProgress, signal, publishingIdentityToken)
      : runServerJob(payload, setProgress, signal);
  }

  async function start() {
    if (!query.trim()) { setError("Enter a Facebook target first."); return; }
    if (collection === "compare" && !compareQuery.trim()) { setError("Enter the second Facebook profile."); return; }
    if (engine === "companion" && !companion.ready) { setError(companion.message || "Local Companion is unavailable."); return; }
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true); setError(""); setResult(null); setComparisons(null); setProgress("Preparing a fresh Facebook scrape");
    try {
      if (collection === "compare") {
        const items = await Promise.all([
          selectedJob(payloadFor(query, "engagement"), controller.signal),
          selectedJob(payloadFor(compareQuery, "engagement"), controller.signal),
        ]);
        setComparisons(items);
      } else {
        setResult(await selectedJob(payloadFor(query), controller.signal));
      }
    } catch (cause) {
      setError(cause?.name === "AbortError" ? "Facebook scraping was cancelled." : cause instanceof Error ? cause.message : "Facebook scraping failed.");
    } finally {
      controllerRef.current = null;
      setRunning(false); setProgress("");
    }
  }

  function stop() {
    controllerRef.current?.abort();
    setProgress("Cancelling Facebook scrape");
  }

  const posts = result?.results || [];
  function exportJson() { download(`facebook-${Date.now()}.json`, JSON.stringify({ run: result?.run, results: posts, analysis: result?.analysis }, null, 2), "application/json"); }
  function exportCsv() {
    const columns = ["post_id", "post_url", "author_name", "author_url", "content", "media_type", "timestamp", "reactions_count", "comments_count", "top_comments", "views_count", "follower_count", "metric_source"];
    const rows = [columns.map(csvCell).join(","), ...posts.map(post => columns.map(column => csvCell(column === "top_comments" ? JSON.stringify(post.top_comments || []) : post[column])).join(","))];
    download(`facebook-${Date.now()}.csv`, rows.join("\n"), "text/csv;charset=utf-8");
  }

  const hasOutput = result || comparisons;
  return <main className="facebook-scraper-app">
    <header className="facebook-hero">
      <div><span className="facebook-kicker">Facebook intelligence</span><h1>Facebook scraper</h1><p>Fresh public Page, profile, post, Reel, video and keyword data—without an API connection.</p></div>
      {hasOutput && <button type="button" className="facebook-secondary" onClick={() => { setResult(null); setComparisons(null); }}><RotateCcw size={16} /> New scrape</button>}
    </header>

    <section className="facebook-launch-card">
      <fieldset><legend>Scraping engine</legend><div className="facebook-engine-grid">{ENGINES.map(item => <button type="button" key={item.id} className={engine === item.id ? "selected" : ""} onClick={() => chooseEngine(item.id)}><strong>{item.label}</strong><span>{item.detail}</span></button>)}</div>
        {engine === "companion" && <p className={`facebook-engine-state ${companion.ready ? "ready" : "unavailable"}`}>{companion.checking ? "Checking Companion…" : companion.message}</p>}
      </fieldset>

      <fieldset><legend>Input type</legend><div className="facebook-input-grid">{INPUTS.map(item => <button type="button" key={item.id} className={inputMode === item.id ? "selected" : ""} onClick={() => chooseInput(item.id)}><span>{item.symbol}</span>{item.label}</button>)}</div></fieldset>

      {profileInput && <div className="facebook-profile-types"><span>Target kind <small>(labels the export)</small></span><button type="button" className={profileType === "page" ? "selected" : ""} onClick={() => setProfileType("page")}>Business / creator Page</button><button type="button" className={profileType === "public_profile" ? "selected" : ""} onClick={() => setProfileType("public_profile")}>Person's public profile</button></div>}

      <div className="facebook-query-grid">
        <label><span>{input?.label}</span><input type={inputMode.includes("url") ? "url" : "text"} value={query} onChange={event => setQuery(event.target.value)} placeholder={input?.placeholder} onKeyDown={event => event.key === "Enter" && !running && start()} /></label>
        {collection === "compare" && <label><span>Second profile</span><input type={inputMode === "profile_url" ? "url" : "text"} value={compareQuery} onChange={event => setCompareQuery(event.target.value)} placeholder="Second Page or public profile" /></label>}
      </div>

      {!postInput && <fieldset><legend>Collection</legend><div className="facebook-collection-grid">{COLLECTIONS.filter(item => !["engagement", "compare"].includes(item.id) || profileInput).map(item => <button type="button" key={item.id} className={collection === item.id ? "selected" : ""} onClick={() => setCollection(item.id)}>{item.label}</button>)}</div></fieldset>}

      {collection === "range" && <div className="facebook-range"><div>{["date", "month", "year"].map(type => <button type="button" className={rangeType === type ? "selected" : ""} key={type} onClick={() => chooseRangeType(type)}>{type}</button>)}</div><label><span>Start</span><input type={rangeType === "year" ? "number" : rangeType} value={rangeFrom} onChange={event => setRangeFrom(event.target.value)} /></label><label><span>End</span><input type={rangeType === "year" ? "number" : rangeType} value={rangeTo} onChange={event => setRangeTo(event.target.value)} /></label></div>}

      {!postInput && <label className="facebook-count"><span>Maximum results</span><input type="number" min="1" max="50" value={maxResults} onChange={event => setMaxResults(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></label>}
      {error && <p className="facebook-error"><X size={17} />{error}</p>}
      <div className="facebook-actions">{running
        ? <button type="button" className="facebook-stop" onClick={stop}><Square size={15} /> Stop scrape</button>
        : <button type="button" className="facebook-primary" onClick={start}><Search size={18} /> Start Facebook scrape</button>}
        {running && <span><i />{progress}</span>}
      </div>
      <p className="facebook-scope-note">Publicly accessible data only. Login walls, CAPTCHA, private profiles and private groups are never bypassed.</p>
    </section>

    {result && <section className="facebook-results">
      <div className="facebook-result-head"><div><span className={`facebook-status status-${result.discoveryStatus || "ok"}`}>{String(result.discoveryStatus || "ok").replaceAll("_", " ")}</span><h2>{posts.length} public {posts.length === 1 ? "post" : "posts"}</h2><p>{result.run?.requestedQuery || query} · {engine === "companion" ? "Local Companion" : "Server"} · fresh run</p></div><div><button type="button" onClick={exportCsv}><Download size={15} /> CSV</button><button type="button" onClick={exportJson}><Download size={15} /> JSON</button></div></div>
      <Analysis analysis={result.analysis} />
      {posts.length ? <div className="facebook-table-wrap"><table><thead><tr><th>Post</th><th>Author</th><th>Published</th><th>Reactions</th><th>Comments</th><th>Views</th><th>Source</th></tr></thead><tbody>{posts.map((post, index) => <tr key={post.post_id || post.post_url}><td><div className="facebook-post-cell"><Thumbnail post={post} /><div><a href={post.post_url} target="_blank" rel="noreferrer">Post {index + 1}<ExternalLink size={13} /></a><p>{post.content || `${post.media_type || "Facebook"} post`}</p></div></div></td><td>{post.author_name || "N/A"}</td><td>{dateLabel(post.timestamp)}</td><td>{metric(post.reactions_count, post.reactions_display)}</td><td><strong>{metric(post.comments_count, post.comments_display)}</strong>{post.top_comments?.slice(0, 2).map(comment => <p key={`${comment.author_name}-${comment.text}`}>{comment.author_name}: {comment.text}</p>)}</td><td>{metric(post.views_count, post.views_display)}</td><td>{post.metric_source === "visible_reels_grid" ? "All tab + matched Reels grid" : post.metric_source === "current_page_payload" ? "Current All tab + response" : "Visible All tab"}</td></tr>)}</tbody></table></div>
      : <div className="facebook-no-results"><h3>No public posts were available</h3><p>Facebook returned <strong>{String(result.discoveryStatus || "temporarily_unavailable").replaceAll("_", " ")}</strong>. Try a Page URL or Local Companion if the target is public.</p></div>}
    </section>}
    <Comparison comparisons={comparisons} />
  </main>;
}
