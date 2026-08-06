"use client";

import React, { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_INSTAGRAM_API_URL || "/api/scraping/instagram";
const DEFAULT_MAX_RESULTS = 10;
const RANGE_TYPES = ["date", "month", "year"];
const COLLECTION_MODES = [
  { id: "latest", label: "Latest" },
  { id: "range", label: "Range" },
  { id: "engagement", label: "Analyze Profile" }
];
const ANALYSIS_TABS = [
  { id: "watched", label: "Most Watched" },
  { id: "liked", label: "Most Liked" },
  { id: "discussed", label: "Most Discussed" },
  { id: "patterns", label: "Content Patterns" }
];

const inputModes = [
  {
    id: "profile",
    label: "Profile",
    symbol: "@",
    prefix: "@",
    fieldLabel: "Username",
    placeholder: "Enter username"
  },
  {
    id: "keyword",
    label: "Keyword",
    symbol: "#",
    prefix: "#",
    fieldLabel: "Keyword",
    placeholder: "Enter keyword"
  },
  {
    id: "profile_url",
    label: "Profile URL",
    symbol: "P",
    prefix: "",
    fieldLabel: "Instagram profile URL",
    placeholder: "https://www.instagram.com/username/"
  },
  {
    id: "post_url",
    label: "Post URL",
    symbol: "POST",
    prefix: "",
    fieldLabel: "Instagram post or reel URL",
    placeholder: "https://www.instagram.com/reel/.../"
  }
];

const isProfileInput = (mode) => mode === "profile" || mode === "profile_url";
const isPostInput = (mode) => mode === "post_url";

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

const instagramUrlType = (value) => {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : "https://" + value);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    const path = url.pathname.replace(/\/+$/, "");
    if (/^\/(?:p|reel)\/[^/]+$/i.test(path)) return "post";
    if (/^\/[A-Za-z0-9._]+$/.test(path)) return "profile";
    return null;
  } catch {
    return null;
  }
};

const detectInputMode = (value) => {
  const text = value.trim();
  if (text.startsWith("#")) return { mode: "keyword", value: cleanModeValue("keyword", text) };
  if (text.startsWith("@")) return { mode: "profile", value: cleanModeValue("profile", text) };
  if (/^(https?:\/\/|www\.|instagram\.com\/)/i.test(text)) {
    const mode = instagramUrlType(text) === "post" ? "post_url" : "profile_url";
    return { mode, value: text };
  }
  return { mode: "profile", value: text };
};

const localDateValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const defaultRange = (type) => {
  const now = new Date();
  if (type === "month") {
    const end = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { from: localDateValue(now).slice(0, 7), to: localDateValue(end).slice(0, 7) };
  }
  if (type === "year") {
    const year = String(now.getFullYear());
    return { from: year, to: String(now.getFullYear() - 1) };
  }
  const end = new Date(now);
  end.setDate(end.getDate() - 6);
  return { from: localDateValue(now), to: localDateValue(end) };
};

const rangeLabel = (type, from, to) => {
  const labels = { date: "Dates", month: "Months", year: "Years" };
  return `${labels[type]}: ${from} to ${to}`;
};

const publicInstagramUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "https://www.instagram.com/";

  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://www.instagram.com${raw.startsWith("/") ? raw : `/${raw}`}`);
    url.protocol = "https:";
    url.hostname = "www.instagram.com";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "https://www.instagram.com/";
  }
};

const baseExportColumns = [
  "rank",
  "thumbnail_url",
  "username",
  "display_name",
  "post_url",
  "comments_count",
  "comments_display",
  "comments_exact",
  "comments_hidden",
  "likes",
  "likes_display",
  "likes_exact",
  "likes_hidden",
  "follower_count",
  "follower_count_display",
  "top_comments",
  "timestamp"
];

const engagementExportColumns = [
  ...baseExportColumns,
  "views",
  "views_display",
  "views_exact"
];

async function apiGet(path) {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) return {};
  return response.json();
}

