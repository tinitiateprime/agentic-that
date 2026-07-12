import React, { useEffect, useMemo, useState } from "react";
import InstagramLogo from "./public/instagram-logo.svg";
import "./InstagramScraper.css";

const apiBase = "/api/scraping/instagram";
const inputModes = [
  { id: "profile", label: "Profile", prefix: "@", placeholder: "username" },
  { id: "keyword", label: "Hashtag", prefix: "#", placeholder: "keyword" },
  { id: "url", label: "URL", prefix: "", placeholder: "https://instagram.com/p/..." }
];
const exportColumns = ["username", "display_name", "post_url", "comments_count", "likes", "follower_count", "timestamp", "caption"];

function dateFromDays(days) {
  const date = new Date();
  date.setDate(date.getDate() - Math.max(1, Number(days) || 1));
  return date.toISOString().slice(0, 10);
}

function composeQuery(mode, value) {
  const text = value.trim();
  if (!text) return "";
  if (mode === "profile") return `@${text.replace(/^@+/, "")}`;
  if (mode === "keyword") return `#${text.replace(/^#+/, "")}`;
  return text;
}

function formatNumber(value) {
  return value === null || value === undefined ? "N/A" : Number(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "N/A";
}

function download(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function InstagramScraper() {
  const [mode, setMode] = useState("profile");
  const [value, setValue] = useState("");
  const [maxResults, setMaxResults] = useState(10);
  const [recentDays, setRecentDays] = useState(7);
  const [keywords, setKeywords] = useState([]);
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const onlyPostsNewerThan = useMemo(() => dateFromDays(recentDays), [recentDays]);

  useEffect(() => {
    fetch(`${apiBase}/runs/keywords`)
      .then((response) => response.ok ? response.json() : { keywords: [] })
      .then((data) => setKeywords(data.keywords || []))
      .catch(() => {});
  }, []);

  const startScrape = async () => {
    const nextQuery = composeQuery(mode, value);
    if (!nextQuery) {
      setError("Enter a profile, hashtag, or Instagram URL.");
      return;
    }

    setError("");
    setResults([]);
    setQuery(nextQuery);
    setStatus("working");

    try {
      const response = await fetch(`${apiBase}/scrape`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: nextQuery,
          max_results: maxResults,
          recent_days: recentDays,
          only_posts_newer_than: onlyPostsNewerThan
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Scrape failed.");
      setResults(data.results || []);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scrape failed.");
      setStatus("idle");
    }
  };

  const exportJson = () => {
    download(JSON.stringify(results, null, 2), "instagram-results.json", "application/json");
  };

  const exportCsv = () => {
    const escapeCell = (value) => {
      if (value === null || value === undefined) return "";
      const text = typeof value === "object" ? JSON.stringify(value) : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [
      exportColumns.join(","),
      ...results.map((item) => exportColumns.map((key) => escapeCell(item[key])).join(","))
    ];
    download(rows.join("\n"), "instagram-results.csv", "text/csv");
  };

  if (status === "working") {
    return (
      <main className="scraper-page scraper-working">
        <div className="scraper-loader" />
        <p className="scraper-kicker">Instagram scraper</p>
        <h1>Collecting public posts</h1>
        <p>Searching {query} from {onlyPostsNewerThan}. Keep this tab open.</p>
      </main>
    );
  }

  return (
    <main className="scraper-page">
      <header className="scraper-header">
        <button type="button" className="scraper-back" onClick={() => { window.location.href = "/"; }}>
          Back
        </button>
        <div className="scraper-title">
          <img src={InstagramLogo} alt="" />
          <div>
            <p className="scraper-kicker">Scraping service</p>
            <h1>Instagram Scraper</h1>
          </div>
        </div>
      </header>

      <section className="scraper-console">
        <div className="scraper-form">
          <div className="mode-row">
            {inputModes.map((item) => (
              <button
                key={item.id}
                type="button"
                className={mode === item.id ? "selected" : ""}
                onClick={() => setMode(item.id)}
              >
                <span>{item.prefix || "URL"}</span>
                {item.label}
              </button>
            ))}
          </div>

          <label htmlFor="instagram-query">Input</label>
          <input
            id="instagram-query"
            value={value}
            placeholder={inputModes.find((item) => item.id === mode)?.placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") startScrape(); }}
          />

          <div className="number-row">
            <label>
              Count
              <input min="1" max="20" type="number" value={maxResults} onChange={(event) => setMaxResults(event.target.value)} />
            </label>
            <label>
              Recent days
              <input min="1" max="365" type="number" value={recentDays} onChange={(event) => setRecentDays(event.target.value)} />
            </label>
          </div>

          <button type="button" className="scraper-primary" onClick={startScrape}>
            Start scrape
          </button>

          {keywords.length > 0 && (
            <div className="quick-picks">
              {keywords.map((item) => (
                <button key={item} type="button" onClick={() => setValue(item.replace(/^[@#]/, ""))}>
                  {item}
                </button>
              ))}
            </div>
          )}

          {error && <div className="scraper-error">{error}</div>}
        </div>

        <div className="scraper-results">
          <div className="results-head">
            <div>
              <p className="scraper-kicker">Dataset</p>
              <h2>{status === "done" ? `${results.length} results` : "Ready"}</h2>
            </div>
            <div className="export-row">
              <button type="button" onClick={exportJson} disabled={!results.length}>JSON</button>
              <button type="button" onClick={exportCsv} disabled={!results.length}>CSV</button>
            </div>
          </div>

          {results.length === 0 ? (
            <div className="empty-results">Run a scrape to see posts, reels, metrics, captions, and export files here.</div>
          ) : (
            <div className="table-frame">
              <table>
                <thead>
                  <tr>
                    <th>Post</th>
                    <th>Author</th>
                    <th>Likes</th>
                    <th>Comments</th>
                    <th>Followers</th>
                    <th>Published</th>
                    <th>Caption</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((item, index) => (
                    <tr key={`${item.post_url}-${index}`}>
                      <td>
                        <a href={item.post_url} target="_blank" rel="noreferrer">
                          {item.thumbnail_url && <img src={item.thumbnail_url} alt="" />}
                          Open
                        </a>
                      </td>
                      <td>{item.display_name || item.username || "Unknown"}</td>
                      <td>{formatNumber(item.likes)}</td>
                      <td>{formatNumber(item.comments_count)}</td>
                      <td>{formatNumber(item.follower_count)}</td>
                      <td>{formatDate(item.timestamp)}</td>
                      <td className="caption-cell">{item.caption || "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
