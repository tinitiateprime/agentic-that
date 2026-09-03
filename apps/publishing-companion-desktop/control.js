const api = window.publishingCompanion;
const byId = id => document.getElementById(id);
const views = {
  activity: { panel: byId("activity-panel"), title: "Login and publishing activity", eyebrow: "VISIBLE AUTOMATION" },
  scraping: { panel: byId("scraping-panel"), title: "Social scraping activity", eyebrow: "PRIVATE LOCAL ENGINE" },
  settings: { panel: byId("settings-panel"), title: "Companion settings", eyebrow: "LOCAL DESKTOP SERVICE" },
};

function createIcon(name, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function setButtonLabel(buttonOrId, label) {
  const button = typeof buttonOrId === "string" ? byId(buttonOrId) : buttonOrId;
  if (!button) return;
  const labelElement = button.querySelector(".button-label");
  if (labelElement) labelElement.textContent = label;
  else button.textContent = label;
}

let activeView = "activity";
let currentStatus = null;
let currentWorkspace = { sessions: [] };
let currentScraping = { activeJob: null, queuedJobs: [], recentJobs: [], concurrency: 1 };
let logEntries = [];
let layoutFrame = null;
let liveLayoutMode = "focus";
let focusedSessionId = null;
let previousActiveCount = 0;

function platformLabel(value) {
  const labels = {
    instagram: "Instagram",
    x: "X",
    linkedin: "LinkedIn",
    facebook: "Facebook",
    youtube: "YouTube",
  };
  return labels[value] || value || "Platform";
}

function stateLabel(session) {
  const value = session.activity?.state || "opening";
  if (session.purpose === "login" && value === "waiting") return "Login needed";
  if (value === "posted" && session.purpose === "login") return "Login saved";
  const labels = {
    opening: "Opening",
    waiting: "Waiting",
    publishing: "Publishing",
    posted: "Posted",
    failed: "Needs review",
    stopped: "Stopped",
  };
  return labels[value] || value;
}

function setView(view) {
  if (!views[view]) return;
  activeView = view;
  for (const [name, config] of Object.entries(views)) {
    config.panel.classList.toggle("active", name === view);
  }
  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  byId("view-title").textContent = views[view].title;
  byId("view-eyebrow").textContent = views[view].eyebrow;
  const liveCount = activeSessions().length;
  document.body.classList.toggle("immersive-live", view === "activity" && liveCount === 1);
  document.body.classList.toggle("immersive-grid", view === "activity" && liveCount > 1);
  scheduleLayout();
}

function elementBounds(element) {
  if (!element || element.offsetParent === null) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function scheduleLayout() {
  if (layoutFrame) cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    const browserElements = [...document.querySelectorAll("[data-browser-session]")];
    const browsers = browserElements
      .map(element => {
        const bounds = elementBounds(element);
        if (!bounds) return null;
        // Keep a consistent desktop-sized page inside every tile. Electron's
        // zoom expands the page's CSS viewport as it decreases, so fitting both
        // dimensions prevents responsive platform UIs from being cropped.
        const fitWidth = bounds.width / 1_100;
        const fitHeight = bounds.height / 700;
        const zoomFactor = browserElements.length <= 1
          ? 1
          : Math.max(0.4, Math.min(0.9, fitWidth, fitHeight));
        return { id: element.dataset.browserSession, bounds, zoomFactor };
      })
      .filter(Boolean)
      .filter(entry => entry.id && entry.bounds);
    void api.setLayout({
      dashboard: null,
      browsers: activeView === "activity" ? browsers : [],
    });
  });
}

function activeSessions() {
  return currentWorkspace.sessions.filter(session => session.active);
}

function scrapingWorkCount() {
  const active = currentScraping.activeJob && ["queued", "running"].includes(currentScraping.activeJob.status) ? 1 : 0;
  return active + (currentScraping.queuedJobs?.length || 0);
}

function updateGlobalStop() {
  byId("global-stop").disabled = activeSessions().length === 0 && scrapingWorkCount() === 0;
}

function platformMark(session) {
  const mark = document.createElement("span");
  mark.className = `platform-mark platform-${session.platform}`;
  mark.textContent = session.platform === "x" ? "X" : platformLabel(session.platform).slice(0, 2);
  return mark;
}

