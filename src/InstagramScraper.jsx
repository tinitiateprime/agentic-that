import React, { useEffect, useMemo, useState } from "react";
import "./InstagramScraper.css";

const API_URL = "/api/scraping/instagram";
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_RECENT_DAYS = 7;

const inputModes = [
  {
    id: "profile",
    label: "Profile",
    prefix: "@",
    fieldLabel: "Username",
    placeholder: "Enter username"
  },
  {
    id: "keyword",
    label: "Keyword",
    prefix: "#",
    fieldLabel: "Keyword",
    placeholder: "Enter keyword"
  },
  {
    id: "url",
    label: "URL",
    prefix: "",
    fieldLabel: "Instagram URL",
    placeholder: "Enter URL"
  }
];

const cleanModeValue = (mode, value) => {
  const text = value.trim();
  if (mode === "profile") return text.replace(/^@+/, "").trim();
  if (mode === "keyword") return text.replace(/^#+/, "").trim();
  return text;
};

const composeScrapeQuery = (mode, value) => {
  const cleanValue = cleanModeValue(mode, value);
  if (!cleanValue) return "";
  if (mode === "profile") return `@${cleanValue}`;
  if (mode === "keyword") return `#${cleanValue}`;
  return cleanValue;
};

const detectInputMode = (value) => {
  const text = value.trim();
  if (text.startsWith("#")) return { mode: "keyword", value: cleanModeValue("keyword", text) };
  if (text.startsWith("@")) return { mode: "profile", value: cleanModeValue("profile", text) };
  if (/^(https?:\/\/|www\.|instagram\.com\/)/i.test(text)) return { mode: "url", value: text };
  return { mode: "profile", value: text };
};

const dateFromRecentDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - Math.max(1, Number(days) || 1));
  return date.toISOString().slice(0, 10);
};

const exportColumns = [
  "rank",
  "thumbnail_url",
  "username",
  "display_name",
  "post_url",
  "comments_count",
  "likes",
  "follower_count",
  "top_comments",
  "timestamp"
];

async function apiGet(path) {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) return {};
  return response.json();
}

async function apiPost(path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.message || "Scrape failed");
  }
  return data;
}

