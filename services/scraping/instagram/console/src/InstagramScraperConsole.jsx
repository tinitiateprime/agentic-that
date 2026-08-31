"use client";

import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowRight,
  AtSign,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  Cloud,
  Download,
  Database,
  FileJson,
  FileSpreadsheet,
  Hash,
  Globe2,
  Laptop,
  LayoutDashboard,
  Link2,
  Play,
  Search,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { getClientServiceToken } from "@platform/client-service-token";
import {
  getInstagramCompanionStatus,
  runInstagramCompanionJob
} from "./companionClient";

const ProfileComparisonWorkspace = dynamic(() => import("./ProfileComparisonWorkspace"), {
  loading: () => (
    <div className="comparison-loading">
      <div className="loader-ring" />
      <span>Opening comparison workspace...</span>
    </div>
  )
});
const InstagramScraperTour = dynamic(() => import("./InstagramScraperTour"), { ssr: false });

// Keep browser traffic on the website origin. Next.js proxies this path to the
// private Ubuntu scraper service; remote users must never receive a localhost URL.
const API_URL = "/api/scraping/instagram";
const DEFAULT_MAX_RESULTS = 10;
const INSTAGRAM_TOUR_STORAGE_KEY = "agenticthat-instagram-scraper-guide-v2";
const TOUR_STEP = {
  welcome: 0,
  engine: 1,
  inputType: 2,
  query: 3,
  collection: 4,
  launch: 5
};
const RANGE_TYPES = ["date", "month", "year"];
const COLLECTION_MODES = [
  { id: "latest", label: "Latest" },
  { id: "range", label: "Range" },
  { id: "engagement", label: "Analyze Profile" },
  { id: "compare", label: "Compare Profiles" }
];
const ANALYSIS_TABS = [
  { id: "watched", label: "Most Watched" },
  { id: "liked", label: "Most Liked" },
  { id: "discussed", label: "Most Discussed" },
  { id: "patterns", label: "Content Patterns" }
];
const SCRAPE_ENGINES = [
  { id: "companion", label: "Companion (recommended)", description: "Best results on this computer" },
  { id: "server", label: "Ubuntu Server", description: "Runs on the shared server" }
];

const INPUT_MODE_ICONS = {
  profile: UserRound,
  keyword: Hash,
  profile_url: Link2,
  post_url: Search,
};

const COLLECTION_MODE_ICONS = {
  latest: Sparkles,
  range: CalendarRange,
  engagement: BarChart3,
  compare: UsersRound,
};

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

