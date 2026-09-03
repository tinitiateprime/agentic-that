"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  MessageCircle,
  MonitorCheck,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  Trash2,
  UsersRound,
  X,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getClientServiceToken } from "@platform/client-service-token";
import ProductShell from "@platform/ProductShell";
import { rememberPublishingAccounts } from "@platform/use-product-status";

const PUBLISH_SESSION_KEY = "agenticthat-publish-queue-session";
const publishingCompanionDownloadUrl = process.env.NEXT_PUBLIC_PUBLISHING_COMPANION_DOWNLOAD_URL?.trim()
  || "/companion/download";
const publishingHealthUrl = "http://127.0.0.1:8792/api/health";
const publishPlatforms = ["instagram", "facebook", "x", "youtube", "linkedin"];
const platformLabels = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
  linkedin: "LinkedIn"
};
const platformLogos = {
  instagram: "/instagram-logo.svg",
  facebook: "/facebook-logo.svg",
  x: "/x-logo.svg",
  youtube: "/youtube-logo.svg",
  linkedin: "/linkedin-logo.png"
};
const publishingEngineLabels = {
  companion: "Companion",
  external_browser: "External browser"
};
const externalBrowserRequiredPlatforms = new Set(["x", "youtube"]);
const messagingPlatforms = ["telegram", "whatsapp"];
const messagingPlatformLabels = {
  telegram: "Telegram",
  whatsapp: "WhatsApp"
};
const messagingPlatformLogos = {
  telegram: "/telegram-logo.svg",
  whatsapp: "/whatsapp-logo.svg"
};
const accessRank = { none: 0, view: 1, operate: 2, configure: 3 };
const hasAccess = (access, resource, level) => (accessRank[access?.[resource] || "none"] || 0) >= accessRank[level];

const services = [
  {
    id: "messaging",
    name: "Messaging Automation",
    category: "Messaging",
    description: "Manage Telegram and WhatsApp accounts from one messaging workspace.",
    icon: MessageCircle,
    available: true
  },
  {
    id: "publishing",
    name: "Publish Queue Runner",
    category: "Publishing",
    description: "Manage every social account used by the publishing queue.",
    icon: Send,
    available: true
  },
  {
    id: "engagement",
    name: "Post Engagement Agent",
    category: "Engagement",
    description: "Engagement account configuration is reserved for the next service release.",
    icon: Zap,
    available: false
  }
];

function readPublishingSession() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(PUBLISH_SESSION_KEY) || "null");
    return parsed?.token && parsed?.user ? parsed : null;
  } catch {
    return null;
  }
}

