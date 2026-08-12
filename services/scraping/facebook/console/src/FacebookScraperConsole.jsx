"use client";

import React from "react";
import InstagramScraperConsole from "../../../instagram/console/src/InstagramScraperConsole";
import { getFacebookCompanionStatus, runFacebookCompanionJob } from "./companionClient";

const FACEBOOK_API_URL = process.env.NEXT_PUBLIC_FACEBOOK_API_URL || "/api/scraping/facebook";

const facebookInputModes = [
  {
    id: "profile",
    label: "Profile",
    symbol: "f",
    prefix: "@",
    fieldLabel: "Page or public profile username",
    placeholder: "Enter username",
  },
  {
    id: "keyword",
    label: "Keyword / hashtag",
    symbol: "#",
    prefix: "#",
    fieldLabel: "Keyword or hashtag",
    placeholder: "Enter keyword or hashtag",
  },
  {
    id: "profile_url",
    label: "Profile URL",
    symbol: "P",
    prefix: "",
    fieldLabel: "Facebook Page or profile URL",
    placeholder: "https://www.facebook.com/pagename/",
  },
  {
    id: "post_url",
    label: "Post URL",
    symbol: "POST",
    prefix: "",
    fieldLabel: "Facebook post, Reel, photo, or video URL",
    placeholder: "https://www.facebook.com/reel/.../",
  },
];

function cleanFacebookValue(mode, value) {
  const text = String(value || "").trim();
  if (mode === "profile") return text.replace(/^@+/, "").trim();
  if (mode === "keyword") return text.replace(/^#+/, "").trim();
  return text;
}

function composeFacebookQuery(mode, value) {
  const raw = String(value || "").trim();
  const clean = cleanFacebookValue(mode, raw);
  if (!clean) return "";
  return mode === "keyword" && raw.startsWith("#") ? `#${clean}` : clean;
}

function facebookUrlType(value) {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "facebook.com" && !host.endsWith(".facebook.com") && host !== "fb.watch") return null;
    const target = `${url.pathname}${url.search}`;
    if (host === "fb.watch" || /\/(?:posts|videos|reel|watch|photo|story\.php|permalink\.php)(?:\/|\?|$)/i.test(target)
      || /^\/share\/(?:p|r|v)\//i.test(url.pathname) || url.searchParams.has("story_fbid")
      || url.searchParams.has("fbid") || url.searchParams.has("v")) return "post";
    if (/^\/(?:login|checkpoint|recover|help|search|groups|events|marketplace|gaming|watch|hashtag|plugins|share)(?:\/|$)/i.test(url.pathname)) return null;
    return "profile";
  } catch {
    return null;
  }
}

function detectFacebookInput(value) {
  const text = String(value || "").trim();
  if (text.startsWith("#")) return { mode: "keyword", value: cleanFacebookValue("keyword", text) };
  if (text.startsWith("@")) return { mode: "profile", value: cleanFacebookValue("profile", text) };
  if (/^(?:https?:\/\/|www\.|facebook\.com\/|fb\.watch\/)/i.test(text)) {
    return { mode: facebookUrlType(text) === "post" ? "post_url" : "profile_url", value: text };
  }
  return { mode: "profile", value: text };
}

function publicFacebookUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "https://www.facebook.com/";
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://www.facebook.com${raw.startsWith("/") ? raw : `/${raw}`}`);
    if (url.hostname.toLowerCase() !== "fb.watch") url.hostname = "www.facebook.com";
    url.protocol = "https:";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (["__tn__", "mibextid", "ref", "refid", "rdid", "share_url"].includes(key)
        || key.startsWith("__cft__") || key.startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return "https://www.facebook.com/";
  }
}

function facebookHandle(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(?:https?:\/\/|www\.|facebook\.com\/)/i.test(raw)) {
    try {
      const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return "";
      if (url.pathname.toLowerCase() === "/profile.php") {
        const id = url.searchParams.get("id");
        return id ? `profile.php?id=${id}` : "";
      }
      const path = url.pathname.replace(/^\/+|\/+$/g, "");
      return path && !/\s/.test(path)
        && !/^(?:groups|events|marketplace|gaming|watch|hashtag|plugins|share)(?:\/|$)/i.test(path)
        ? path
        : "";
    } catch {
      return "";
    }
  }
  const handle = raw.replace(/^@+/, "").replace(/^\/+|\/+$/g, "");
  return /^[A-Za-z0-9._-]+$/.test(handle) ? handle : "";
}

function handleFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.pathname.toLowerCase() === "/profile.php") return url.searchParams.get("id") || "";
    return url.pathname.split("/").filter(Boolean)[0] || "";
  } catch {
    return "";
  }
}