async function apiGetRequired(path) {
  const response = await fetch(`${API_URL}${path}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.message || `Request failed (${response.status})`);
  }
  return data;
}

async function apiPost(path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.message || `Scrape failed (${response.status})`);
  }
  return data;
}

function InstagramScraperConsole() {
  const [inputMode, setInputMode] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [maxResults, setMaxResults] = useState(DEFAULT_MAX_RESULTS);
  const [collectionMode, setCollectionMode] = useState("latest");
  const [rangeType, setRangeType] = useState("date");
  const initialRange = defaultRange("date");
  const [rangeFrom, setRangeFrom] = useState(initialRange.from);
  const [rangeTo, setRangeTo] = useState(initialRange.to);
  const [results, setResults] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [analysisTab, setAnalysisTab] = useState("watched");
  const [keywords, setKeywords] = useState([]);
  const [page, setPage] = useState("start");
  const [error, setError] = useState(null);
  const [lastQuery, setLastQuery] = useState("");
  const [lastWorkflowLabel, setLastWorkflowLabel] = useState("Latest posts and reels");
  const [lastCollectionMode, setLastCollectionMode] = useState("latest");
  const [lastInputMode, setLastInputMode] = useState(null);
  const [workingStatus, setWorkingStatus] = useState("Preparing scrape");
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
    if (isPostInput(mode) || (!isProfileInput(mode) && collectionMode === "engagement")) {
      setCollectionMode("latest");
    }
    setError(null);
  };

  const selectSavedQuery = (value) => {
    const detected = detectInputMode(value);
    setInputMode(detected.mode);
    setInputValue(detected.value);
    if (isPostInput(detected.mode) || (!isProfileInput(detected.mode) && collectionMode === "engagement")) {
      setCollectionMode("latest");
    }
    setError(null);
  };

  const selectCollectionMode = (mode) => {
    if (isPostInput(inputMode) || (mode === "engagement" && !isProfileInput(inputMode))) return;
    setCollectionMode(mode);
    setError(null);
  };

  const selectRangeType = (type) => {
    const nextRange = defaultRange(type);
    setRangeType(type);
    setRangeFrom(nextRange.from);
    setRangeTo(nextRange.to);
    setError(null);
  };

  const startScrape = async () => {
    if (!inputMode) {
      setError("Select Profile, Keyword, Profile URL, or Post URL first.");
      return;
    }

    const cleanQuery = composeScrapeQuery(inputMode, inputValue);
    if (!cleanQuery) {
      setError(inputMode === "profile_url" || inputMode === "post_url"
        ? "Paste the selected Instagram URL type."
        : "Enter text for the selected input type.");
      return;
    }
    const selectedUrlType = instagramUrlType(cleanQuery);
    if (inputMode === "profile_url" && selectedUrlType !== "profile") {
      setError("Enter an Instagram profile URL, not a post or reel URL.");
      return;
    }
    if (inputMode === "post_url" && selectedUrlType !== "post") {
      setError("Enter an Instagram post or reel URL.");
      return;
    }
    const effectiveCollectionMode = isPostInput(inputMode) ? "latest" : collectionMode;
    if (effectiveCollectionMode === "range" && (!rangeFrom || !rangeTo)) {
      setError("Choose both the range start and end.");
      return;
    }

    setError(null);
    setResults([]);
    setAnalysis(null);
    setAnalysisTab("watched");
    setLastQuery(cleanQuery);
    setLastWorkflowLabel(
      isPostInput(inputMode)
        ? "Single post"
        : effectiveCollectionMode === "range"
        ? rangeLabel(rangeType, rangeFrom, rangeTo)
        : effectiveCollectionMode === "engagement"
          ? "Profile analysis"
          : "Latest posts and reels"
    );
    setLastCollectionMode(effectiveCollectionMode);
    setLastInputMode(inputMode);
    setWorkingStatus("Preparing scrape");
    setPage("working");

    try {
      const payload = {
        mode: inputMode,
        keyword: cleanQuery,
        max_results: isPostInput(inputMode) ? 1 : maxResults,
        collection_mode: effectiveCollectionMode,
        ...(effectiveCollectionMode === "range" ? {
          range_type: rangeType,
          range_from: rangeFrom,
          range_to: rangeTo
        } : {}),
        timezone_offset_minutes: new Date().getTimezoneOffset(),
        auto_expand_days: false,
        max_auto_expand_days: 1
      };
      const created = await apiPost("/jobs", payload);
      const jobId = created?.job?.id;
      if (!jobId) throw new Error("The background scrape could not be created.");

      setWorkingStatus("Scraping public pages");
      let data = await apiPost(`/jobs/${jobId}/run`, {});
      const deadline = Date.now() + 16 * 60_000;
      let pollingFailures = 0;
      while (data?.job?.status !== "complete") {
        if (data?.job?.status === "failed") {
          throw new Error(data.job.error || "Scrape failed");
        }
        if (Date.now() >= deadline) {
          throw new Error("The scrape took too long. Try a smaller count or range.");
        }
        setWorkingStatus(data?.job?.status === "running" ? "Collecting visible data" : "Waiting to start");
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        try {
          data = await apiGetRequired(`/jobs/${jobId}`);
          pollingFailures = 0;
        } catch (pollError) {
          pollingFailures += 1;
          if (pollingFailures >= 5) throw pollError;
          setWorkingStatus("Reconnecting to background job");
        }
      }
      setResults(data?.results || []);
      setAnalysis(data?.analysis || data?.run?.analysis || null);
      setLastQuery(data?.run?.query || cleanQuery);
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

  const formatPercentage = (value) => (
    value === undefined || value === null ? "N/A" : `${Number(value).toFixed(2)}%`
  );

  const formatPostMetric = (post, metric) => {
    const hidden = metric === "likes" ? post.likes_hidden : post.comments_hidden;
    const display = metric === "likes" ? post.likes_display : post.comments_display;
    return hidden ? "Hidden" : display || formatNumber(post[metric]);
  };

  const formatViewMetric = (post) => post.views_display || formatNumber(post.views);

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
    const data = analysis ? { analysis, results } : results;
    download(JSON.stringify(data, null, 2), "instagram-results.json", "application/json");
  };

  const exportCsv = () => {
    const exportColumns = lastCollectionMode === "engagement" ? engagementExportColumns : baseExportColumns;
    const analysisRows = analysisTab === "liked"
      ? analysis?.top_liked
      : analysisTab === "discussed"
        ? analysis?.top_discussed
        : analysis?.top_watched;
    const exportResults = lastCollectionMode === "engagement" && analysisRows?.length
      ? analysisRows
      : results;
    const escapeCell = (value) => {
      if (value === undefined || value === null) return "";
      const text = Array.isArray(value) || typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [
      exportColumns.join(","),
      ...exportResults.map((item, index) => exportColumns.map((key) => (
        key === "rank" ? index + 1 : escapeCell(item[key])
      )).join(","))
    ];
    download(rows.join("\n"), "instagram-results.csv", "text/csv");
  };

  const renderRankingTable = (posts, primaryMetric) => {
    const primaryLabels = {
      views: "Views",
      likes: "Likes",
      comments_count: "Comments"
    };
    return posts.length === 0 ? (
      <div className="analysis-empty">
        {primaryMetric === "views"
          ? "Instagram did not expose current public view counts for this run."
          : `Instagram did not expose public ${primaryLabels[primaryMetric].toLowerCase()} for the analyzed posts.`}
      </div>
    ) : (
      <div className="analysis-table-wrap">
        <table className="analysis-ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Content</th>
              <th>Profile</th>
              <th className="is-primary-metric">{primaryLabels[primaryMetric]}</th>
              {primaryMetric !== "views" && <th>Views</th>}
              {primaryMetric !== "likes" && <th>Likes</th>}
              {primaryMetric !== "comments_count" && <th>Comments</th>}
              <th>Posted</th>
              <th>Post</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post, index) => (
              <tr key={`${primaryMetric}-${post.post_url}-${index}`}>
                <td className="rank-number">{index + 1}</td>
                <td>
                  <div className="rank-content">
                    <div className="mini-thumb">
                      {post.thumbnail_url ? <img src={post.thumbnail_url} alt="" /> : <span />}
                    </div>
                    <div>
                      <strong>{/\/reel\//i.test(post.post_url) ? "Reel" : "Post"}</strong>
                      <span>{relativeDate(post.timestamp)}</span>
                    </div>
                  </div>
                </td>
                <td>
                  {post.username ? (
                    <a
                      href={publicInstagramUrl(post.profile_url || `/${post.username}/`)}
                      target="_blank"
                      rel="external noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      @{post.username}
                    </a>
                  ) : "N/A"}
                </td>
                <td className="is-primary-metric">
                  {primaryMetric === "views"
                    ? formatViewMetric(post)
                    : formatPostMetric(post, primaryMetric)}
                </td>
                {primaryMetric !== "views" && <td>{formatViewMetric(post)}</td>}
                {primaryMetric !== "likes" && <td>{formatPostMetric(post, "likes")}</td>}
                {primaryMetric !== "comments_count" && <td>{formatPostMetric(post, "comments_count")}</td>}
                <td>{formatDate(post.timestamp)}</td>
                <td>
                  <a
                    href={publicInstagramUrl(post.post_url)}
                    target="_blank"
                    rel="external noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    Open
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderPatternItems = (items) => (
    items?.length ? (
      <div className="pattern-items">
        {items.map((item) => (
          <span key={item.label}><strong>{item.label}</strong><small>{item.count}</small></span>
        ))}
      </div>
    ) : <p className="pattern-empty">N/A</p>
  );

  if (page === "working") {
    return (
      <main className="instagram-scraper-app work-page">
        <div className="loader-ring" />
        <p className="eyebrow">{workingStatus}</p>
        <h1>
          {isPostInput(lastInputMode)
            ? "Fetching the post"
            : lastCollectionMode === "engagement"
            ? "Analyzing the profile"
            : lastCollectionMode === "range"
              ? "Collecting the selected range"
              : "Fetching latest posts and reels"}
        </h1>
        <p className="work-copy">
          Opening public Instagram pages, closing popups, and collecting visible data for {lastQuery}.
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
            <p className="subtle">
              {lastWorkflowLabel}. {lastCollectionMode === "engagement"
                ? "Public performance and content patterns."
                : isPostInput(lastInputMode)
                  ? "Public data for this post."
                : lastCollectionMode === "range"
                  ? "Following the selected direction."
                  : "Newest first."}
            </p>
          </div>
          <div className="toolbar">
            <button onClick={() => setPage("start")}>New Search</button>
            <button onClick={exportJson} disabled={!results.length && !analysis}>JSON</button>
            <button onClick={exportCsv} disabled={!results.length && !analysis}>CSV</button>
          </div>
        </header>

        {lastCollectionMode === "engagement" && analysis ? (
          <section className="analysis-dashboard">
            <div className="analysis-overview">
              <div className="profile-identity">
                <span>Profile report</span>
                <h2>{analysis.display_name || analysis.username || "Instagram profile"}</h2>
                {analysis.username && (
                  <a
                    href={publicInstagramUrl(analysis.profile_url || `/${analysis.username}/`)}
                    target="_blank"
                    rel="external noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    @{analysis.username}
                  </a>
                )}
              </div>
              <div className="analysis-meta">
                <span>Updated {formatDate(analysis.captured_at)}</span>
                <span>{formatNumber(analysis.analyzed_posts)} public posts and reels analyzed</span>
              </div>
            </div>

            <div className="metric-grid">
              <article className="metric-card">
                <span>Followers</span>
                <strong>{formatNumber(analysis.follower_count)}</strong>
                <small>
                  {analysis.follower_count_display
                    ? `Instagram displays ${analysis.follower_count_display}`
                    : "Current public profile count"}
                </small>
              </article>
              <article className="metric-card">
                <span>Posts analyzed</span>
                <strong>{formatNumber(analysis.analyzed_posts)}</strong>
                <small>{formatNumber(analysis.posting_frequency?.posts_last_30_days)} in the last 30 days</small>
              </article>
              <article className="metric-card">
                <span>Average views</span>
                <strong>{formatNumber(analysis.averages?.views)}</strong>
                <small>Reels with public views</small>
              </article>
              <article className="metric-card">
                <span>Average likes</span>
                <strong>{formatNumber(analysis.averages?.likes)}</strong>
                <small>Visible likes only</small>
              </article>
              <article className="metric-card">
                <span>Average comments</span>
                <strong>{formatNumber(analysis.averages?.comments)}</strong>
                <small>Visible comments only</small>
              </article>
              <article className="metric-card">
                <span>Estimated engagement rate</span>
                <strong>{formatPercentage(analysis.engagement_rate)}</strong>
                <small>Using the public follower value</small>
              </article>
              <article className="metric-card">
                <span>Observed frequency</span>
                <strong>{formatNumber(analysis.posting_frequency?.posts_per_week)}</strong>
                <small>Analyzed posts per week</small>
              </article>
            </div>

            <nav className="analysis-tabs" aria-label="Profile analysis views">
              {ANALYSIS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={analysisTab === tab.id ? "is-active" : ""}
                  onClick={() => setAnalysisTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="analysis-view">
              {analysisTab === "watched" && renderRankingTable(analysis.top_watched || [], "views")}
              {analysisTab === "liked" && renderRankingTable(analysis.top_liked || [], "likes")}
              {analysisTab === "discussed" && renderRankingTable(analysis.top_discussed || [], "comments_count")}

              {analysisTab === "patterns" && (
                <div className="patterns-view">
                  <section className="format-summary">
                    <div><strong>{formatNumber(analysis.patterns?.formats?.reels)}</strong><span>Reels</span></div>
                    <div><strong>{formatNumber(analysis.patterns?.formats?.posts)}</strong><span>Posts</span></div>
                  </section>
                  <section className="pattern-section">
                    <h3>Top hashtags</h3>
                    {renderPatternItems(analysis.patterns?.hashtags)}
                  </section>
                  <section className="pattern-section">
                    <h3>Common caption words</h3>
                    {renderPatternItems(analysis.patterns?.keywords)}
                  </section>
                  <section className="pattern-section">
                    <h3>Posting days</h3>
                    {renderPatternItems(analysis.patterns?.posting_days)}
                  </section>
                  <section className="pattern-section">
                    <h3>Posting times</h3>
                    {renderPatternItems(analysis.patterns?.posting_hours)}
                  </section>
                </div>
              )}

            </div>

            <footer className="accuracy-strip">
              <strong>Data quality</strong>
              <span>{analysis.accuracy?.source || "Public Instagram pages"}</span>
              <span>{analysis.accuracy?.followers || "Instagram's visible follower value"}</span>
              <span>{analysis.accuracy?.views || "Public Reels grid values"}</span>
              <span>{analysis.accuracy?.missing_metrics || "Missing metrics shown as N/A"}</span>
              <span>Captured {formatDate(analysis.captured_at)}</span>
            </footer>
          </section>
        ) : results.length === 0 ? (
          <div className="empty-panel">
            Public Instagram did not return usable data for this input. Check that the selected profile, post, or reel is public.
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
                        <div className="author-cell">
                          <strong>{post.display_name || post.username || "Unknown"}</strong>
                          {post.username && (
                            <a
                              href={publicInstagramUrl(post.profile_url || `/${post.username}/`)}
                              target="_blank"
                              rel="external noopener noreferrer"
                              referrerPolicy="no-referrer"
                            >
                              @{post.username}
                            </a>
                          )}
                        </div>
                      </td>
                      <td>
                        <a
                          href={publicInstagramUrl(post.post_url)}
                          target="_blank"
                          rel="external noopener noreferrer"
                          referrerPolicy="no-referrer"
                        >
                          Open post
                        </a>
                      </td>
                      <td>{formatPostMetric(post, "comments_count")}</td>
                      <td>{formatPostMetric(post, "likes")}</td>
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
        <h1>Instagram scraper</h1>
        <p>Public post and reel data.</p>
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
                  <span className="mode-symbol">{item.symbol}</span>
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
                    type={inputMode === "profile_url" || inputMode === "post_url" ? "url" : "text"}
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

        {!isPostInput(inputMode) && (
          <fieldset className="workflow-picker">
            <legend>Choose collection</legend>
            <div className="workflow-options">
              {COLLECTION_MODES
                .filter((item) => item.id !== "engagement" || isProfileInput(inputMode))
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={collectionMode === item.id ? "is-selected" : ""}
                    onClick={() => selectCollectionMode(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
            </div>
          </fieldset>
        )}

        {!isPostInput(inputMode) && collectionMode === "range" && (
          <div className="range-builder">
            <div className="range-heading">
              <span>Range unit</span>
              <div className="range-type-picker" aria-label="Post range type">
                {RANGE_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={rangeType === type ? "is-selected" : ""}
                    onClick={() => selectRangeType(type)}
                  >
                    {type === "date" ? "Date" : type === "month" ? "Month" : "Year"}
                  </button>
                ))}
              </div>
            </div>

            <div className="range-fields">
              <div>
                <label htmlFor="range-from">Start</label>
                <input
                  id="range-from"
                  type={rangeType === "year" ? "number" : rangeType}
                  min={rangeType === "year" ? "2010" : undefined}
                  max={rangeType === "year"
                    ? String(new Date().getFullYear())
                    : rangeType === "month"
                      ? localDateValue(new Date()).slice(0, 7)
                      : localDateValue(new Date())}
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="range-to">End</label>
                <input
                  id="range-to"
                  type={rangeType === "year" ? "number" : rangeType}
                  min={rangeType === "year" ? "2010" : undefined}
                  max={rangeType === "year"
                    ? String(new Date().getFullYear())
                    : rangeType === "month"
                      ? localDateValue(new Date()).slice(0, 7)
                      : localDateValue(new Date())}
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <div className={`launch-row ${isPostInput(inputMode) ? "is-single-post" : ""}`}>
          {!isPostInput(inputMode) && (
            <div className="count-field">
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
          )}
          <button className="primary-button" onClick={() => startScrape()}>
            {isPostInput(inputMode) ? "Scrape Post" : "Start Scraping"}
          </button>
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

export default InstagramScraperConsole;