async function responsePayload(response) {
  const text = await response.text().catch(() => "");
  const isJson = response.headers.get("content-type")?.includes("application/json");
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const fallback = isJson || !text.trim()
      ? text.trim() || "The request could not be completed."
      : `The service API returned ${response.status} instead of JSON. Refresh the page or check the service connection.`;
    const error = new Error(payload.message || payload.error || fallback);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function telegramRequest(path, identityToken, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("authorization", "Bearer " + await getClientServiceToken("telegram", identityToken));
  const response = await fetch("/api/telegram" + path, {
    ...init,
    headers,
    credentials: "include"
  });
  return responsePayload(response);
}

async function publishingRequest(path, token, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("authorization", "Bearer " + await getClientServiceToken("publishing", token));
  const normalized = path.startsWith("/api/") ? path.slice(4) : `/${path.replace(/^\//, "")}`;
  const response = await fetch("/api/publishing" + normalized, {
    ...init,
    headers,
    credentials: "include"
  });
  return responsePayload(response);
}

async function localCompanionRequest(path, token, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("authorization", "Bearer " + await getClientServiceToken("publishing", token));
  const response = await fetch("http://127.0.0.1:8792" + path, {
    ...init,
    cache: "no-store", headers, mode: "cors", targetAddressSpace: "loopback"
  });
  return responsePayload(response);
}

function ServiceMark({ service }) {
  if (service.logo) return <img src={service.logo} alt="" />;
  const Icon = service.icon;
  return <Icon size={22} />;
}

function InlineNotice({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className={"config-notice " + notice.tone} role="status">
      {notice.tone === "success" ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
      <span>{notice.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss message"><X size={16} /></button>
    </div>
  );
}

function EmptyState({ icon: Icon, title, copy, action }) {
  return (
    <div className="config-empty">
      <span><Icon size={26} /></span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

function ConnectionSteps({ steps, activeIndex = 0 }) {
  return (
    <ol className="config-connection-steps" aria-label="Connection steps">
      {steps.map((step, index) => {
        const StepIcon = step.icon;
        return (
        <li className={index < activeIndex ? "complete" : index === activeIndex ? "active" : ""} key={step.title}>
          <span className="config-step-icon"><StepIcon size={20} strokeWidth={1.9} /></span>
          <div><strong>{step.title}</strong><small>{step.copy}</small></div>
          {index < activeIndex && <i className="config-step-complete" aria-label="Completed"><Check size={12} strokeWidth={2.5} /></i>}
        </li>
        );
      })}
    </ol>
  );
}

export default function ConfigManager({
  initialService,
  initialMessagingPlatform,
  initialPublishingPlatform,
  initialTelegramConnect,
  publishingIdentityToken,
  telegramIdentityToken,
  effectiveAccess,
  user,
  telegramDashboardUrl,
  publishQueueUrl
}) {
  const [activeService, setActiveService] = useState(initialService);
  const [messagingPlatform, setMessagingPlatform] = useState(initialMessagingPlatform || "telegram");
  const [notice, setNotice] = useState(null);
  const [telegramStatus, setTelegramStatus] = useState("checking");
  const [telegramUser, setTelegramUser] = useState(null);
  const [telegramAccounts, setTelegramAccounts] = useState([]);
  const [publishingStatus, setPublishingStatus] = useState("checking");
  const [publishingManagerStatus, setPublishingManagerStatus] = useState(null);
  const [publishingSession, setPublishingSession] = useState(null);
  const [publishingAccounts, setPublishingAccounts] = useState([]);
  const [workspaceCompanion, setWorkspaceCompanion] = useState(null);
  const allowedMessagingPlatforms = messagingPlatforms.filter((platform) => hasAccess(effectiveAccess, `messaging.${platform}`, "configure"));
  const allowedPublishingPlatforms = publishPlatforms.filter((platform) => hasAccess(effectiveAccess, `publishing.${platform}`, "configure"));
  const visibleServices = services.filter((service) => (
    service.id === "messaging" ? allowedMessagingPlatforms.length > 0
      : service.id === "publishing" ? allowedPublishingPlatforms.length > 0
        : false
  ));

  const loadTelegram = useCallback(async () => {
    if (!telegramIdentityToken) { setTelegramStatus("unauthorized"); return; }
    try {
      const me = await telegramRequest("/me", telegramIdentityToken);
      const accountData = await telegramRequest("/telegram/accounts", telegramIdentityToken);
      setTelegramUser(me.user);
      setTelegramAccounts(accountData.accounts || []);
      setTelegramStatus("ready");
    } catch (error) {
      setTelegramUser(null);
      setTelegramAccounts([]);
      setTelegramStatus(error.status === 401 ? "needs-login" : "offline");
    }
  }, [telegramIdentityToken]);

  const loadPublishing = useCallback(async (candidateSession) => {
    // Publishing is authorized by the current AgenticThat workspace session.
    // A previous local Publish Queue password must never become the authority.
    const session = publishingIdentityToken
      ? { token: publishingIdentityToken }
      : candidateSession ?? readPublishingSession();
    if (!session) {
      setPublishingSession(null);
      setPublishingAccounts([]);
      rememberPublishingAccounts([]);
      setPublishingStatus("needs-login");
      return;
    }
    try {
      const me = await publishingRequest("/api/auth/me", session.token);
      const accounts = await publishingRequest("/api/accounts", session.token);
      const current = { token: session.token, user: me };
      setPublishingSession(current);
      const accountList = Array.isArray(accounts) ? accounts : [];
      setPublishingAccounts(accountList);
      rememberPublishingAccounts(accountList);
      setPublishingStatus(me.role === "operations_manager" ? "ready" : "needs-manager");
    } catch (error) {
      if (error.status === 401) {
        window.sessionStorage.removeItem(PUBLISH_SESSION_KEY);
        setPublishingSession(null);
        setPublishingAccounts([]);
        rememberPublishingAccounts([]);
        setPublishingStatus("needs-login");
      } else {
        setPublishingStatus("offline");
      }
    }
  }, [publishingIdentityToken]);

  const connectPublishing = useCallback(async () => {
    if (!publishingIdentityToken) { setPublishingStatus("unauthorized"); return; }
    try {
      const me = await publishingRequest("/api/auth/me", publishingIdentityToken);
      const centralSession = { token: publishingIdentityToken, user: me };
      setPublishingManagerStatus({ configured: true, username: me.email || me.username, workspaceId: me.workspaceId });
      window.sessionStorage.removeItem(PUBLISH_SESSION_KEY);
      return loadPublishing(centralSession);
    } catch (error) {
      window.sessionStorage.removeItem(PUBLISH_SESSION_KEY);
      setPublishingSession(null);
      setPublishingAccounts([]);
      setPublishingManagerStatus(null);
      setPublishingStatus(
        error.status === 401
          ? "needs-upgrade"
          : "offline"
      );
    }
  }, [loadPublishing, publishingIdentityToken]);

  const loadWorkspaceCompanion = useCallback(async () => {
    if (!publishingIdentityToken) return;
    try {
      const data = await publishingRequest("/api/companion", publishingIdentityToken);
      setWorkspaceCompanion(data.companion || null);
    } catch {
      setWorkspaceCompanion(null);
    }
  }, [publishingIdentityToken]);

  const refreshPublishingAccounts = useCallback(async () => {
    const token = publishingIdentityToken || publishingSession?.token;
    if (!token) return;
    try {
      const accounts = await publishingRequest("/api/accounts", token);
      const accountList = Array.isArray(accounts) ? accounts : [];
      setPublishingAccounts(accountList);
      rememberPublishingAccounts(accountList);
    } catch (error) {
      if (error.status === 401) setPublishingStatus("needs-login");
    }
  }, [publishingIdentityToken, publishingSession?.token]);

  useEffect(() => {
    void Promise.all([loadTelegram(), connectPublishing(), loadWorkspaceCompanion()]);
  }, [connectPublishing, loadTelegram, loadWorkspaceCompanion]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadWorkspaceCompanion();
      void refreshPublishingAccounts();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [loadWorkspaceCompanion, refreshPublishingAccounts]);

  const connectedCount = telegramAccounts.length + publishingAccounts.length;
  const activeDefinition = visibleServices.find(service => service.id === activeService) || visibleServices[0];

  const selectService = (serviceId) => {
    setActiveService(serviceId);
    const url = new URL(window.location.href);
    url.searchParams.set("service", serviceId);
    if (serviceId === "messaging") {
      url.searchParams.set("platform", messagingPlatform);
    } else if (serviceId === "engagement") {
      url.searchParams.delete("platform");
    }
    window.history.replaceState({}, "", url);
  };

  const selectMessagingPlatform = (platform) => {
    setMessagingPlatform(platform);
    const url = new URL(window.location.href);
    url.searchParams.set("service", "messaging");
    url.searchParams.set("platform", platform);
    window.history.replaceState({}, "", url);
  };

  const canRefresh = activeService === "publishing" || (activeService === "messaging" && messagingPlatform === "telegram");

  return (
    <ProductShell user={user} active="connections">
      <main className="config-shell">
        <section className="config-hero">
          <div>
            <p className="config-kicker"><Settings2 size={15} />Account connections</p>
            <h1>Connect and manage your accounts.</h1>
            <p>Add an account, complete its login, then return to the Store to open the service workspace.</p>
          </div>
          <div className="config-summary">
            <span><strong>{connectedCount}</strong><small>connected accounts</small></span>
            <span><strong>2</strong><small>active integrations</small></span>
            <span><strong>2</strong><small>planned integrations</small></span>
          </div>
        </section>

        <div className="config-layout">
        <aside className="config-service-nav">
          <div className="config-nav-heading"><span>Services</span><small>Choose a destination</small></div>
          {visibleServices.map(service => (
            <button
              key={service.id}
              className={activeService === service.id ? "active" : ""}
              type="button"
              onClick={() => selectService(service.id)}
            >
              <span className="config-service-mark"><ServiceMark service={service} /></span>
              <span><strong>{service.name}</strong><small>{service.category}</small></span>
              <i className={service.available ? "available" : "planned"}>{service.available ? "Live" : "Soon"}</i>
              <ChevronRight size={16} />
            </button>
          ))}
          <div className="config-security-note">
            <ShieldCheck size={19} />
            <span><strong>Service-owned security</strong><small>Sessions and credentials stay in each service’s existing encrypted or local store.</small></span>
          </div>
        </aside>

        <section className="config-content">
          <header className="config-content-head">
            <div className="config-service-title">
              <span className="config-service-mark large"><ServiceMark service={activeDefinition} /></span>
              <div><p>{activeDefinition.category}</p><h2>{activeDefinition.name}</h2><span>{activeDefinition.description}</span></div>
            </div>
            {canRefresh && (
              <button
                type="button"
                className="config-refresh"
                onClick={() => activeService === "messaging" ? void loadTelegram() : void connectPublishing()}
              >
                <RefreshCw size={16} />Refresh
              </button>
            )}
          </header>

          <InlineNotice notice={notice} onClose={() => setNotice(null)} />

          {activeService === "messaging" && (
            <MessagingManager
              platform={messagingPlatform}
              onPlatformChange={selectMessagingPlatform}
              status={telegramStatus}
              user={telegramUser}
              platformUser={user}
              accounts={telegramAccounts}
              dashboardUrl={telegramDashboardUrl}
              continueTelegramConnect={initialTelegramConnect}
              telegramIdentityToken={telegramIdentityToken}
              allowedPlatforms={allowedMessagingPlatforms}
              onReload={loadTelegram}
              setNotice={setNotice}
            />
          )}
          {activeService === "publishing" && (
            <PublishingManager
              status={publishingStatus}
              session={publishingSession}
              accounts={publishingAccounts}
              initialPlatform={initialPublishingPlatform}
              publishQueueUrl={publishQueueUrl}
              publishingIdentityToken={publishingIdentityToken}
              allowedPlatforms={allowedPublishingPlatforms}
              workspaceCompanion={workspaceCompanion}
              managerStatus={publishingManagerStatus}
              accountEmail={user.email}
              onSession={session => {
                setPublishingSession(session);
                void loadPublishing(session);
              }}
              onReload={() => loadPublishing(publishingSession)}
              onReconnect={connectPublishing}
              onCompanionSaved={setWorkspaceCompanion}
              setNotice={setNotice}
            />
          )}
          {activeService === "engagement" && (
            <PlaceholderService
              icon={Bot}
              title="Post Engagement Agent is coming next"
              copy="Account connections for monitored engagement sessions will live here when the engagement service becomes active."
            />
          )}
        </section>
        </div>
      </main>
    </ProductShell>
  );
}

function MessagingManager({
  platform,
  onPlatformChange,
  status,
  user,
  platformUser,
  accounts,
  dashboardUrl,
  continueTelegramConnect,
  telegramIdentityToken,
  allowedPlatforms,
  onReload,
  setNotice
}) {
  return (
    <>
      <div className="config-platform-tabs messaging-tabs" role="tablist" aria-label="Messaging platform">
        {allowedPlatforms.map(item => (
          <button
            type="button"
            role="tab"
            aria-selected={platform === item}
            className={platform === item ? "active" : ""}
            key={item}
            onClick={() => onPlatformChange(item)}
          >
            <img src={messagingPlatformLogos[item]} alt="" />
            <span>{messagingPlatformLabels[item]}</span>
            <i>{item === "telegram" ? accounts.length : "Live"}</i>
          </button>
        ))}
      </div>

      {platform === "telegram" ? (
        <TelegramManager
          status={status}
          user={user}
          platformUser={platformUser}
          accounts={accounts}
          dashboardUrl={dashboardUrl}
          continueTelegramConnect={continueTelegramConnect}
          telegramIdentityToken={telegramIdentityToken}
          onReload={onReload}
          setNotice={setNotice}
        />
      ) : (
        <WhatsAppManager />
      )}
    </>
  );
}

function WhatsAppManager() {
  return (
    <div className="config-placeholder">
      <span><MessageCircle size={32} /></span>
      <p>Live connector</p>
      <h3>WhatsApp configuration is active</h3>
      <div>
        Connect Meta Embedded Signup/coexistence, Cloud API credentials, WATI,
        sender numbers, calling, and optional read-only monitoring from the
        dedicated WhatsApp settings workspace.
      </div>
      <div className="config-form-actions">
        <a className="config-primary" href="/settings">Open WhatsApp settings<ExternalLink size={15} /></a>
        <a className="config-secondary" href="/dashboard">Open dashboard<ArrowRight size={15} /></a>
      </div>
    </div>
  );
}

function PlaceholderService({ icon: Icon, title, copy }) {
  return (
    <div className="config-placeholder">
      <span><Icon size={32} /></span>
      <p>Placeholder</p>
      <h3>{title}</h3>
      <div>{copy}</div>
      <small><Check size={14} />No changes were made to the existing service.</small>
    </div>
  );
}

function TelegramManager({
  status,
  user,
  platformUser,
  accounts,
  dashboardUrl,
  continueTelegramConnect,
  telegramIdentityToken,
  onReload,
  setNotice
}) {
  const [connecting, setConnecting] = useState(false);
  const [stage, setStage] = useState("phone");
  const [challengeId, setChallengeId] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [workspaceAuthMode, setWorkspaceAuthMode] = useState("signin");
  const [workspaceUsername, setWorkspaceUsername] = useState(platformUser?.email || "");
  const [workspacePassword, setWorkspacePassword] = useState("");
  const [workspaceDisplayName, setWorkspaceDisplayName] = useState(platformUser?.name || platformUser?.businessName || "");

  useEffect(() => {
    if (!continueTelegramConnect || status !== "ready") return;
    setConnecting(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("continue");
    window.history.replaceState({}, "", url);
  }, [continueTelegramConnect, status]);

  const authenticateWorkspace = async (event) => {
    event.preventDefault();
    const creating = workspaceAuthMode === "register";
    setBusy(true);
    try {
      const data = await telegramRequest(creating ? "/auth/register" : "/auth/password", telegramIdentityToken, {
        method: "POST",
        body: JSON.stringify({
          username: workspaceUsername.trim(),
          password: workspacePassword,
          ...(creating ? { displayName: workspaceDisplayName.trim() } : {})
        })
      });
      setWorkspacePassword("");
      setConnecting(true);
      setNotice({
        tone: "success",
        message: "Telegram dashboard access is ready for " + (data.user?.displayName || workspaceUsername.trim()) + ". Add the Telegram account below."
      });
      await onReload();
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const resetConnection = () => {
    setConnecting(false);
    setStage("phone");
    setChallengeId("");
    setPhone("");
    setCode("");
    setPassword("");
  };

  const startConnection = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await telegramRequest("/telegram/login/start", telegramIdentityToken, {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim() })
      });
      setChallengeId(data.challengeId);
      setStage("code");
      setNotice({
        tone: "success",
        message: "Telegram sent a verification code through " + (data.codeDelivery === "sms" ? "SMS." : "the Telegram app.")
      });
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await telegramRequest("/telegram/login/" + encodeURIComponent(challengeId) + "/code", telegramIdentityToken, {
        method: "POST",
        body: JSON.stringify({ code: code.trim() })
      });
      if (data.status === "password_required") {
        setStage("password");
        setCode("");
        setNotice({ tone: "success", message: "Verification accepted. Enter the Telegram two-factor password." });
      } else {
        await finishTelegramConnection(data);
      }
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await telegramRequest("/telegram/login/" + encodeURIComponent(challengeId) + "/password", telegramIdentityToken, {
        method: "POST",
        body: JSON.stringify({ password })
      });
      await finishTelegramConnection(data);
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const finishTelegramConnection = async (data) => {
    setNotice({ tone: "success", message: data.account.displayName + " is connected and ready in Telegram." });
    resetConnection();
    await onReload();
  };

  const removeAccount = async (account) => {
    if (!window.confirm("Disconnect " + (account.displayName || account.username || "this Telegram account") + "?")) return;
    setBusy(true);
    try {
      await telegramRequest("/telegram/accounts/" + encodeURIComponent(account.id), telegramIdentityToken, { method: "DELETE" });
      setNotice({ tone: "success", message: "Telegram account disconnected." });
      await onReload();
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  if (status === "checking") {
    return <div className="config-loading"><Loader2 className="spin" size={23} />Checking Telegram connection…</div>;
  }

  if (status === "offline") {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Telegram service is unavailable"
        copy="Start the AgenticThat development workspace, then refresh this integration."
        action={<button className="config-primary" type="button" onClick={() => void onReload()}><RefreshCw size={16} />Try again</button>}
      />
    );
  }

  if (status === "needs-login") {
    return (
      <div className="config-auth-card telegram-auth-card">
        <div className="config-auth-copy">
          <span><LockKeyhole size={25} /></span>
          <p>One login for Connections and Telegram</p>
          <h3>{workspaceAuthMode === "register" ? "Create your Telegram dashboard login" : "Use your Telegram dashboard login"}</h3>
          <div>{workspaceAuthMode === "register"
            ? "This creates the same login used before the Telegram dashboard. Create it once here, then connect your Telegram number below."
            : "Enter the same username and password used before opening the Telegram dashboard. The account form opens here immediately."}</div>
          <small><ShieldCheck size={14} />The same secure session opens Connections and the Telegram dashboard.</small>
        </div>
        <form onSubmit={authenticateWorkspace}>
          <div className="config-auth-mode" role="tablist" aria-label="Telegram workspace access">
            <button type="button" role="tab" aria-selected={workspaceAuthMode === "signin"} className={workspaceAuthMode === "signin" ? "active" : ""} onClick={() => setWorkspaceAuthMode("signin")}>Sign in</button>
            <button type="button" role="tab" aria-selected={workspaceAuthMode === "register"} className={workspaceAuthMode === "register" ? "active" : ""} onClick={() => setWorkspaceAuthMode("register")}>Create dashboard login</button>
          </div>
          {workspaceAuthMode === "register" && (
            <label><span>Workspace name</span><input value={workspaceDisplayName} onChange={event => setWorkspaceDisplayName(event.target.value)} autoComplete="name" placeholder="Your name or business" required /></label>
          )}
          <label><span>Username</span><input value={workspaceUsername} onChange={event => setWorkspaceUsername(event.target.value)} autoComplete="username" placeholder="you@example.com" required /></label>
          <label><span>Password</span><div className="config-secret-input"><input type={showPassword ? "text" : "password"} value={workspacePassword} onChange={event => setWorkspacePassword(event.target.value)} autoComplete={workspaceAuthMode === "register" ? "new-password" : "current-password"} minLength={8} required /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
          <button className="config-primary full" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}{workspaceAuthMode === "register" ? "Create login and add account" : "Sign in and add account"}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="config-manager-body">
      <div className="config-integration-bar">
        <div><CheckCircle2 size={18} /><span><strong>Telegram workspace connected</strong><small>Signed in as {user?.displayName || "Telegram user"}</small></span></div>
        {!connecting && <button className="config-primary" type="button" onClick={() => setConnecting(true)}><Plus size={16} />Connect Telegram account</button>}
      </div>

      {connecting && (
        <section className="config-form-card">
          <header>
            <span><KeyRound size={21} /></span>
            <div><p>New Telegram connection</p><h3>{stage === "phone" ? "Enter your phone number" : stage === "code" ? "Verification code" : "Two-factor password"}</h3></div>
            <button type="button" onClick={resetConnection} aria-label="Close form"><X size={18} /></button>
          </header>

          <ConnectionSteps
            activeIndex={stage === "phone" ? 0 : stage === "code" ? 1 : 2}
            steps={[
              { icon: Smartphone, title: "Phone number", copy: "Use the full country code." },
              { icon: KeyRound, title: "Verification", copy: "Enter Telegram's newest code." },
              { icon: ShieldCheck, title: "Secure finish", copy: "Use your 2-step password only if asked." }
            ]}
          />

          {stage === "phone" && (
            <form onSubmit={startConnection}>
              <div className="config-form-grid">
                <label className="wide"><span>Phone number with country code</span><input value={phone} onChange={event => setPhone(event.target.value)} type="tel" autoComplete="tel" placeholder="+91 98765 43210" required /></label>
              </div>
              <p className="config-form-help">AgenticThat securely handles the app connection. Telegram will send a one-time verification code to this account.</p>
              <div className="config-form-actions"><button className="config-secondary" type="button" onClick={resetConnection}>Cancel</button><button className="config-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}Send verification code</button></div>
            </form>
          )}

          {stage === "code" && (
            <form onSubmit={submitCode}>
              <label className="config-code-field"><span>Verification code</span><input value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="12345" autoFocus required /></label>
              <p className="config-form-help">Enter the newest code sent by Telegram. It is used once and is not saved.</p>
              <div className="config-form-actions"><button className="config-secondary" type="button" onClick={() => setStage("phone")}>Start over</button><button className="config-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Verify account</button></div>
            </form>
          )}

          {stage === "password" && (
            <form onSubmit={submitPassword}>
              <label className="config-code-field"><span>Telegram two-factor password</span><div className="config-secret-input"><input type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" autoFocus required /><button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
              <p className="config-form-help">This is required only when two-step verification is enabled on the Telegram account.</p>
              <div className="config-form-actions"><button className="config-secondary" type="button" onClick={resetConnection}>Cancel</button><button className="config-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}Finish connection</button></div>
            </form>
          )}
        </section>
      )}

      <AccountCollectionHeader
        count={accounts.length}
        title="Connected Telegram accounts"
        copy="These accounts automatically appear in Telegram account selectors."
      />
      {accounts.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No Telegram accounts connected"
          copy="Connect one Telegram number. It will be available to permitted teammates in the Telegram workspace."
          action={<button className="config-primary" type="button" onClick={() => setConnecting(true)}><Plus size={16} />Connect first account</button>}
        />
      ) : (
        <div className="config-account-list">
          {accounts.map(account => (
            <article className="config-account-row" key={account.id}>
              <span className="config-account-logo"><img src="/telegram-logo.svg" alt="" /></span>
              <span className="config-account-main"><strong>{account.displayName || "Telegram account"}</strong><small>{account.username ? "@" + account.username : "Telegram user " + account.telegramUserId}</small></span>
              <span className="config-account-state"><i />Connected</span>
              <span className="config-account-meta">Ready to open in Telegram</span>
              <div className="config-account-actions">
                <button className="open" type="button" onClick={() => window.location.assign(dashboardUrl)} disabled={!dashboardUrl}><ArrowRight size={15} />Open</button>
                <button className="danger" type="button" onClick={() => void removeAccount(account)} disabled={busy} aria-label={"Delete " + account.displayName}><Trash2 size={15} />Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountCollectionHeader({ count, title, copy }) {
  return (
    <div className="config-collection-head">
      <div><h3>{title}</h3><p>{copy}</p></div>
      <span>{count} {count === 1 ? "account" : "accounts"}</span>
    </div>
  );
}

function PublishingManager({
  status,
  session,
  accounts,
  initialPlatform,
  publishQueueUrl,
  publishingIdentityToken,
  allowedPlatforms,
  workspaceCompanion,
  managerStatus,
  accountEmail,
  onSession,
  onReload,
  onReconnect,
  onCompanionSaved,
  setNotice
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState(initialPlatform || "instagram");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loginAccountId, setLoginAccountId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [companionBusy, setCompanionBusy] = useState(false);

  const platformAccounts = useMemo(
    () => accounts.filter(account => account.platform === selectedPlatform),
    [accounts, selectedPlatform]
  );

  const signIn = async (event) => {
    event.preventDefault();
    const firstSetup = status === "needs-setup";
    if (firstSetup && password !== confirmPassword) {
      setNotice({ tone: "error", message: "Passwords do not match." });
      return;
    }
    setBusy(true);
    try {
      const response = await publishingRequest(firstSetup ? "/api/auth/platform/setup" : "/api/auth/platform/login", "", {
        method: "POST",
        body: JSON.stringify({ token: publishingIdentityToken, password })
      });
      if (response.user.role !== "operations_manager") {
        throw new Error("Use an Operations Manager account to configure publishing accounts.");
      }
      const nextSession = { token: response.token, user: response.user };
      window.sessionStorage.setItem(PUBLISH_SESSION_KEY, JSON.stringify(nextSession));
      setPassword("");
      setConfirmPassword("");
      onSession(nextSession);
      setNotice({ tone: "success", message: "Publish Queue configuration access is ready." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const signOutPublishing = () => {
    window.sessionStorage.removeItem(PUBLISH_SESSION_KEY);
    onSession(null);
  };

  const saveAccount = async (form) => {
    setBusy(true);
    try {
      const body = JSON.stringify({
        displayName: form.displayName.trim(),
        handle: form.handle.trim(),
        loginIdentifier: form.loginIdentifier.trim(),
        enabled: form.enabled,
        executionEngine: form.executionEngine
      });
      const account = form.id
        ? await publishingRequest("/api/accounts/" + encodeURIComponent(form.id), session.token, { method: "PATCH", body })
        : await publishingRequest("/api/platforms/" + selectedPlatform + "/accounts", session.token, { method: "POST", body });
      setEditing(null);
      setNotice({ tone: "success", message: account.displayName + " now uses " + publishingEngineLabels[account.executionEngine || "companion"] + "." });
      await onReload();
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (account) => {
    if (!window.confirm("Delete " + account.displayName + "? Existing post history may prevent deletion.")) return;
    setBusy(true);
    try {
      await publishingRequest("/api/accounts/" + encodeURIComponent(account.id), session.token, { method: "DELETE" });
      setNotice({ tone: "success", message: account.displayName + " was removed." });
      await onReload();
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const startLogin = async (account, surface = "engine") => {
    if (!workspaceCompanion) {
      setNotice({ tone: "error", message: "Pair this manager device as the Workspace Companion before signing in to a social account." });
      return;
    }
    setLoginAccountId(account.id);
    try {
      await localCompanionRequest("/api/companion/accounts/import", session.token, {
        method: "POST",
        body: JSON.stringify({ account })
      });
      const result = await localCompanionRequest("/api/accounts/" + encodeURIComponent(account.id) + "/manual-login", session.token, {
        method: "POST",
        body: JSON.stringify({ surface })
      });
      setNotice({ tone: "success", message: result.message || "Complete the sign-in in the Companion browser. The workspace will update automatically." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setLoginAccountId("");
    }
  };

  const openPublishingAccount = (account) => {
    if (!account.enabled || !account.credentialConfigured) return;
    const destination = new URL(publishQueueUrl, window.location.origin);
    destination.searchParams.set("platform", account.platform);
    destination.searchParams.set("account", account.id);
    window.location.assign(destination.toString());
  };

  const pairWorkspaceCompanion = async () => {
    setCompanionBusy(true);
    try {
      const healthResponse = await fetch(publishingHealthUrl, { cache: "no-store", mode: "cors", targetAddressSpace: "loopback" });
      if (!healthResponse.ok) throw new Error("Install and open AgenticThat Companion on this device, then try again.");
      const health = await healthResponse.json();
      if (!health.automationReady || !health.companionInstanceId) throw new Error("AgenticThat Companion is still starting. Wait a moment and try again.");
      const companionInstanceId = String(health.companionInstanceId);
      const data = await publishingRequest("/api/companion/pair", session.token, {
        method: "POST",
        body: JSON.stringify({
          label: "Workspace Companion",
          companionInstanceId
        })
      });
      const localPairing = await localCompanionRequest("/api/companion/pair", session.token, {
        method: "POST",
        body: JSON.stringify({
          supabaseUrl: data.supabaseUrl,
          supabaseApiKey: data.supabaseApiKey,
          pairingCode: data.pairingCode
        })
      });
      onCompanionSaved(localPairing.companion || null);
      setNotice({ tone: "success", message: "This device is paired. It will publish for authorized workspace members automatically." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error && /Companion|pair/i.test(error.message) ? error.message : "Could not pair this device. Open AgenticThat Companion here, then try again." });
    } finally {
      setCompanionBusy(false);
    }
  };

  const removeWorkspaceCompanion = async () => {
    setCompanionBusy(true);
    try {
      await publishingRequest("/api/companion", session.token, { method: "DELETE" });
      onCompanionSaved(null);
      setNotice({ tone: "success", message: "Workspace Companion pairing was removed." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setCompanionBusy(false);
    }
  };

  if (status === "checking") {
    return <div className="config-loading"><Loader2 className="spin" size={23} />Checking Publish Queue access…</div>;
  }

  if (status === "offline") {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Companion is not ready on this device"
        copy="Install and open AgenticThat Companion on this computer, then try again. Team members do not need to do this."
        action={
          <div className="config-empty-actions">
            <a className="config-primary" href={publishingCompanionDownloadUrl}>Install Companion<ExternalLink size={15} /></a>
            <button className="config-secondary" type="button" onClick={() => void onReconnect()}><RefreshCw size={15} />Try again</button>
          </div>
        }
      />
    );
  }

  if (status === "needs-upgrade") {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Update the Publishing Companion"
        copy="This computer is running an older Companion that does not support account-owned Operations Manager passwords. Close it, install the latest version, and try again."
        action={
          <div className="config-empty-actions">
            <a className="config-primary" href={publishingCompanionDownloadUrl}>Download latest Companion<ExternalLink size={15} /></a>
            <button className="config-secondary" type="button" onClick={() => void onReconnect()}><RefreshCw size={15} />Try again</button>
          </div>
        }
      />
    );
  }

  if (status === "needs-login" || status === "needs-setup" || status === "needs-manager") {
    const firstSetup = status === "needs-setup";
    const managerUsername = managerStatus?.username || accountEmail || "your workspace";
    return (
      <div className="config-auth-card">
        <div className="config-auth-copy">
          <span><LockKeyhole size={25} /></span>
          <p>{firstSetup ? "First-time workspace setup" : "Protected configuration"}</p>
          <h3>{firstSetup ? "Create your Operations Manager password" : "Operations Manager access required"}</h3>
          <div>{firstSetup
            ? "Choose your own password now. This account creator becomes the Operations Manager and will use this password for future publishing logins."
            : "Enter the Operations Manager password you created for this account."}</div>
          <small><ShieldCheck size={14} />This password belongs to <strong>{managerUsername}</strong>, not the Companion.</small>
          {status === "needs-manager" && <small><CircleAlert size={14} />The current Publish Queue role cannot manage accounts.</small>}
        </div>
        <form onSubmit={signIn}>
          <label><span>Manager account (automatic)</span><input name="username" value={managerUsername} autoComplete="username" readOnly /></label>
          <label><span>{firstSetup ? "Create password" : "Operations Manager password"}</span><div className="config-secret-input"><input type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete={firstSetup ? "new-password" : "current-password"} minLength={8} required /><button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
          {firstSetup && <label><span>Confirm password</span><div className="config-secret-input"><input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></div></label>}
          <button className="config-primary full" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}{firstSetup ? "Create manager access" : "Continue to accounts"}</button>
          <a href={publishQueueUrl} target="_blank" rel="noreferrer">Open Publish Queue Runner<ExternalLink size={14} /></a>
        </form>
      </div>
    );
  }

  return (
    <div className="config-manager-body">
      <div className="config-integration-bar">
        <div><CheckCircle2 size={18} /><span><strong>Publish Queue access connected</strong><small>{session.user.fullName} · Operations Manager</small></span></div>
        <div className="config-integration-actions">
          <a className="config-secondary" href={publishQueueUrl} target="_blank" rel="noreferrer">Open runner<ExternalLink size={14} /></a>
          <button className="config-tertiary" type="button" onClick={signOutPublishing}>Change login</button>
        </div>
      </div>

      {!workspaceCompanion ? (
        <section className="config-companion-guide" aria-labelledby="companion-guide-title">
          <header>
            <span><MonitorCheck size={20} /></span>
            <div><p>One-time manager setup</p><h3 id="companion-guide-title">Set up this publishing computer</h3><small>Only one Publishing Manager needs Companion. Everyone else works from the browser.</small></div>
          </header>
          <ConnectionSteps
            activeIndex={0}
            steps={[
              { icon: Download, title: "Install and open", copy: "Download Companion on this computer." },
              { icon: Link2, title: "Pair this device", copy: "Keep Companion open, then connect it here." },
              { icon: Plug, title: "Connect accounts", copy: "Add a platform account and complete Login." }
            ]}
          />
          <div className="config-companion-guide-actions">
            <a className="config-secondary" href={publishingCompanionDownloadUrl}><ExternalLink size={15} />Download Companion</a>
            <button className="config-primary" type="button" onClick={() => void pairWorkspaceCompanion()} disabled={companionBusy}>{companionBusy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}Pair this device</button>
          </div>
          <p>Already installed? Open Companion and select <strong>Pair this device</strong>.</p>
        </section>
      ) : (
        <section className="config-shared-companion">
          <div>
            <span><MonitorCheck size={18} /></span>
            <div>
              <strong>Workspace Companion</strong>
              <small>{workspaceCompanion.status === "online"
                ? workspaceCompanion.accountHealth?.loginRequired > 0
                  ? `Online — login required for ${workspaceCompanion.accountHealth.loginRequired} account${workspaceCompanion.accountHealth.loginRequired === 1 ? "" : "s"}.`
                  : "Online — ready for workspace publishing."
                : workspaceCompanion.status === "updating"
                  ? "Updating — publishing will continue after Companion restarts."
                  : workspaceCompanion.status === "outdated"
                    ? `Update Companion to ${workspaceCompanion.minimumSupportedVersion || "the latest version"} to continue.`
                    : workspaceCompanion.status === "error"
                      ? workspaceCompanion.lastError || "Companion needs attention on the paired computer."
                      : "Offline — queued posts will continue when it reconnects."}</small>
              <small>{workspaceCompanion.version
                ? `Version ${workspaceCompanion.version}${workspaceCompanion.lastSeenAt ? ` · Last heartbeat ${new Date(workspaceCompanion.lastSeenAt).toLocaleString()}` : ""}`
                : "Waiting for the first secure heartbeat."}</small>
            </div>
          </div>
          <div className="config-shared-companion-actions">
            <button className="config-secondary" type="button" onClick={() => void pairWorkspaceCompanion()} disabled={companionBusy}>{companionBusy ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}Re-pair</button>
            <button className="config-tertiary" type="button" onClick={() => void removeWorkspaceCompanion()} disabled={companionBusy}>Remove</button>
          </div>
          <p>Team members can use their normal workspace on any device.</p>
        </section>
      )}

      <div className="config-platform-tabs" role="tablist" aria-label="Publishing platform">
        {allowedPlatforms.map(platform => {
          const count = accounts.filter(account => account.platform === platform).length;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={selectedPlatform === platform}
              className={selectedPlatform === platform ? "active" : ""}
              key={platform}
              onClick={() => {
                setSelectedPlatform(platform);
                setEditing(null);
              }}
            >
              <img src={platformLogos[platform]} alt="" />
              <span>{platformLabels[platform]}</span>
              <i>{count}</i>
            </button>
          );
        })}
      </div>

      <div className="config-publishing-toolbar">
        <div><h3>{platformLabels[selectedPlatform]} accounts</h3><p>Accounts added here appear immediately in composers, queues, and channel views.</p></div>
        {!editing && <button className="config-primary" type="button" onClick={() => setEditing({ platform: selectedPlatform, enabled: true })}><Plus size={16} />Add account</button>}
      </div>

      {editing && (
        <PublishingAccountForm
          platform={selectedPlatform}
          account={editing.id ? editing : null}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={saveAccount}
        />
      )}

      {!editing && platformAccounts.length === 0 ? (
        <EmptyState
          icon={Plug}
          title={"No " + platformLabels[selectedPlatform] + " accounts"}
          copy={workspaceCompanion ? "Add an account, then use Login once to make it ready for publishing." : "Pair the manager computer above, then add your first publishing account."}
          action={<button className="config-primary" type="button" onClick={() => setEditing({ platform: selectedPlatform, enabled: true })}><Plus size={16} />Add first account</button>}
        />
      ) : !editing && (
        <div className="config-account-list">
          {platformAccounts.map(account => (
            <article className="config-account-row publishing" key={account.id}>
              <span className="config-account-logo"><img src={platformLogos[account.platform]} alt="" /></span>
              <span className="config-account-main"><strong>{account.displayName}</strong><small>{account.handle}</small></span>
              <span className={"config-account-state " + (!account.enabled ? "paused" : account.credentialConfigured ? "" : "attention")}><i />{!account.enabled ? "Paused" : account.credentialConfigured ? account.companionStatus === "online" ? "Ready" : "Waiting for Companion" : "Reconnect required"}</span>
              <span className="config-account-meta config-account-engine">{(account.executionEngine || "companion") === "external_browser" ? <ExternalLink size={14} /> : <MonitorCheck size={14} />}<span>{publishingEngineLabels[account.executionEngine || "companion"]}</span></span>
              <div className="config-account-actions">
                <button className="open" type="button" onClick={() => openPublishingAccount(account)} disabled={!account.enabled || !account.credentialConfigured} title={!account.enabled ? "Enable this account before opening it" : !account.credentialConfigured ? "Complete Login before opening this workspace" : "Open publishing workspace"}><ArrowRight size={15} />Open</button>
                <button type="button" onClick={() => setEditing(account)} disabled={busy} title="Edit account details"><Pencil size={15} />Edit</button>
                <button type="button" onClick={() => void startLogin(account)} disabled={!account.enabled || Boolean(loginAccountId)} title={account.credentialConfigured ? "Sign in again and refresh the selected engine session" : "Sign in with the selected engine"}>{loginAccountId === account.id ? <Loader2 className="spin" size={15} /> : (account.executionEngine || "companion") === "external_browser" ? <ExternalLink size={15} /> : <KeyRound size={15} />}Login</button>
                {(account.executionEngine || "companion") === "companion" && <button className="icon-only" type="button" onClick={() => void startLogin(account, "external")} disabled={!account.enabled || Boolean(loginAccountId)} title="Open system-browser login fallback" aria-label={"Open " + account.displayName + " login in the system browser"}><ExternalLink size={15} /></button>}
                <button className="danger" type="button" onClick={() => void removeAccount(account)} disabled={busy} title="Delete account"><Trash2 size={15} />Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function PublishingAccountForm({ platform, account, busy, onCancel, onSave }) {
  const [displayName, setDisplayName] = useState(account?.displayName || "");
  const [handle, setHandle] = useState(account?.handle || "");
  const [loginIdentifier, setLoginIdentifier] = useState(account?.loginIdentifier || "");
  const [enabled, setEnabled] = useState(account?.enabled ?? true);
  const externalBrowserRequired = externalBrowserRequiredPlatforms.has(platform);
  const [executionEngine, setExecutionEngine] = useState(
    externalBrowserRequired ? "external_browser" : account?.executionEngine || "companion"
  );
  const engineChanged = Boolean(account && executionEngine !== (account.executionEngine || "companion"));

  const submit = (event) => {
    event.preventDefault();
    if (engineChanged && account.credentialConfigured && !window.confirm("Changing the publishing engine signs this account out. Continue and log in again?")) return;
    void onSave({
      id: account?.id,
      displayName,
      handle,
      loginIdentifier,
      enabled,
      executionEngine
    });
  };

  return (
    <section className="config-form-card publishing-form">
      <header>
        <span className="platform-form-logo"><img src={platformLogos[platform]} alt="" /></span>
        <div><p>{platformLabels[platform]}</p><h3>{account ? "Edit publishing account" : "Add publishing account"}</h3></div>
        <button type="button" onClick={onCancel} aria-label="Close form"><X size={18} /></button>
      </header>
      <form onSubmit={submit}>
        <div className="config-form-grid">
          <label><span>Account name</span><input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder={"Brand " + platformLabels[platform]} required /></label>
          <label><span>Public handle</span><input value={handle} onChange={event => setHandle(event.target.value)} placeholder="@brand" required /></label>
          <label><span>Login hint (optional)</span><input value={loginIdentifier} onChange={event => setLoginIdentifier(event.target.value)} placeholder="Only a label; credentials stay on the provider sign-in page" /></label>
          <fieldset className="config-engine-field wide">
            <legend>Publishing engine</legend>
            <div className="config-engine-picker" role="group" aria-label="Choose publishing engine">
              <button type="button" disabled={externalBrowserRequired} className={executionEngine === "companion" ? "active" : ""} aria-pressed={executionEngine === "companion"} onClick={() => setExecutionEngine("companion")}><MonitorCheck size={18} /><span><strong>Companion</strong><small>{externalBrowserRequired ? "Embedded login is blocked by this provider" : "Runs in the background and opens only when attention is needed"}</small></span></button>
              <button type="button" className={executionEngine === "external_browser" ? "active" : ""} aria-pressed={executionEngine === "external_browser"} onClick={() => setExecutionEngine("external_browser")}><ExternalLink size={18} /><span><strong>External browser</strong><small>Dedicated Chrome, Edge, or Chromium profile</small></span></button>
            </div>
            {externalBrowserRequired && <p className="config-engine-warning"><ShieldCheck size={14} />X and YouTube require a persistent external-browser session. Companion stores and reuses its dedicated local profile.</p>}
            {engineChanged && <p className="config-engine-warning"><CircleAlert size={14} />Saving this change clears the old browser session. Use Login once afterward.</p>}
          </fieldset>
          <label className="config-toggle wide"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span><strong>Enabled for publishing</strong><small>Disabled accounts remain visible but cannot receive new posts.</small></span></label>
        </div>
        <div className="config-form-actions"><button className="config-secondary" type="button" onClick={onCancel}>Cancel</button><button className="config-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}{account ? "Save changes" : "Add account"}</button></div>
      </form>
    </section>
  );
}