const ResultThumbnail = ({ post }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [post.thumbnail_url]);

  return (
    <div className="mini-thumb">
      {post.thumbnail_url && !failed ? (
        <img
          src={post.thumbnail_url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : <span />}
    </div>
  );
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
  "views_exact",
  "views_fresh",
  "views_source",
  "views_captured_at"
];

async function serviceHeaders(identityToken, headers = {}) {
  const token = await getClientServiceToken("scraping", identityToken);
  return { ...headers, authorization: `Bearer ${token}` };
}

async function apiGet(path, serviceUrl = API_URL, identityToken = "") {
  const response = await fetch(`${serviceUrl}${path}`, {
    cache: "no-store",
    headers: await serviceHeaders(identityToken)
  });
  if (!response.ok) return {};
  return response.json();
}

async function apiGetRequired(path, serviceUrl = API_URL, identityToken = "") {
  const response = await fetch(`${serviceUrl}${path}`, {
    cache: "no-store",
    headers: await serviceHeaders(identityToken)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.message || `Request failed (${response.status})`);
  }
  return data;
}

async function apiPost(path, body, serviceUrl = API_URL, identityToken = "") {
  const response = await fetch(`${serviceUrl}${path}`, {
    cache: "no-store",
    method: "POST",
    headers: await serviceHeaders(identityToken, { "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.message || `Scrape failed (${response.status})`);
  }
  return data;
}

async function runInstagramJob(payload, onStatus = () => {}, serviceUrl = API_URL, identityToken = "") {
  const created = await apiPost("/jobs", payload, serviceUrl, identityToken);
  const jobId = created?.job?.id;
  if (!jobId) throw new Error("The background scrape could not be created.");

  onStatus("Scraping public pages");
  let data = await apiPost(`/jobs/${jobId}/run`, {}, serviceUrl, identityToken);
  const deadline = Date.now() + 16 * 60_000;
  let pollingFailures = 0;
  while (data?.job?.status !== "complete") {
    if (data?.job?.status === "failed") {
      throw new Error(data.job.error || "Scrape failed");
    }
    if (Date.now() >= deadline) {
      throw new Error("The scrape took too long. Try a smaller count or range.");
    }
    onStatus(data?.job?.status === "running" ? "Collecting visible data" : "Waiting to start");
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    try {
      data = await apiGetRequired(`/jobs/${jobId}`, serviceUrl, identityToken);
      pollingFailures = 0;
    } catch (pollError) {
      pollingFailures += 1;
      if (pollingFailures >= 5) throw pollError;
      onStatus("Reconnecting to background job");
    }
  }
  return data;
}

function InstagramScraperConsole({ publishingIdentityToken = "", capabilities = null, platformConfig = {} }) {
  const platformName = platformConfig.name || "Instagram";
  const platformLower = platformName.toLowerCase();
  const serviceUrl = platformConfig.apiUrl || API_URL;
  const availableInputModes = platformConfig.inputModes || inputModes;
  const cleanInputValue = platformConfig.cleanModeValue || cleanModeValue;
  const composeQuery = platformConfig.composeScrapeQuery || composeScrapeQuery;
  const detectMode = platformConfig.detectInputMode || detectInputMode;
  const selectedUrlTypeFor = platformConfig.urlType || instagramUrlType;
  const publicPostUrl = platformConfig.publicUrl || publicInstagramUrl;
  const companionStatusCheck = platformConfig.getCompanionStatus || getInstagramCompanionStatus;
  const companionJobRunner = platformConfig.runCompanionJob || runInstagramCompanionJob;
  const normalizeJob = platformConfig.normalizeJob || ((value) => value);
  const engineStorageKey = platformConfig.engineStorageKey || "agenticthat-instagram-scrape-engine";
  const savedQueriesPath = platformConfig.savedQueriesPath || "/runs/keywords";
  const savedQueriesKey = platformConfig.savedQueriesKey || "keywords";
  const exportPrefix = platformConfig.exportPrefix || platformLower;
  const engagementName = platformConfig.engagementName || "Likes";
  const engagementNameLower = engagementName.toLowerCase();
  const analysisTabs = platformConfig.analysisTabs || ANALYSIS_TABS;
  const CustomUserGuide = platformConfig.userGuideComponent || null;
  const userGuideEnabled = platformConfig.userGuideEnabled ?? platformLower === "instagram";
  const userGuideAvailable = userGuideEnabled || Boolean(CustomUserGuide);
  const userGuideLabel = platformConfig.userGuideLabel || "User guide";
  const userGuideStorageKey = platformConfig.userGuideStorageKey || INSTAGRAM_TOUR_STORAGE_KEY;
  const showViewsInResults = Boolean(platformConfig.showViewsInResults);
  const showTopComments = platformConfig.showTopComments !== false;
  const missingDateLabel = platformConfig.missingDateLabel || "Unknown";
  const viewsMetricNote = platformConfig.viewsMetricNote || "From visible Reels values";
  const engagementMetricNote = platformConfig.engagementMetricNote || "From visible grid values";
  const commentsMetricNote = platformConfig.commentsMetricNote || "From visible grid values";
  const canRunScraper = capabilities === null || capabilities.includes("scraping.run");
  const [scrapeEngine, setScrapeEngine] = useState("companion");
  const [companionStatus, setCompanionStatus] = useState({ checking: false, ready: false, message: "" });
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
  const [workspaceRuns, setWorkspaceRuns] = useState([]);
  const [page, setPage] = useState("start");
  const [error, setError] = useState(null);
  const [lastQuery, setLastQuery] = useState("");
  const [lastWorkflowLabel, setLastWorkflowLabel] = useState("Latest posts and reels");
  const [lastCollectionMode, setLastCollectionMode] = useState("latest");
  const [lastInputMode, setLastInputMode] = useState(null);
  const [lastScrapeEngine, setLastScrapeEngine] = useState("companion");
  const [lastDiscoveryStatus, setLastDiscoveryStatus] = useState("ok");
  const [lastDiagnostics, setLastDiagnostics] = useState(null);
  const [cancelActiveScrape, setCancelActiveScrape] = useState(null);
  const [workingStatus, setWorkingStatus] = useState("Preparing scrape");
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(TOUR_STEP.welcome);
  const tourTypingTimer = useRef(null);
  const activeInputMode = availableInputModes.find((item) => item.id === inputMode);
  const guideInputMode = activeInputMode || availableInputModes.find((item) => item.id === "profile") || inputModes[0];
  const guideQueryText = {
    profile: {
      title: "Add an Instagram profile",
      copy: "Enter the username you want to explore. We’ll type an example so you can see the flow."
    },
    keyword: {
      title: "Add a keyword",
      copy: "Type the topic or hashtag you want to discover across public Instagram content."
    },
    profile_url: {
      title: "Paste a profile link",
      copy: "Add a public Instagram profile URL and the scraper will identify the profile for you."
    },
    post_url: {
      title: "Paste a post or Reel",
      copy: "Add the public Instagram URL and the scraper will collect that specific piece of content."
    }
  }[guideInputMode.id] || {
    title: `Add your ${guideInputMode.label.toLowerCase()}`,
    copy: `Enter the ${guideInputMode.label.toLowerCase()} you want to explore.`
  };
  const userGuideSteps = [
    {
      id: "welcome",
      kicker: "Interactive walkthrough",
      title: "See the scraper in action",
      copy: "Follow the new workspace from engine selection to a ready-to-export dataset.",
      note: "Four short steps. Nothing runs until you select Start scraping.",
      nextLabel: "Start guide"
    },
    {
      id: "engine",
      progress: 1,
      target: '[data-tour="engine"]',
      kicker: "Choose where it runs",
      title: "Pick your scraping engine",
      copy: "Use Companion for the strongest local results, or Ubuntu Server for a shared cloud run.",
      note: `${scrapeEngine === "companion" ? "Companion" : "Ubuntu Server"} is currently selected`,
      pointerLabel: "Choose one",
      nextLabel: "Next"
    },
    {
      id: "input-type",
      progress: 2,
      target: '[data-tour="input-type"]',
      kicker: "Tell us what to find",
      title: "Choose an input type",
      copy: "Choose profile, keyword, profile link, or a specific public post. The input field adapts automatically.",
      pointerLabel: "Try Profile",
      nextLabel: "Show the input"
    },
    {
      id: "query",
      progress: 2,
      target: '[data-tour="query-input"]',
      kicker: guideInputMode.label,
      title: guideQueryText.title,
      copy: guideQueryText.copy,
      note: inputValue.trim() ? "Your input is ready" : "Type or paste here",
      pointerLabel: "Input goes here",
      nextLabel: "Continue"
    },
    {
      id: "collection",
      progress: 3,
      target: '[data-tour="collection"]',
      kicker: "Shape the result",
      title: "Choose what to collect",
      copy: "Collect recent content, set a date range, analyze performance, or compare public profiles.",
      note: `${COLLECTION_MODES.find((item) => item.id === collectionMode)?.label || "Latest"} is selected`,
      pointerLabel: "Choose a view",
      nextLabel: "Next"
    },
    {
      id: "launch",
      progress: 4,
      target: '[data-tour="launch"]',
      kicker: "Ready to go",
      title: "Set the size and start",
      copy: "Choose how many results you want, then start scraping. The live progress screen takes over from here.",
      note: "The orange button starts the real scrape",
      pointerLabel: "Start here",
      nextLabel: "Finish guide",
      isLast: true
    }
  ];

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
    const savedEngine = window.localStorage.getItem(engineStorageKey);
    if (savedEngine === "server" || savedEngine === "companion") setScrapeEngine(savedEngine);
  }, []);

  useEffect(() => {
    if (!userGuideAvailable) return undefined;
    let openTimer;
    try {
      if (window.localStorage.getItem(userGuideStorageKey) !== "completed") {
        openTimer = window.setTimeout(() => {
          setTourStep(TOUR_STEP.welcome);
          setTourOpen(true);
        }, 450);
      }
    } catch {
      openTimer = window.setTimeout(() => {
        setTourStep(TOUR_STEP.welcome);
        setTourOpen(true);
      }, 450);
    }
    return () => window.clearTimeout(openTimer);
  }, [userGuideAvailable, userGuideStorageKey]);

  useEffect(() => {
    if (!userGuideEnabled || !tourOpen || tourStep !== TOUR_STEP.query) return undefined;
    if (!inputMode) {
      setInputMode("profile");
      return undefined;
    }
    if (inputMode !== "profile" || inputValue.trim()) return undefined;

    const example = "instagram";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startTimer = window.setTimeout(() => {
      const input = document.querySelector('[data-tour="query-input"] input');
      input?.focus({ preventScroll: true });
      if (reduceMotion) {
        setInputValue(example);
        return;
      }

      let position = 0;
      tourTypingTimer.current = window.setInterval(() => {
        position += 1;
        setInputValue(example.slice(0, position));
        if (position >= example.length) {
          window.clearInterval(tourTypingTimer.current);
          tourTypingTimer.current = null;
        }
      }, 105);
    }, reduceMotion ? 0 : 520);
    tourTypingTimer.current = startTimer;

    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(tourTypingTimer.current);
      tourTypingTimer.current = null;
    };
  }, [inputMode, tourOpen, tourStep, userGuideEnabled]);

  useEffect(() => {
    if (scrapeEngine !== "companion") return;
    let active = true;
    setCompanionStatus({ checking: true, ready: false, message: "Checking Companion…" });
    getClientServiceToken("scraping", publishingIdentityToken)
      .then(token => companionStatusCheck(token))
      .then(status => {
      if (active) setCompanionStatus({ checking: false, ...status });
    });
    return () => { active = false; };
  }, [companionStatusCheck, publishingIdentityToken, scrapeEngine]);

  useEffect(() => {
    apiGet(savedQueriesPath, serviceUrl, publishingIdentityToken)
      .then((data) => setKeywords(data[savedQueriesKey] || []))
      .catch(() => {});
  }, [publishingIdentityToken, savedQueriesKey, savedQueriesPath, serviceUrl]);

  useEffect(() => {
    apiGet("/runs", serviceUrl, publishingIdentityToken)
      .then((data) => setWorkspaceRuns(Array.isArray(data.runs) ? data.runs : []))
      .catch(() => setWorkspaceRuns([]));
  }, [publishingIdentityToken, serviceUrl]);

  const completeUserGuide = () => {
    window.clearTimeout(tourTypingTimer.current);
    window.clearInterval(tourTypingTimer.current);
    tourTypingTimer.current = null;
    setTourOpen(false);
    try {
      window.localStorage.setItem(userGuideStorageKey, "completed");
    } catch {
      // The replay button remains available when browser storage is restricted.
    }
  };

  const openUserGuide = () => {
    setTourStep(TOUR_STEP.welcome);
    setTourOpen(true);
  };

  const moveTourAfterSelection = (currentStep, nextStep) => {
    if (!userGuideEnabled || !tourOpen || tourStep !== currentStep) return;
    window.setTimeout(() => {
      setTourStep((activeStep) => activeStep === currentStep ? nextStep : activeStep);
    }, 280);
  };

  const advanceUserGuide = () => {
    if (tourStep === TOUR_STEP.launch) {
      completeUserGuide();
      return;
    }
    if (tourStep === TOUR_STEP.inputType && !inputMode) {
      setInputMode("profile");
      setInputValue("");
      setError(null);
    }
    if (tourStep === TOUR_STEP.query && isPostInput(inputMode)) {
      setTourStep(TOUR_STEP.launch);
      return;
    }
    setTourStep((activeStep) => Math.min(TOUR_STEP.launch, activeStep + 1));
  };

  const rewindUserGuide = () => {
    if (tourStep === TOUR_STEP.launch && isPostInput(inputMode)) {
      setTourStep(TOUR_STEP.query);
      return;
    }
    setTourStep((activeStep) => Math.max(TOUR_STEP.welcome, activeStep - 1));
  };

  const selectInputMode = (mode) => {
    setInputMode(mode);
    setInputValue((value) => cleanInputValue(mode, value));
    if (isPostInput(mode) || (!isProfileInput(mode) && ["engagement", "compare"].includes(collectionMode))) {
      setCollectionMode("latest");
    }
    setError(null);
    moveTourAfterSelection(TOUR_STEP.inputType, TOUR_STEP.query);
  };

  const selectScrapeEngine = (engine) => {
    setScrapeEngine(engine);
    window.localStorage.setItem(engineStorageKey, engine);
    setError(null);
    moveTourAfterSelection(TOUR_STEP.engine, TOUR_STEP.inputType);
  };

  const runSelectedInstagramJob = async (payload, onStatus) => {
    if (!canRunScraper) throw new Error("Your Scraping Viewer role cannot run a scraper.");
    if (scrapeEngine !== "companion") {
      return normalizeJob(await runInstagramJob(payload, onStatus, serviceUrl, publishingIdentityToken));
    }
    const controller = new AbortController();
    setCancelActiveScrape(() => () => controller.abort());
    try {
      const companionToken = await getClientServiceToken("scraping", publishingIdentityToken);
      const companionResult = await companionJobRunner(payload, onStatus, controller.signal, companionToken);
      onStatus("Saving results to this workspace");
      return normalizeJob(await apiPost(
        "/runs/import-companion",
        { input: payload, result: companionResult },
        serviceUrl,
        publishingIdentityToken,
      ));
    } finally {
      setCancelActiveScrape(null);
    }
  };

  const selectSavedQuery = (value) => {
    const detected = detectMode(value);
    setInputMode(detected.mode);
    setInputValue(detected.value);
    if (isPostInput(detected.mode) || (!isProfileInput(detected.mode) && ["engagement", "compare"].includes(collectionMode))) {
      setCollectionMode("latest");
    }
    setError(null);
  };

  const openWorkspaceRun = (run) => {
    setResults(Array.isArray(run.results) ? run.results : []);
    setAnalysis(run.analysis || null);
    setLastQuery(run.query || run.requestedQuery || "Saved workspace run");
    setLastCollectionMode(run.collectionMode || "latest");
    setLastInputMode(run.inputMode || "profile");
    setLastScrapeEngine(run.engine === "companion" ? "companion" : "server");
    setLastDiscoveryStatus(run.discoveryStatus || "ok");
    setLastDiagnostics(run.diagnostics || null);
    setLastWorkflowLabel(run.collectionMode === "engagement" ? "Profile analysis" : run.collectionMode === "range" ? "Saved range" : "Saved workspace run");
    setPage("results");
  };

  const selectCollectionMode = (mode) => {
    if (isPostInput(inputMode) || (["engagement", "compare"].includes(mode) && !isProfileInput(inputMode))) return;
    setCollectionMode(mode);
    setError(null);
    if (mode === "compare" && tourOpen && tourStep === TOUR_STEP.collection) {
      completeUserGuide();
      return;
    }
    moveTourAfterSelection(TOUR_STEP.collection, TOUR_STEP.launch);
  };

  const selectRangeType = (type) => {
    const nextRange = defaultRange(type);
    setRangeType(type);
    setRangeFrom(nextRange.from);
    setRangeTo(nextRange.to);
    setError(null);
  };

  const startScrape = async () => {
    if (!canRunScraper) {
      setError("Your Scraping Viewer role can view results but cannot run a scraper.");
      return;
    }
    if (collectionMode === "compare") return;
    if (tourOpen) completeUserGuide();
    if (!inputMode) {
      setError("Select Profile, Keyword, Profile URL, or Post URL first.");
      return;
    }

    const cleanQuery = composeQuery(inputMode, inputValue);
    if (!cleanQuery) {
      setError(inputMode === "profile_url" || inputMode === "post_url"
        ? `Paste the selected ${platformName} URL type.`
        : "Enter text for the selected input type.");
      return;
    }
    const selectedUrlType = selectedUrlTypeFor(cleanQuery);
    if (inputMode === "profile_url" && selectedUrlType !== "profile") {
      setError(`Enter a ${platformName} profile URL, not a post or reel URL.`);
      return;
    }
    if (inputMode === "post_url" && selectedUrlType !== "post") {
      setError(`Enter a ${platformName} post or reel URL.`);
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
    setLastDiscoveryStatus("ok");
    setLastDiagnostics(null);
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
    setLastScrapeEngine(scrapeEngine);
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
        max_auto_expand_days: 1,
        ...(platformConfig.payload ? platformConfig.payload({ inputMode, cleanQuery, effectiveCollectionMode }) : {})
      };
      const data = await runSelectedInstagramJob(payload, setWorkingStatus);
      setResults(data?.results || []);
      setAnalysis(data?.analysis || data?.run?.analysis || null);
      setLastDiscoveryStatus(data?.discoveryStatus || data?.discovery_status || data?.run?.discoveryStatus || "ok");
      setLastDiagnostics(data?.diagnostics || data?.run?.diagnostics || null);
      setLastQuery(data?.run?.query || cleanQuery);
      setPage("results");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scrape failed";
      setError(platformConfig.errorMessage ? platformConfig.errorMessage(message) : message);
      setPage("start");
    }
  };

  const formatNumber = (value) => {
    if (value === undefined || value === null) return "N/A";
    return Number(value).toLocaleString();
  };

  const formatDate = (value) => {
    if (!value) return missingDateLabel;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : missingDateLabel;
  };

  const relativeDate = (value) => {
    if (!value) return missingDateLabel;
    const postDate = new Date(value);
    if (!Number.isFinite(postDate.getTime())) return missingDateLabel;
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

  const formatViewMetric = (post) => {
    const display = String(post.views_display || "").trim();
    if (post.views === null || post.views === undefined) return display || "N/A";
    const approximate = post.views_exact !== true;
    if (/[KMB]$/i.test(display)) {
      const label = display.toUpperCase().replace(/\s+/g, "");
      return approximate ? `~${label}` : label;
    }
    const value = Number(post.views);
    if (!Number.isFinite(value)) return display || "N/A";
    if (value < 10_000) {
      const label = display || Math.trunc(value).toLocaleString();
      return approximate ? `~${label}` : label;
    }
    const [divisor, suffix] = value >= 1_000_000_000
      ? [1_000_000_000, "B"]
      : value >= 1_000_000
        ? [1_000_000, "M"]
        : [1_000, "K"];
    const amount = value / divisor;
    const label = `${amount.toFixed(amount < 100 ? 1 : 0).replace(/\.0$/, "")}${suffix}`;
    return approximate ? `~${label}` : label;
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
    const data = analysis ? { analysis, results } : results;
    download(JSON.stringify(data, null, 2), `${exportPrefix}-results.json`, "application/json");
  };

  const exportCsv = () => {
    const configuredExportColumns = lastCollectionMode === "engagement" || showViewsInResults ? engagementExportColumns : baseExportColumns;
    const exportColumns = showTopComments
      ? configuredExportColumns
      : configuredExportColumns.filter((column) => column !== "top_comments");
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
    download(rows.join("\n"), `${exportPrefix}-results.csv`, "text/csv");
  };

  const renderRankingTable = (posts, primaryMetric) => {
    const primaryLabels = {
      views: "Views",
      likes: engagementName,
      comments_count: "Comments"
    };
    return posts.length === 0 ? (
      <div className="analysis-empty">
        {primaryMetric === "views"
          ? `${platformName} did not expose current public view counts for this run.`
          : `${platformName} did not expose public ${primaryLabels[primaryMetric].toLowerCase()} for the analyzed posts.`}
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
              {primaryMetric !== "likes" && <th>{engagementName}</th>}
              {primaryMetric !== "comments_count" && <th>Comments</th>}
              {showTopComments && <th>Top comments</th>}
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
                    <ResultThumbnail post={post} />
                    <div>
                      <strong>{/\/reel\//i.test(post.post_url) ? "Reel" : "Post"}</strong>
                      <span>{relativeDate(post.timestamp)}</span>
                    </div>
                  </div>
                </td>
                <td>
                  {post.username ? (
                    <a
                      href={publicPostUrl(post.profile_url || `/${post.username}/`)}
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
                {showTopComments && <td>
                  <div className="comment-list ranking-comments">
                    {(post.top_comments || []).slice(0, 3).map((comment, commentIndex) => (
                      <p key={`${post.post_url}-${comment.username}-${commentIndex}`}>
                        <strong>{comment.username ? `@${comment.username}` : "Comment"}</strong> {comment.text}
                      </p>
                    ))}
                    {(!post.top_comments || post.top_comments.length === 0) && <span>Not publicly available</span>}
                  </div>
                </td>}
                <td>{formatDate(post.timestamp)}</td>
                <td>
                  <a
                    href={publicPostUrl(post.post_url)}
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
          Opening public {platformName} pages, closing popups, and collecting visible data for {lastQuery}.
        </p>
        {lastScrapeEngine === "companion" && cancelActiveScrape && (
          <button type="button" className="cancel-scrape-button" onClick={cancelActiveScrape}>Cancel local scrape</button>
        )}
      </main>
    );
  }

  if (page === "results") {
    const resultNotice = platformConfig.resultNotice?.({
      status: lastDiscoveryStatus,
      diagnostics: lastDiagnostics,
      count: results.length,
      requested: maxResults,
      inputMode: lastInputMode,
      engine: lastScrapeEngine,
    });
    return (
      <main className="instagram-scraper-app results-page">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Dataset ready · {lastScrapeEngine === "companion" ? "Companion" : "Ubuntu Server"}</p>
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
            <button onClick={() => setPage("start")}><Search size={15} />New search</button>
            <button onClick={exportJson} disabled={!results.length && !analysis}><FileJson size={15} />JSON</button>
            <button onClick={exportCsv} disabled={!results.length && !analysis}><FileSpreadsheet size={15} />CSV</button>
          </div>
        </header>

        {resultNotice && <div className="availability-box">{resultNotice}</div>}

        {lastCollectionMode === "engagement" && analysis ? (
          <section className="analysis-dashboard">
            <div className="analysis-overview">
              <div className="profile-identity">
                <span>Profile report</span>
                <h2>{analysis.display_name || analysis.username || `${platformName} profile`}</h2>
                {analysis.username && (
                  <a
                    href={publicPostUrl(analysis.profile_url || `/${analysis.username}/`)}
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
                    ? `${platformName} displays ${analysis.follower_count_display}`
                    : "Current public profile count"}
                </small>
              </article>
              <article className="metric-card">
                <span>Posts analyzed</span>
                <strong>{formatNumber(analysis.analyzed_posts)}</strong>
                <small>Target {formatNumber(analysis.candidate_target || 50)} public posts and reels</small>
              </article>
              <article className="metric-card">
                <span>Average views</span>
                <strong>{formatNumber(analysis.averages?.views)}</strong>
                <small>{viewsMetricNote}</small>
              </article>
              <article className="metric-card">
                <span>Average {engagementNameLower}</span>
                <strong>{formatNumber(analysis.averages?.likes)}</strong>
                <small>{engagementMetricNote}</small>
              </article>
              <article className="metric-card">
                <span>Average comments</span>
                <strong>{formatNumber(analysis.averages?.comments)}</strong>
                <small>{commentsMetricNote}</small>
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
              {analysisTabs.map((tab) => (
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
              <span>{analysis.accuracy?.source || `Public ${platformName} pages`}</span>
              <span>{analysis.accuracy?.followers || `${platformName}'s visible follower value`}</span>
              <span>{analysis.accuracy?.views || "Public Reels grid values"}</span>
              <span>{analysis.accuracy?.missing_metrics || "Missing metrics shown as N/A"}</span>
              <span>Captured {formatDate(analysis.captured_at)}</span>
            </footer>
          </section>
        ) : results.length === 0 ? (
          <div className="empty-panel">
            Public {platformName} did not return usable data for this input. Check that the selected profile, post, or reel is public.
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
                    <th>{engagementName}</th>
                    {showViewsInResults && <th>Views</th>}
                    <th>Followers</th>
                    {showTopComments && <th>Top comments</th>}
                    <th>Posted on</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((post, index) => (
                    <tr key={`${post.post_url}-${index}`}>
                      <td>{index + 1}</td>
                      <td>
                        <div className="post-cell">
                          <ResultThumbnail post={post} />
                          <span>{relativeDate(post.timestamp)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="author-cell">
                          <strong>{post.display_name || post.username || "Unknown"}</strong>
                          {post.username && (
                            <a
                              href={publicPostUrl(post.profile_url || `/${post.username}/`)}
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
                          href={publicPostUrl(post.post_url)}
                          target="_blank"
                          rel="external noopener noreferrer"
                          referrerPolicy="no-referrer"
                        >
                          Open post
                        </a>
                      </td>
                      <td>{formatPostMetric(post, "comments_count")}</td>
                      <td>{formatPostMetric(post, "likes")}</td>
                      {showViewsInResults && <td>{formatViewMetric(post)}</td>}
                      <td>{formatNumber(post.follower_count)}</td>
                      {showTopComments && <td>
                        <div className="comment-list">
                          {(post.top_comments || []).slice(0, 5).map((comment, commentIndex) => (
                            <p key={`${comment.username}-${commentIndex}`}>
                              <strong>{comment.username}</strong> {comment.text}
                            </p>
                          ))}
                          {(!post.top_comments || post.top_comments.length === 0) && <span>N/A</span>}
                        </div>
                      </td>}
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
    <main className={`instagram-scraper-app start-page platform-${platformLower} ${collectionMode === "compare" ? "compare-mode" : ""}`}>
      <section className="intro-panel">
        <div className="scraper-hero-copy">
          <span className="scraper-product-icon"><LayoutDashboard size={22} /></span>
          <p className="eyebrow">{platformName} intelligence</p>
          <h1>Turn public {platformName} activity into useful data.</h1>
          <p>Choose a source, collect the public content you need, and export a clean dataset from one focused workspace.</p>
          <div className="scraper-benefit-list">
            <span><CheckCircle2 size={15} />Public data only</span>
            <span><CheckCircle2 size={15} />No account login required</span>
            <span><Download size={15} />CSV and JSON exports</span>
          </div>
        </div>
        <div className="scraper-hero-visual" aria-label={`${platformName} public intelligence dashboard preview`}>
          <header><span><Globe2 size={16} />Public intelligence</span><em><i />Live workspace</em></header>
          <div className="scraper-visual-profile">
            <span><UserRound size={20} /></span>
            <div><small>Selected source</small><strong>Public profile or topic</strong><p>Ready for collection</p></div>
            <CheckCircle2 size={18} />
          </div>
          <div className="scraper-visual-metrics">
            <article><Activity size={15} /><span><small>Content</small><strong>128</strong></span></article>
            <article><BarChart3 size={15} /><span><small>Signals</small><strong>4.8%</strong></span></article>
            <article><Database size={15} /><span><small>Dataset</small><strong>Ready</strong></span></article>
          </div>
          <div className="scraper-signal-list">
            <span><i style={{ "--signal-width": "86%" }} /><strong>Recent content</strong><small>86%</small></span>
            <span><i style={{ "--signal-width": "68%" }} /><strong>Engagement patterns</strong><small>68%</small></span>
            <span><i style={{ "--signal-width": "92%" }} /><strong>Export readiness</strong><small>92%</small></span>
          </div>
          <footer><span><FileSpreadsheet size={14} />CSV</span><span><FileJson size={14} />JSON</span><b>Collect <ArrowRight size={14} /></b></footer>
        </div>
        <div className="scraper-workflow-preview" aria-label="Scraping workflow">
          <article><span><Search size={17} /></span><div><small>01</small><strong>Choose source</strong><p>Profile, keyword, or URL</p></div></article>
          <i />
          <article><span><BarChart3 size={17} /></span><div><small>02</small><strong>Shape collection</strong><p>Latest, range, or analysis</p></div></article>
          <i />
          <article><span><Download size={17} /></span><div><small>03</small><strong>Use the data</strong><p>Review, JSON, or CSV</p></div></article>
        </div>
      </section>

      <div className="launch-panel-column">
        {workspaceRuns.length > 0 && <section className="workspace-run-history">
          <div><p className="eyebrow">Shared workspace results</p><h2>Recent scraping runs</h2></div>
          <div>{workspaceRuns.slice(0, 8).map((run) => <button type="button" key={run.id} onClick={() => openWorkspaceRun(run)}><strong>{run.requestedQuery || run.query}</strong><span>{new Date(run.createdAt).toLocaleString()} · {Array.isArray(run.results) ? run.results.length : 0} results · {run.engine === "companion" ? "Companion" : "Ubuntu Server"}</span></button>)}</div>
        </section>}
        {userGuideAvailable && (
          <div className="launch-guide-row">
            <button type="button" className="user-guide-button" onClick={openUserGuide}>
              <span aria-hidden="true"><Play size={13} /></span>
              {userGuideLabel}
            </button>
          </div>
        )}

        {canRunScraper ? <section className="launch-panel">
        <fieldset className="engine-picker" data-tour="engine">
          <legend>Choose scraping engine</legend>
          <div className="engine-options">
            {SCRAPE_ENGINES.map(item => (
              <button
                key={item.id}
                type="button"
                className={scrapeEngine === item.id ? "is-selected" : ""}
                onClick={() => selectScrapeEngine(item.id)}
              >
                <i>{item.id === "companion" ? <Laptop size={18} /> : <Cloud size={18} />}</i>
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            ))}
          </div>
          {scrapeEngine === "companion" && (
            <p className={`engine-status ${companionStatus.ready ? "is-ready" : "is-unavailable"}`}>
              {companionStatus.message || "Checking Companion…"}
            </p>
          )}
        </fieldset>

        <div className={`input-builder ${inputMode ? "is-active" : ""} ${collectionMode === "compare" ? "is-compare" : ""}`}>
          <fieldset className="mode-picker" data-tour="input-type">
            <legend>Choose input type</legend>
            <div className="mode-options">
              {availableInputModes.map((item) => (
                (() => {
                  const ModeIcon = INPUT_MODE_ICONS[item.id] || Search;
                  return <button
                  key={item.id}
                  type="button"
                  className={`mode-button ${inputMode === item.id ? "is-selected" : ""}`}
                  onClick={() => selectInputMode(item.id)}
                >
                  <span className="mode-symbol"><ModeIcon size={17} /></span>
                  <span>{item.label}</span>
                </button>;
                })()
              ))}
            </div>
          </fieldset>

          {collectionMode !== "compare" && <div className={`guided-input ${inputMode ? "is-visible" : ""}`} data-tour="query-input">
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
                    onChange={(e) => {
                      window.clearTimeout(tourTypingTimer.current);
                      window.clearInterval(tourTypingTimer.current);
                      tourTypingTimer.current = null;
                      setInputValue(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") startScrape();
                    }}
                    autoFocus
                  />
                </div>
              </>
            )}
          </div>}
        </div>

        {!isPostInput(inputMode) && (
          <fieldset className="workflow-picker" data-tour="collection">
            <legend>Choose collection</legend>
            <div className="workflow-options">
              {COLLECTION_MODES
                .filter((item) => !["engagement", "compare"].includes(item.id) || isProfileInput(inputMode))
                .map((item) => (
                  (() => {
                    const CollectionIcon = COLLECTION_MODE_ICONS[item.id] || Sparkles;
                    return <button
                    key={item.id}
                    type="button"
                    className={collectionMode === item.id ? "is-selected" : ""}
                    onClick={() => selectCollectionMode(item.id)}
                  ><CollectionIcon size={15} />{item.label}</button>;
                  })()
                ))}
            </div>
          </fieldset>
        )}

        {collectionMode === "compare" && isProfileInput(inputMode) && (
          <ProfileComparisonWorkspace
            seedProfile={inputValue}
            runJob={runSelectedInstagramJob}
            platformName={platformName}
            normalizeInput={platformConfig.normalizeComparisonInput}
            comparisonTarget={platformConfig.comparisonTarget}
            engagementName={engagementName}
            comparisonInputHint={platformConfig.comparisonInputHint}
            profileNotFoundMessage={platformConfig.profileNotFoundMessage}
            serviceToken={publishingIdentityToken}
          />
        )}

        {!isPostInput(inputMode) && collectionMode === "range" && (
          <div className="range-builder" data-tour="range">
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

        {collectionMode !== "compare" && <div className={`launch-row ${isPostInput(inputMode) ? "is-single-post" : ""}`} data-tour="launch">
          {!isPostInput(inputMode) && (
            <div className="count-field">
              <label htmlFor="count">Results per ranking</label>
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
          <button className="primary-button" onClick={() => startScrape()}><Play size={16} />
            {isPostInput(inputMode) ? "Scrape Post" : "Start Scraping"}
          </button>
        </div>}

        {collectionMode !== "compare" && keywords.length > 0 && (
          <div className="quick-row">
            {keywords.slice(0, 7).map((item) => (
              <button key={item} onClick={() => selectSavedQuery(item)}>{item}</button>
            ))}
          </div>
        )}

        {collectionMode !== "compare" && error && <div className="error-box">{error}</div>}
        </section> : <section className="launch-panel viewer-only-panel"><p className="eyebrow">Scraping Viewer</p><h2>Workspace results are read-only</h2><p>Select a recent run above to inspect or export it. An Operator or Manager can start new scraping jobs.</p></section>}
      </div>

      {userGuideAvailable && tourOpen && (
        CustomUserGuide ? (
          <CustomUserGuide open={tourOpen} onClose={completeUserGuide} />
        ) : (
          <InstagramScraperTour
            open={tourOpen}
            stepIndex={tourStep}
            steps={userGuideSteps}
            onBack={rewindUserGuide}
            onClose={completeUserGuide}
            onNext={advanceUserGuide}
          />
        )
      )}
    </main>
  );
}

export default InstagramScraperConsole;
