const api = window.publishingCompanion;
const byId = id => document.getElementById(id);
const views = {
  activity: { panel: byId("activity-panel"), title: "Login and publishing activity", eyebrow: "VISIBLE AUTOMATION" },
  settings: { panel: byId("settings-panel"), title: "Companion settings", eyebrow: "LOCAL DESKTOP SERVICE" },
};

let activeView = "activity";
let currentStatus = null;
let currentWorkspace = { sessions: [] };
let logEntries = [];
let layoutFrame = null;
let liveLayoutMode = "focus";
let focusedSessionId = null;

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
  detail.textContent = `${session.purpose === "login" ? "Login" : "Publishing"} · ${stateLabel(session)}`;
  identity.append(name, detail);

  const state = document.createElement("i");
  state.className = session.activity?.state || "opening";
  button.append(platformMark(session), identity, state);
  button.addEventListener("click", () => {
    focusedSessionId = session.id;
    liveLayoutMode = "focus";
    renderWorkspace();
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
  purpose.textContent = session.purpose === "login" ? "Interactive login" : "Publishing";
  const name = document.createElement("strong");
  name.textContent = session.displayName || session.handle || platformLabel(session.platform);
  const detail = document.createElement("small");
  detail.textContent = session.activity?.detail
    || (session.purpose === "login" ? "Complete login in this pane." : "Preparing the publishing page.");
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
  slot.dataset.browserSession = session.id;
  card.append(header, progress, slot);
  return card;
}

function createTimelineItem(session) {
  const item = document.createElement("div");
  item.className = "timeline-item";

  const dot = document.createElement("i");
  dot.className = session.activity?.state || "opening";

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
  liveLayoutMode = canSplit ? "split" : "focus";

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
    ? "Every simultaneous account stays visible in the live grid. Different accounts publish together; each account still runs only one job at a time."
    : "Account sign-in and publishing open inside Companion. A Chrome or Edge fallback remains available for providers that block embedded sign-in.";
  const singleSession = active.length === 1 ? active[0] : null;
  byId("live-run-title").textContent = singleSession
    ? `${platformLabel(singleSession.platform)} · ${stateLabel(singleSession)}`
    : `${active.length} live accounts`;
  byId("live-run-detail").textContent = singleSession
    ? singleSession.activity?.detail || (singleSession.purpose === "login" ? "Complete login in the browser above." : "Visible publishing is active.")
    : liveLayoutMode === "focus"
      ? "Full-size browser selected. Choose another account tab to switch."
      : "Publishing all scheduled accounts together in the visible grid.";
  byId("live-stop").textContent = singleSession?.purpose === "login" ? "Close login" : "Stop publishing";

  const focusButton = byId("layout-focus");
  const splitButton = byId("layout-split");
  focusButton.classList.toggle("active", liveLayoutMode === "focus");
  splitButton.classList.toggle("active", liveLayoutMode === "split");
  focusButton.disabled = canSplit;
  splitButton.disabled = !canSplit;

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
  byId("global-stop").disabled = active.length === 0;
  byId("live-stop").disabled = active.length === 0;
  scheduleLayout();
}

function renderStatus(status) {
  currentStatus = status;
  byId("version").textContent = status.version;
  byId("auto-start").checked = status.autoStart;
  byId("service-check").textContent = status.connected ? "Connected" : "Offline";
  byId("browser-check").textContent = status.embeddedBrowser
    ? status.chromeInstalled ? "Companion + Chrome fallback" : "Companion browser"
    : status.chromeInstalled ? "Chrome or Edge" : "Install Chrome/Edge";
  byId("scheduler-check").textContent = status.connected ? "Running" : "Stopped";
  const consentGranted = status.publishingInteractionConsent === true;
  byId("permission-state").textContent = consentGranted ? "Unattended publishing allowed" : "Permission not granted";
  byId("permission-detail").textContent = consentGranted
    ? "Scheduled posts can publish without asking again at their scheduled time."
    : "Scheduling will show an Allow/Deny popup before the post is saved.";
  byId("revoke-consent").hidden = !consentGranted;

  const ready = Boolean(status.automationReady);
  byId("status-dot").className = ready ? "ready" : "error";
  byId("sidebar-status-dot").className = ready ? "ready" : "error";
  byId("status-title").textContent = ready ? "Ready for visible publishing" : "Companion needs attention";
  byId("status-detail").textContent = ready
    ? "Account login and publishing run visibly inside Companion; Chrome or Edge is available only as a sign-in fallback."
    : status.error || "The local publishing service could not start.";
  byId("sidebar-status-title").textContent = ready ? "Ready" : "Needs attention";
  byId("sidebar-status-detail").textContent = ready ? "Local publishing online" : "Open Companion settings";
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
  await Promise.all([refreshStatus(), refreshWorkspace()]);
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
async function stopPublishing(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Stopping…";
  await api.emergencyStop();
  button.textContent = button.id === "live-stop" ? "Stop publishing" : "Emergency stop";
  await refreshWorkspace();
}

byId("global-stop").addEventListener("click", stopPublishing);
byId("live-stop").addEventListener("click", stopPublishing);
byId("empty-open-dashboard").addEventListener("click", () => api.openDashboard());
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

void Promise.all([refreshStatus(), refreshWorkspace()]).then(() => {
  renderLogs();
  scheduleLayout();
});
setInterval(refreshStatus, 5000);
