const api = window.publishingCompanion;
const byId = id => document.getElementById(id);
const views = {
  dashboard: { panel: byId("dashboard-panel"), title: "Publishing dashboard", eyebrow: "PUBLISHING WORKSPACE" },
  activity: { panel: byId("activity-panel"), title: "Live publishing activity", eyebrow: "VISIBLE AUTOMATION" },
  settings: { panel: byId("settings-panel"), title: "Companion settings", eyebrow: "LOCAL DESKTOP SERVICE" },
};

let activeView = "dashboard";
let currentStatus = null;
let currentWorkspace = { consentRequired: false, sessions: [] };
let logEntries = [];
let layoutFrame = null;

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
  return value;
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
    const browsers = [...document.querySelectorAll("[data-browser-session]")]
      .map(element => ({ id: element.dataset.browserSession, bounds: elementBounds(element) }))
      .filter(entry => entry.id && entry.bounds);
    void api.setLayout({
      dashboard: activeView === "dashboard" ? elementBounds(byId("dashboard-host")) : null,
      browsers: activeView === "activity" ? browsers : [],
    });
  });
}

function activeSessions() {
  return currentWorkspace.sessions.filter(session => session.active);
}

function createLiveCard(session) {
  const card = document.createElement("article");
  card.className = "live-card";

  const header = document.createElement("div");
  header.className = "live-card-header";

  const mark = document.createElement("span");
  mark.className = "platform-mark";
  mark.textContent = session.platform === "x" ? "X" : platformLabel(session.platform).slice(0, 2);

  const identity = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = session.displayName || session.handle || platformLabel(session.platform);
  const detail = document.createElement("small");
  detail.textContent = session.activity?.detail
    || (session.purpose === "login" ? "Complete login in this pane." : "Preparing the publishing page.");
  identity.append(name, detail);

  const state = document.createElement("span");
  state.className = `state-pill ${session.activity?.state || "opening"}`;
  state.textContent = stateLabel(session);
  header.append(mark, identity, state);

  const progress = document.createElement("div");
  progress.className = "live-progress";
  const progressFill = document.createElement("i");
  const index = Number(session.activity?.currentIndex || 0);
  const total = Number(session.activity?.totalItems || 0);
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
  const liveGrid = byId("live-grid");
  liveGrid.replaceChildren(...active.map(createLiveCard));
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
  byId("consent-backdrop").hidden = !currentWorkspace.consentRequired;
  scheduleLayout();
}

function renderStatus(status) {
  currentStatus = status;
  byId("version").textContent = status.version;
  byId("auto-start").checked = status.autoStart;
  byId("interaction-consent").checked = status.publishingInteractionConsent;
  byId("service-check").textContent = status.connected ? "Connected" : "Offline";
  byId("browser-check").textContent = status.embeddedBrowser ? "Built in" : status.chromeInstalled ? "Chrome" : "Unavailable";
  byId("scheduler-check").textContent = status.connected ? "Running" : "Stopped";

  const ready = Boolean(status.automationReady);
  byId("status-dot").className = ready ? "ready" : "error";
  byId("sidebar-status-dot").className = ready ? "ready" : "error";
  byId("status-title").textContent = ready ? "Ready for visible publishing" : "Companion needs attention";
  byId("status-detail").textContent = ready
    ? "Dashboard, scheduler and live embedded publishing browser are available."
    : status.error || "The local publishing service could not start.";
  byId("sidebar-status-title").textContent = ready ? "Ready" : "Needs attention";
  byId("sidebar-status-detail").textContent = ready ? "Local publishing online" : "Open Companion settings";
  byId("install-chrome").hidden = Boolean(status.embeddedBrowser);
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
      publishingInteractionConsent: currentStatus?.publishingInteractionConsent ?? false,
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
  if (activeView === "dashboard") await api.reloadDashboard();
  await Promise.all([refreshStatus(), refreshWorkspace()]);
});
byId("global-stop").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Stopping…";
  await api.emergencyStop();
  button.textContent = "Emergency stop";
  await refreshWorkspace();
});
byId("empty-open-dashboard").addEventListener("click", () => setView("dashboard"));
byId("open-data").addEventListener("click", () => api.openData());
byId("open-logs").addEventListener("click", () => api.openLogs());
byId("install-chrome").addEventListener("click", () => api.installChrome());
byId("auto-start").addEventListener("change", event => api.setAutoStart(event.currentTarget.checked));
byId("interaction-consent").addEventListener("change", async event => {
  const enabled = await api.setInteractionConsent(event.currentTarget.checked);
  event.currentTarget.checked = enabled;
  await refreshStatus();
});
byId("accept-consent").addEventListener("click", async () => {
  await api.setInteractionConsent(true);
  byId("consent-backdrop").hidden = true;
  await Promise.all([refreshStatus(), refreshWorkspace()]);
});
byId("decline-consent").addEventListener("click", async () => {
  await api.setInteractionConsent(false);
  byId("consent-backdrop").hidden = true;
  await refreshWorkspace();
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
api.onNavigate(section => setView(section));
api.onLog(entry => {
  logEntries = [...logEntries.slice(-79), entry];
  renderLogs();
});

new ResizeObserver(scheduleLayout).observe(document.body);
window.addEventListener("resize", scheduleLayout);
document.addEventListener("visibilitychange", scheduleLayout);

void Promise.all([refreshStatus(), refreshWorkspace()]).then(() => {
  renderLogs();
  scheduleLayout();
});
setInterval(refreshStatus, 5000);