function createSessionTab(session) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `session-tab ${session.id === focusedSessionId && liveLayoutMode === "focus" ? "active" : ""}`;
  button.dataset.sessionId = session.id;

  const identity = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = session.displayName || session.handle || platformLabel(session.platform);
  const detail = document.createElement("small");
  detail.textContent = `${session.purpose === "login" ? "Login" : "Publishing"} - ${session.engine === "external_browser" ? (session.purpose === "login" ? "Chrome fallback" : "Companion-managed Chrome") : "Companion"} - ${stateLabel(session)}`;
  identity.append(name, detail);

  const state = document.createElement("i");
  state.className = session.activity?.state || "opening";
  button.append(platformMark(session), identity, state);
  button.addEventListener("click", () => {
    focusedSessionId = session.id;
    liveLayoutMode = "focus";
    renderWorkspace();
    if (session.engine === "external_browser" && session.purpose === "login") void api.focusExternalWindow(session.id);
  });
  return button;
}

function createLiveCard(session) {
  const card = document.createElement("article");
  card.className = "live-card";

  const header = document.createElement("div");
  header.className = "live-card-header";

  const identity = document.createElement("div");
  identity.className = "live-card-identity";
  const purpose = document.createElement("span");
  purpose.className = "live-purpose";
  purpose.textContent = session.engine === "external_browser"
    ? session.purpose === "login" ? "External browser login" : "Companion-managed Chrome publishing"
    : session.purpose === "login" ? "Companion login" : "Companion publishing";
  const name = document.createElement("strong");
  name.textContent = session.displayName || session.handle || platformLabel(session.platform);
  const detail = document.createElement("small");
  detail.textContent = session.activity?.detail
    || (session.engine === "external_browser"
      ? session.purpose === "login" ? "The dedicated Chrome, Edge, or Chromium login window is active." : "Companion is publishing through the provider-bound protected browser profile."
      : session.purpose === "login" ? "Complete login in this pane." : "Preparing the publishing page.");
  identity.append(purpose, name, detail);

  const state = document.createElement("span");
  state.className = `state-pill ${session.activity?.state || "opening"}`;
  state.textContent = stateLabel(session);
  const stateGroup = document.createElement("div");
  stateGroup.className = "live-card-state";
  const index = Number(session.activity?.currentIndex || 0);
  const total = Number(session.activity?.totalItems || 0);
  if (total > 0) {
    const position = document.createElement("small");
    position.textContent = `${Math.min(index, total)} of ${total}`;
    stateGroup.append(position);
  }
  stateGroup.prepend(state);
  header.append(platformMark(session), identity, stateGroup);

  const progress = document.createElement("div");
  progress.className = "live-progress";
  const progressFill = document.createElement("i");
  progressFill.style.width = total > 0 ? `${Math.min(100, Math.round(index / total * 100))}%` : "8%";
  progress.append(progressFill);

  const slot = document.createElement("div");
  slot.className = "live-browser-slot";
  if (session.engine === "external_browser") {
    slot.classList.add("external-browser-slot");
    if (session.purpose === "publish" && session.activity?.previewFrame) {
      const preview = document.createElement("img");
      preview.className = "managed-chrome-preview";
      preview.alt = `Live ${platformLabel(session.platform)} publishing preview`;
      preview.src = session.activity.previewFrame;
      slot.append(preview);
      card.append(header, progress, slot);
      return card;
    }
    const externalStatus = document.createElement("div");
    externalStatus.className = "external-browser-status";
    const layout = session.activity?.externalLayout;
    const tileMap = document.createElement("div");
    tileMap.className = "external-tile-map";
    tileMap.setAttribute("aria-hidden", "true");
    tileMap.style.setProperty("--external-tile-columns", String(layout?.columns || 1));
    const tileCount = Math.max(1, Number(layout?.total || 1));
    for (let tileIndex = 1; tileIndex <= tileCount; tileIndex += 1) {
      const tile = document.createElement("i");
      tile.classList.toggle("current", tileIndex === Number(layout?.index || 1));
      tile.classList.toggle("centered", Boolean(layout?.columns === 2 && tileCount % 2 === 1 && tileIndex === tileCount));
      tileMap.append(tile);
    }
    const externalLabel = document.createElement("strong");
    externalLabel.textContent = session.purpose === "publish"
      ? "Starting secure live preview"
      : layout ? `Window ${layout.index} of ${layout.total}` : "Arranging browser window";
    const externalDetail = document.createElement("small");
    externalDetail.textContent = layout
      ? `Row ${layout.row}, ${layout.centered ? "centered" : `column ${layout.column}`} - dedicated browser profile`
      : session.purpose === "login" ? "Preparing a dedicated Chrome, Edge, or Chromium profile." : "Preparing the protected Companion-managed browser profile.";
    const focusWindow = document.createElement("button");
    focusWindow.type = "button";
    focusWindow.className = "external-focus-window";
    focusWindow.append(createIcon("focus"), document.createTextNode("Bring to front"));
    focusWindow.addEventListener("click", () => void api.focusExternalWindow(session.id));
    externalStatus.append(tileMap, externalLabel, externalDetail);
    if (session.purpose === "login") externalStatus.append(focusWindow);
    slot.append(externalStatus);
  } else {
    slot.dataset.browserSession = session.id;
  }
  card.append(header, progress, slot);
  return card;
}