function InstagramScraper() {
  const [inputMode, setInputMode] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [maxResults, setMaxResults] = useState(DEFAULT_MAX_RESULTS);
  const [recentDays, setRecentDays] = useState(DEFAULT_RECENT_DAYS);
  const [results, setResults] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [page, setPage] = useState("start");
  const [error, setError] = useState(null);
  const [lastQuery, setLastQuery] = useState("");
  const onlyPostsNewerThan = useMemo(() => dateFromRecentDays(recentDays), [recentDays]);
  const activeInputMode = inputModes.find((item) => item.id === inputMode);

  useEffect(() => {
    const htmlBackground = document.documentElement.style.background;
    const htmlColor = document.documentElement.style.color;
    const bodyBackground = document.body.style.background;

    document.documentElement.style.background = "#f4f6f8";
    document.documentElement.style.color = "#17202a";
    document.body.style.background = "#f4f6f8";

    return () => {
      document.documentElement.style.background = htmlBackground;
      document.documentElement.style.color = htmlColor;
      document.body.style.background = bodyBackground;
    };
  }, []);

  useEffect(() => {
    apiGet("/runs/keywords")
      .then((data) => setKeywords(data.keywords || []))
      .catch(() => {});
  }, []);

  const selectInputMode = (mode) => {
    setInputMode(mode);
    setInputValue((value) => cleanModeValue(mode, value));
    setError(null);
  };

  const selectSavedQuery = (value) => {
    const detected = detectInputMode(value);
    setInputMode(detected.mode);
    setInputValue(detected.value);
    setError(null);
  };

  const startScrape = async () => {
    if (!inputMode) {
      setError("Select Profile, Keyword, or URL first.");
      return;
    }

    const cleanQuery = composeScrapeQuery(inputMode, inputValue);
    if (!cleanQuery) {
      setError(inputMode === "url" ? "Paste an Instagram URL." : "Enter text for the selected input type.");
      return;
    }

    setError(null);
    setResults([]);
    setLastQuery(cleanQuery);
    setPage("working");

    try {
      const data = await apiPost("/scrape", {
        keyword: cleanQuery,
        max_results: maxResults,
        recent_days: recentDays,
        only_posts_newer_than: onlyPostsNewerThan,
        auto_expand_days: true,
        max_auto_expand_days: 365
      });
      setResults(data?.results || []);
      setPage("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scrape failed");
      setPage("start");
    }
  };

  const formatNumber = (value) => {
    if (value === undefined || value === null) return "N/A";
    return Number(value).toLocaleString();
  };

  const formatDate = (value) => {
    if (!value) return "N/A";
    return new Date(value).toLocaleString();
  };

  const relativeDate = (value) => {
    if (!value) return "Unknown";
    const postDate = new Date(value);
    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;
    const age = Math.floor((now.setHours(0, 0, 0, 0) - postDate.setHours(0, 0, 0, 0)) / oneDay);
    if (age <= 0) return "Today";
    if (age === 1) return "Yesterday";
    return `${age} days ago`;
  };

  const download = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    download(JSON.stringify(results, null, 2), "instagram-results.json", "application/json");
  };

  const exportCsv = () => {
    const escapeCell = (value) => {
      if (value === undefined || value === null) return "";
      const text = Array.isArray(value) || typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [
      exportColumns.join(","),
      ...results.map((item, index) => exportColumns.map((key) => (
        key === "rank" ? index + 1 : escapeCell(item[key])
      )).join(","))
    ];
    download(rows.join("\n"), "instagram-results.csv", "text/csv");
  };

  if (page === "working") {
    return (
      <main className="instagram-scraper-app work-page">
        <div className="loader-ring" />
        <p className="eyebrow">Agent is working</p>
        <h1>Fetching latest posts and reels</h1>
        <p className="work-copy">
          Starting with posts newer than {onlyPostsNewerThan}; expanding older if needed for {lastQuery}.
        </p>
      </main>
    );
  }

  if (page === "results") {
    return (
      <main className="instagram-scraper-app results-page">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Dataset ready</p>
            <h1>{lastQuery}</h1>
            <p className="subtle">Latest public posts and reels, newest first.</p>
          </div>
          <div className="toolbar">
            <button onClick={() => setPage("start")}>New Search</button>
            <button onClick={exportJson} disabled={!results.length}>JSON</button>
            <button onClick={exportCsv} disabled={!results.length}>CSV</button>
          </div>
        </header>

        {results.length === 0 ? (
          <div className="empty-panel">
            Public Instagram did not return usable posts for this input. Try a public username, #hashtag, or direct reel URL.
          </div>
        ) : (
          <section className="data-panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Post</th>
                    <th>Author</th>
                    <th>Post URL</th>
                    <th>Comments</th>
                    <th>Likes</th>
                    <th>Followers</th>
                    <th>Top comments</th>
                    <th>Posted on</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((post, index) => (
                    <tr key={`${post.post_url}-${index}`}>
                      <td>{index + 1}</td>
                      <td>
                        <div className="post-cell">
                          <div className="mini-thumb">
                            {post.thumbnail_url ? <img src={post.thumbnail_url} alt="" /> : <span />}
                          </div>
                          <span>{relativeDate(post.timestamp)}</span>
                        </div>
                      </td>
                      <td>
                        <strong>{post.display_name || post.username || "Unknown"}</strong>
                      </td>
                      <td><a href={post.post_url} target="_blank" rel="noopener noreferrer">Open post</a></td>
                      <td>{formatNumber(post.comments_count)}</td>
                      <td>{formatNumber(post.likes)}</td>
                      <td>{formatNumber(post.follower_count)}</td>
                      <td>
                        <div className="comment-list">
                          {(post.top_comments || []).slice(0, 5).map((comment, commentIndex) => (
                            <p key={`${comment.username}-${commentIndex}`}>
                              <strong>{comment.username}</strong> {comment.text}
                            </p>
                          ))}
                          {(!post.top_comments || post.top_comments.length === 0) && <span>N/A</span>}
                        </div>
                      </td>
                      <td>{formatDate(post.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="instagram-scraper-app start-page">
      <section className="intro-panel">
        <p className="eyebrow">Instagram intelligence</p>
        <h1>Build a clean latest-post dataset</h1>
        <p>
          Choose Profile, Keyword, or URL, then enter the value. Recent days is tried first, then older posts are added if needed.
        </p>
      </section>

      <section className="launch-panel">
        <div className={`input-builder ${inputMode ? "is-active" : ""}`}>
          <fieldset className="mode-picker">
            <legend>Choose input type</legend>
            <div className="mode-options">
              {inputModes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mode-button ${inputMode === item.id ? "is-selected" : ""}`}
                  onClick={() => selectInputMode(item.id)}
                >
                  <span className="mode-symbol">{item.prefix || "URL"}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className={`guided-input ${inputMode ? "is-visible" : ""}`}>
            {activeInputMode && (
              <>
                <label htmlFor="query">{activeInputMode.fieldLabel}</label>
                <div className="prefixed-input">
                  {activeInputMode.prefix && (
                    <span className="input-prefix" aria-hidden="true">{activeInputMode.prefix}</span>
                  )}
                  <input
                    id="query"
                    type={inputMode === "url" ? "url" : "text"}
                    placeholder={activeInputMode.placeholder}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") startScrape();
                    }}
                    autoFocus
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="launch-row">
          <div>
            <label htmlFor="count">Count</label>
            <input
              id="count"
              type="number"
              min="1"
              max="50"
              value={maxResults}
              onChange={(e) => setMaxResults(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div>
            <label htmlFor="recent-days">Recent days</label>
            <input
              id="recent-days"
              type="number"
              min="1"
              max="30"
              value={recentDays}
              onChange={(e) => setRecentDays(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <button className="primary-button" onClick={startScrape}>Save & Start</button>
        </div>

        {keywords.length > 0 && (
          <div className="quick-row">
            {keywords.slice(0, 7).map((item) => (
              <button key={item} onClick={() => selectSavedQuery(item)}>{item}</button>
            ))}
          </div>
        )}

        {error && <div className="error-box">{error}</div>}
      </section>
    </main>
  );
}

export default InstagramScraper;