function normalizePost(post = {}) {
  const username = handleFromUrl(post.author_url) || post.author_name || "";
  return {
    ...post,
    username,
    display_name: post.author_name || username || null,
    profile_url: post.author_url || null,
    caption: post.content || null,
    likes: post.reactions_count,
    likes_display: post.reactions_display,
    likes_exact: post.reactions_exact,
    likes_hidden: false,
    comments_hidden: false,
    top_comments: [],
    views: post.views_count,
    views_fresh: post.views_count !== null && post.views_count !== undefined,
    views_source: post.metric_source,
    views_captured_at: post.captured_at,
  };
}

function formatCounts(items = []) {
  const result = { reels: 0, posts: 0 };
  for (const item of items) {
    if (item?.label === "reel") result.reels += Number(item.count) || 0;
    else result.posts += Number(item?.count) || 0;
  }
  return result;
}

function normalizeAnalysis(analysis) {
  if (!analysis) return null;
  const username = handleFromUrl(analysis.profile_url) || analysis.profile_name || "";
  return {
    ...analysis,
    username,
    display_name: analysis.profile_name || username || null,
    candidate_target: analysis.analyzed_posts,
    averages: {
      views: analysis.averages?.views ?? null,
      likes: analysis.averages?.reactions ?? null,
      comments: analysis.averages?.comments ?? null,
    },
    top_watched: (analysis.top_viewed || []).map(normalizePost),
    top_liked: (analysis.top_reacted || []).map(normalizePost),
    top_discussed: (analysis.top_discussed || []).map(normalizePost),
    patterns: {
      ...analysis.patterns,
      formats: formatCounts(analysis.patterns?.formats),
    },
    accuracy: {
      ...analysis.accuracy,
      likes: analysis.accuracy?.reactions,
      missing_metrics: "Metrics Facebook did not expose remain N/A",
    },
  };
}

function normalizeFacebookJob(data = {}) {
  const results = (data.results || data.run?.results || []).map(normalizePost);
  const analysis = normalizeAnalysis(data.analysis || data.run?.analysis);
  return {
    ...data,
    results,
    analysis,
    run: data.run ? { ...data.run, results, analysis } : data.run,
  };
}

const facebookPlatformConfig = {
  name: "Facebook",
  apiUrl: FACEBOOK_API_URL,
  inputModes: facebookInputModes,
  cleanModeValue: cleanFacebookValue,
  composeScrapeQuery: composeFacebookQuery,
  detectInputMode: detectFacebookInput,
  urlType: facebookUrlType,
  publicUrl: publicFacebookUrl,
  getCompanionStatus: getFacebookCompanionStatus,
  runCompanionJob: runFacebookCompanionJob,
  normalizeJob: normalizeFacebookJob,
  engineStorageKey: "agenticthat-facebook-scrape-engine",
  savedQueriesPath: "/runs/queries",
  savedQueriesKey: "queries",
  exportPrefix: "facebook",
  engagementName: "Reactions",
  showViewsInResults: true,
  showTopComments: false,
  missingDateLabel: "Date unavailable",
  viewsMetricNote: "Collected directly from the Reels grid",
  engagementMetricNote: "Exact values verified for each public Reel",
  commentsMetricNote: "Exact counts verified for each public Reel",
  analysisTabs: [
    { id: "watched", label: "Most Viewed" },
    { id: "liked", label: "Most Reacted" },
    { id: "discussed", label: "Most Discussed" },
    { id: "patterns", label: "Content Patterns" },
  ],
  payload: () => ({ profile_type: "page" }),
  normalizeComparisonInput: facebookHandle,
  comparisonTarget: (value) => value.startsWith("profile.php?id=") || value.includes("/")
    ? { mode: "profile_url", query: publicFacebookUrl(value) }
    : { mode: "profile", query: value },
  comparisonInputHint: "Use each profile's exact Facebook username or paste its full profile URL. A display name such as “Tyler Evans” is not a unique Facebook address; this profile's username is peaktylerr.",
  profileNotFoundMessage: "Facebook could not find that profile address. Paste the exact Facebook profile URL or username—not only the display name.",
  errorMessage: (message) => /temporarily_unavailable|public discovery is temporarily unavailable/i.test(message)
    ? "Facebook did not expose usable public results in this run. Restart the updated Companion, paste the exact Page, profile, or post URL, and retry locally."
    : message,
  resultNotice: ({ status, count, requested, inputMode, engine }) => {
    if (status === "partial" && inputMode === "keyword") {
      return `Facebook returned ${count} of ${requested} requested current keyword results. Facebook limits its anonymous public hashtag feed; no login session or private data was used.`;
    }
    if (status === "partial") return "Facebook returned a partial dataset. Items without a trustworthy visible date or metric were not invented or forced into the results.";
    return "";
  },
};

export default function FacebookScraperConsole({ publishingIdentityToken = "" }) {
  return <InstagramScraperConsole publishingIdentityToken={publishingIdentityToken} platformConfig={facebookPlatformConfig} />;
}