function createTimelineItem(session) {
  const item = document.createElement("div");
  item.className = "timeline-item";

  const dot = document.createElement("i");
  const timelineState = session.activity?.state || "opening";
  const timelineIcons = {
    opening: "monitor",
    waiting: "history",
    publishing: "send",
    posted: "check",
    failed: "alert",
    stopped: "x",
  };
  dot.className = `timeline-mark ${timelineState}`;
  dot.append(createIcon(timelineIcons[timelineState] || "activity"));

  const content = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = `${platformLabel(session.platform)} · ${session.displayName || session.handle || "Account"}`;
  const detail = document.createElement("small");
  detail.textContent = session.activity?.detail
    || (session.purpose === "login" ? "Account login opened." : "Publishing action opened.");
  content.append(name, detail);

  const time = document.createElement("time");
  const date = new Date(session.activity?.updatedAt || session.closedAt || session.openedAt);
  time.textContent = Number.isNaN(date.getTime())
    ? stateLabel(session)
    : `${stateLabel(session)} · ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  item.append(dot, content, time);
  return item;
}

function renderWorkspace() {
  const active = activeSessions();
  if (!active.some(session => session.id === focusedSessionId)) focusedSessionId = active[0]?.id ?? null;
  const canSplit = active.length > 1;
  if (!canSplit) liveLayoutMode = "focus";
  else if (previousActiveCount <= 1) liveLayoutMode = "split";
  previousActiveCount = active.length;
  const externalSessions = active.filter(session => session.engine === "external_browser");
  const externalLoginSessions = externalSessions.filter(session => session.purpose === "login");

  const activityPanel = byId("activity-panel");
  activityPanel.classList.toggle("has-live", active.length > 0);
  activityPanel.classList.toggle("single-live", active.length === 1);
  document.body.classList.toggle("immersive-live", activeView === "activity" && active.length === 1);
  document.body.classList.toggle("immersive-grid", activeView === "activity" && active.length > 1);
  byId("live-command-bar").hidden = active.length === 0;
  byId("session-switcher").hidden = active.length <= 1;
  byId("live-heading").textContent = active.length
    ? `${active.length} live ${active.length === 1 ? "browser" : "browsers"}`
    : "Login and publishing activity";
  byId("live-description").textContent = active.length
    ? externalLoginSessions.length
      ? "External Chrome, Edge, or Chromium windows are fitted into a two-column workspace while Companion keeps every account and status together."
      : externalSessions.length
        ? "Provider-bound publishing stays controlled by Companion and appears here as a secure local live preview."
      : "Every active Companion browser remains visible in the live workspace."
    : "Each account uses its selected Companion or External browser engine for login and publishing.";
  const singleSession = active.length === 1 ? active[0] : null;
  byId("live-run-title").textContent = singleSession
    ? `${platformLabel(singleSession.platform)} · ${stateLabel(singleSession)}`
    : `${active.length} live accounts`;
  byId("live-run-detail").textContent = singleSession
    ? singleSession.activity?.detail || (singleSession.engine === "external_browser"
      ? "The dedicated external browser window is active."
      : singleSession.purpose === "login" ? "Complete login in the browser above." : "Visible publishing is active.")
    : externalSessions.length === active.length
      ? externalLoginSessions.length === externalSessions.length
        ? `${externalSessions.length} external login windows arranged two per row.`
        : `${externalSessions.length} protected provider-bound publishing sessions shown inside Companion.`
      : liveLayoutMode === "focus"
      ? "Full-size browser selected. Choose another account tab to switch."
      : "Publishing all active accounts together in the visible grid.";
  setButtonLabel("live-stop", singleSession?.purpose === "login" ? "Close login" : "Stop publishing");

  const focusButton = byId("layout-focus");
  const splitButton = byId("layout-split");
  focusButton.classList.toggle("active", liveLayoutMode === "focus");
  splitButton.classList.toggle("active", liveLayoutMode === "split");
  focusButton.disabled = canSplit;
  splitButton.disabled = !canSplit;
  byId("arrange-external").hidden = externalLoginSessions.length === 0;

  const switcher = byId("session-switcher");
  switcher.replaceChildren(...active.map(createSessionTab));
  const liveGrid = byId("live-grid");
  liveGrid.dataset.layout = liveLayoutMode;
  const visibleSessions = liveLayoutMode === "split"
    ? active
    : active.filter(session => session.id === focusedSessionId);
  liveGrid.dataset.count = String(visibleSessions.length);
  liveGrid.replaceChildren(...visibleSessions.map(createLiveCard));
  byId("activity-empty").hidden = active.length > 0;

  const timeline = byId("activity-timeline");
  if (currentWorkspace.sessions.length === 0) {
    const empty = document.createElement("span");
    empty.className = "timeline-empty";
    empty.textContent = "Publishing and login actions will be listed here.";
    timeline.replaceChildren(empty);
    byId("activity-summary").textContent = "Waiting for activity";
  } else {
    timeline.replaceChildren(...currentWorkspace.sessions.slice(0, 12).map(createTimelineItem));
    const completed = currentWorkspace.sessions.filter(session => !session.active).length;
    byId("activity-summary").textContent = `${active.length} active · ${completed} recent`;
  }

  const badge = byId("activity-badge");
  badge.hidden = active.length === 0;
  badge.textContent = String(active.length);
  updateGlobalStop();
  byId("live-stop").disabled = active.length === 0;
  scheduleLayout();
}

const scrapingStageOrder = ["queued", "opening_browser", "scraping", "preparing_results"];

function scrapingModeLabel(value) {
  const labels = { latest: "Latest posts", range: "Date range", engagement: "Profile analysis" };
  return labels[value] || "Social scrape";
}

function durationLabel(startValue, endValue = Date.now()) {
  const start = new Date(startValue || "").getTime();
  const end = typeof endValue === "number" ? endValue : new Date(endValue || "").getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Just now";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s elapsed`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s elapsed`;
}

function scrapeJobStateLabel(job) {
  if (job.status === "complete") return `${job.resultCount ?? 0} results`;
  if (job.status === "failed") return "Needs attention";
  if (job.status === "cancelled") return "Stopped";
  if (job.status === "queued") return job.queuePosition ? `Queue ${job.queuePosition}` : "Queued";
  return job.progress?.message || "Working";
}

function createScrapeJobItem(job) {
  const item = document.createElement("article");
  item.className = `scrape-job-item ${job.status || "queued"}`;

  const mark = document.createElement("span");
  mark.className = "scrape-job-mark";
  const scrapeIcons = { complete: "check", failed: "alert", cancelled: "x", queued: "list", running: "scan" };
  mark.append(createIcon(scrapeIcons[job.status] || "scan-search"));

  const content = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${job.platform || "Social"}: ${job.query || "request"}`;
  const detail = document.createElement("small");
  detail.textContent = job.error?.message || `${scrapingModeLabel(job.collectionMode)} - ${scrapeJobStateLabel(job)}`;
  content.append(title, detail);

  const time = document.createElement("time");
  const value = new Date(job.completedAt || job.updatedAt || job.createdAt || "");
  time.textContent = Number.isNaN(value.getTime())
    ? scrapeJobStateLabel(job)
    : value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  item.append(mark, content, time);
  return item;
}

function renderScraping() {
  const active = currentScraping.activeJob && ["queued", "running"].includes(currentScraping.activeJob.status)
    ? currentScraping.activeJob
    : null;
  const stageCard = byId("scrape-stage-card");
  const stage = active?.progress?.stage || "idle";
  const activePlatform = active?.platform || "Instagram and Facebook";
  stageCard.dataset.status = active ? "working" : "idle";
  stageCard.dataset.stage = stage;

  byId("scrape-live-label").textContent = active ? "LIVE ON THIS COMPUTER" : "LOCAL ENGINE READY";
  byId("scrape-title").textContent = active
    ? `${activePlatform} scraping: ${active.query || "public target"}`
    : "Ready for private Instagram and Facebook scraping";
  byId("scrape-detail").textContent = active
    ? active.progress?.message || `Collecting current public ${activePlatform} data.`
    : "Start a Local Companion scrape from AgenticThat. The hidden browser runs separately from publishing and its progress will appear here.";
  byId("scrape-platform-mark").textContent = active ? (activePlatform === "Facebook" ? "FB" : "IG") : "IG+FB";
  byId("scrape-elapsed").textContent = active
    ? durationLabel(active.startedAt || active.createdAt)
    : currentScraping.recentJobs?.[0]
      ? `Last activity ${new Date(currentScraping.recentJobs[0].updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Waiting for a request";

  byId("scrape-meta").hidden = !active;
  if (active) {
    byId("scrape-mode").textContent = scrapingModeLabel(active.collectionMode);
    byId("scrape-target").textContent = `${active.maxResults} requested`;
    const queued = currentScraping.queuedJobs?.length || 0;
    byId("scrape-queue-position").textContent = queued ? `${queued} waiting next` : "No queue";
  }

  const stageIndex = scrapingStageOrder.indexOf(stage);
  const progressByStage = { queued: 8, opening_browser: 28, scraping: 68, preparing_results: 92 };
  byId("scrape-progress-fill").style.width = active ? `${progressByStage[stage] || 8}%` : "0%";
  byId("scrape-progress-track").classList.toggle("working", Boolean(active));
  document.querySelectorAll("#scrape-steps [data-stage]").forEach((element, index) => {
    element.classList.toggle("active", Boolean(active) && index === stageIndex);
    element.classList.toggle("complete", Boolean(active) && index < stageIndex);
  });

  byId("stop-scraping").hidden = !active && (currentScraping.queuedJobs?.length || 0) === 0;
  byId("stop-scraping").disabled = !active && (currentScraping.queuedJobs?.length || 0) === 0;

  const queuedJobs = currentScraping.queuedJobs || [];
  byId("scrape-queue-summary").textContent = queuedJobs.length
    ? `${queuedJobs.length} ${queuedJobs.length === 1 ? "request" : "requests"} waiting`
    : "No requests waiting";
  const queueList = byId("scrape-queue-list");
  if (queuedJobs.length) queueList.replaceChildren(...queuedJobs.map(createScrapeJobItem));
  else {
    const empty = document.createElement("span");
    empty.className = "timeline-empty";
    empty.textContent = active ? "The active request has the private browser." : "New requests will appear here.";
    queueList.replaceChildren(empty);
  }

  const recentJobs = currentScraping.recentJobs || [];
  byId("scrape-history-summary").textContent = recentJobs.length
    ? `${recentJobs.length} recent`
    : "No recent jobs";
  const historyList = byId("scrape-history-list");
  if (recentJobs.length) historyList.replaceChildren(...recentJobs.slice(0, 8).map(createScrapeJobItem));
  else {
    const empty = document.createElement("span");
    empty.className = "timeline-empty";
    empty.textContent = "Completed and failed requests will appear here.";
    historyList.replaceChildren(empty);
  }

  const badge = byId("scraping-badge");
  const workCount = scrapingWorkCount();
  badge.hidden = workCount === 0;
  badge.textContent = String(workCount);
  updateGlobalStop();
}

function renderStatus(status) {
  currentStatus = status;
  byId("version").textContent = status.version;
  byId("auto-start").checked = status.autoStart;
  byId("auto-start-label").textContent = status.autoStartLabel || "Start automatically when I log in";
  byId("service-check").textContent = status.connected ? "Connected" : "Offline";
  byId("browser-check").textContent = status.embeddedBrowser
    ? status.chromeInstalled ? "Companion + Chrome fallback" : "Companion browser"
    : status.chromeInstalled ? "Chrome, Edge, or Chromium" : "Install Chrome/Edge/Chromium";
  byId("scheduler-check").textContent = status.connected ? "Ready" : "Stopped";
  const controlPlane = status.controlPlane || {};
  byId("heartbeat-check").textContent = !status.paired
    ? "Not paired"
    : controlPlane.status === "online" ? "Online"
      : controlPlane.status === "updating" ? "Updating"
        : controlPlane.status === "outdated" ? "Update required"
          : controlPlane.status === "connecting" ? "Connecting"
            : controlPlane.status === "error" ? "Error"
              : "Offline — retrying";
  byId("secure-storage-check").textContent = status.paired
    ? status.securePairingStorage ? "Encrypted" : "Unavailable"
    : status.secureLocalStorage ? "OS encrypted" : "Unavailable";
  const updateLabels = {
    unsupported: "Installer required",
    idle: "Up to date",
    checking: "Checking",
    downloading: "Downloading",
    downloaded: "Restart to apply",
    applying: "Applying",
    error: "Check failed",
  };
  byId("update-check").textContent = updateLabels[status.updateStatus] || "Checking";
  const consentGranted = status.publishingInteractionConsent === true;
  byId("permission-state").textContent = consentGranted ? "Workspace publishing allowed" : "Permission not granted";
  byId("permission-detail").textContent = consentGranted
    ? "This paired Companion can accept approved publish-now jobs."
    : "Publishing will ask before the first approved workspace job.";
  byId("revoke-consent").hidden = !consentGranted;

  const ready = Boolean(status.automationReady) && status.runtimeState !== "error";
  const needsLogin = Number(status.accountHealth?.loginRequired || 0) > 0;
  const outdated = controlPlane.status === "outdated";
  const updating = ["checking", "downloading", "downloaded", "applying"].includes(status.updateStatus);
  const healthy = ready && !outdated;
  byId("status-dot").className = healthy ? "ready" : "error";
  byId("sidebar-status-dot").className = healthy ? "ready" : "error";
  byId("status-title").textContent = !ready ? "Companion needs attention"
    : outdated ? "Update Companion to continue"
      : updating ? "Companion update in progress"
        : needsLogin ? "Login required for an account"
          : "Ready for visible publishing";
  byId("status-detail").textContent = !ready
    ? status.runtimeError || status.error || "The local publishing service could not start."
    : outdated ? controlPlane.lastError || "Install the latest Companion before publishing more jobs."
      : needsLogin ? `${status.accountHealth.loginRequired} connected account${status.accountHealth.loginRequired === 1 ? " needs" : "s need"} login again.`
        : controlPlane.status === "offline" && status.paired
          ? "Local work is safe. Companion is retrying the workspace connection automatically."
          : "Account login and publishing use isolated local browser profiles.";
  byId("sidebar-status-title").textContent = !ready ? "Error" : outdated ? "Update required" : updating ? "Updating" : needsLogin ? "Login required" : "Ready";
  byId("sidebar-status-detail").textContent = !ready ? "Open Companion settings" : status.paired ? "Workspace worker online" : "Pair this computer";
  byId("companion-open-step").classList.toggle("complete", ready);
  byId("companion-open-step").classList.toggle("active", !ready);
  byId("companion-open-copy").textContent = ready
    ? "The publishing service is running."
    : "Keep Companion open while the publishing service starts.";
  const paired = Boolean(status.paired);
  byId("companion-pairing-step").classList.toggle("complete", paired);
  byId("companion-pairing-step").classList.toggle("active", ready && !paired);
  byId("companion-publishing-step").classList.toggle("active", paired);
  byId("companion-pairing-copy").textContent = paired
    ? "This computer is connected to your workspace."
    : "Open Publishing Connections and select Pair this device.";
  setButtonLabel("empty-open-connections", paired ? "Manage publishing accounts" : "Open Publishing Connections");
  byId("install-chrome").hidden = Boolean(status.chromeInstalled);
}

async function refreshStatus() {
  try {
    renderStatus(await api.status());
  } catch (error) {
    renderStatus({
      version: currentStatus?.version || "—",
      connected: false,
      automationReady: false,
      embeddedBrowser: true,
      autoStart: currentStatus?.autoStart ?? true,
      error: error instanceof Error ? error.message : "Companion status is unavailable.",
    });
  }
}

async function refreshWorkspace() {
  currentWorkspace = await api.workspaceState();
  renderWorkspace();
}

async function refreshScraping() {
  currentScraping = await api.scrapingState();
  renderScraping();
}

function renderLogs() {
  const container = byId("log-list");
  if (logEntries.length === 0) {
    const empty = document.createElement("span");
    empty.textContent = "Companion messages will appear here.";
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...logEntries.map(entry => {
    const line = document.createElement("div");
    line.className = `log-entry ${entry.level || ""}`;
    const date = new Date(entry.createdAt);
    const time = Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString();
    line.textContent = `${time} ${String(entry.level || "log").toUpperCase()} ${entry.message}`;
    return line;
  }));
  container.scrollTop = container.scrollHeight;
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

byId("refresh-current").addEventListener("click", async () => {
  const button = byId("refresh-current");
  button.disabled = true;
  button.classList.add("is-loading");
  try {
    await Promise.all([refreshStatus(), refreshWorkspace(), refreshScraping()]);
  } finally {
    button.classList.remove("is-loading");
    button.disabled = false;
  }
});
byId("layout-focus").addEventListener("click", () => {
  liveLayoutMode = "focus";
  renderWorkspace();
});
byId("layout-split").addEventListener("click", () => {
  if (activeSessions().length < 2) return;
  liveLayoutMode = "split";
  renderWorkspace();
});
byId("arrange-external").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setButtonLabel(button, "Arranging...");
  await api.arrangeExternalWindows();
  setButtonLabel(button, "Arrange windows");
  button.disabled = false;
});
async function stopPublishing(event) {
  const button = event.currentTarget;
  button.disabled = true;
  setButtonLabel(button, "Stopping…");
  await api.emergencyStop();
  setButtonLabel(button, button.id === "live-stop" ? "Stop publishing" : "Emergency stop");
  await refreshWorkspace();
}

byId("global-stop").addEventListener("click", stopPublishing);
byId("live-stop").addEventListener("click", stopPublishing);
byId("stop-scraping").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setButtonLabel(button, "Stopping...");
  await api.stopScraping();
  setButtonLabel(button, "Stop scraping");
  await refreshScraping();
});
byId("empty-open-dashboard").addEventListener("click", () => api.openDashboard());
byId("empty-open-connections").addEventListener("click", () => api.openConnections());
byId("open-data").addEventListener("click", () => api.openData());
byId("open-logs").addEventListener("click", () => api.openLogs());
byId("install-chrome").addEventListener("click", () => api.installChrome());
byId("auto-start").addEventListener("change", event => api.setAutoStart(event.currentTarget.checked));
byId("revoke-consent").addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  await api.revokePublishingConsent();
  await refreshStatus();
  event.currentTarget.disabled = false;
});
byId("clear-log").addEventListener("click", () => {
  logEntries = [];
  renderLogs();
});

api.onStatusChanged(refreshStatus);
api.onWorkspaceState(state => {
  currentWorkspace = state;
  renderWorkspace();
});
api.onScrapingState(state => {
  currentScraping = state;
  renderScraping();
});
api.onNavigate(section => setView(views[section] ? section : "activity"));
api.onLog(entry => {
  logEntries = [...logEntries.slice(-79), entry];
  renderLogs();
});

new ResizeObserver(scheduleLayout).observe(document.body);
window.addEventListener("resize", () => {
  scheduleLayout();
});
document.addEventListener("visibilitychange", scheduleLayout);

void Promise.all([refreshStatus(), refreshWorkspace(), refreshScraping()]).then(() => {
  renderLogs();
  scheduleLayout();
});
setInterval(refreshStatus, 5000);
setInterval(() => {
  if (scrapingWorkCount() > 0) renderScraping();
}, 1000);
