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
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  MessageCircle,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClientServiceToken } from "@platform/client-service-token";
import ProductShell from "@platform/ProductShell";
import { rememberPublishingAccounts } from "@platform/use-product-status";

const PUBLISH_SESSION_KEY = "agenticthat-publish-queue-session";
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
  const response = await fetch("/api/central-publishing" + normalized, {
    ...init,
    headers,
    credentials: "include"
  });
  return responsePayload(response);
}

async function serverAutomationRequest(path, identityToken, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("authorization", "Bearer " + await getClientServiceToken("publishing", identityToken));
  const response = await fetch("/api/automation-server" + path, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "include"
  });
  return responsePayload(response);
}

async function serverAutomationFrame(sessionId, identityToken) {
  const headers = new Headers({
    authorization: "Bearer " + await getClientServiceToken("publishing", identityToken)
  });
  const response = await fetch("/api/automation-server/sessions/" + encodeURIComponent(sessionId) + "/frame", {
    headers,
    cache: "no-store",
    credentials: "include"
  });
  if (!response.ok) await responsePayload(response);
  return response.blob();
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
  const [serverAutomation, setServerAutomation] = useState(null);
  const [serverAutomationError, setServerAutomationError] = useState("");
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
      rememberPublishingAccounts([]);
      setPublishingStatus("needs-login");
      return;
    }
    try {
      const me = await publishingRequest("/api/auth/me", session.token);
      const current = { token: session.token, user: me };
      setPublishingSession(current);
      setPublishingStatus(me.role === "operations_manager" ? "ready" : "needs-manager");
    } catch (error) {
      if (error.status === 401) {
        window.sessionStorage.removeItem(PUBLISH_SESSION_KEY);
        setPublishingSession(null);
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
      setPublishingManagerStatus(null);
      setPublishingStatus(
        error.status === 401
          ? "needs-upgrade"
          : "offline"
      );
    }
  }, [loadPublishing, publishingIdentityToken]);

  const loadServerAutomation = useCallback(async () => {
    if (!publishingIdentityToken) return;
    try {
      const [health, accountData] = await Promise.all([
        serverAutomationRequest("/health", publishingIdentityToken),
        serverAutomationRequest("/accounts", publishingIdentityToken)
      ]);
      const accounts = accountData.accounts || [];
      setServerAutomation({ health, accounts });
      rememberPublishingAccounts(accounts.map(serverAccountForConfig));
      setServerAutomationError("");
    } catch (error) {
      setServerAutomation(null);
      setServerAutomationError(error.status === 404 ? "" : error.message || "Server worker unavailable.");
    }
  }, [publishingIdentityToken]);

  useEffect(() => {
    void Promise.all([loadTelegram(), connectPublishing(), loadServerAutomation()]);
  }, [connectPublishing, loadServerAutomation, loadTelegram]);

  const connectedCount = telegramAccounts.length + (serverAutomation?.accounts.length || 0);
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
                onClick={() => activeService === "messaging" ? void loadTelegram() : void Promise.all([connectPublishing(), loadServerAutomation()])}
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
              initialPlatform={initialPublishingPlatform}
              publishQueueUrl={publishQueueUrl}
              publishingIdentityToken={publishingIdentityToken}
              allowedPlatforms={allowedPublishingPlatforms}
              serverAutomation={serverAutomation}
              serverAutomationError={serverAutomationError}
              managerStatus={publishingManagerStatus}
              accountEmail={user.email}
              onSession={session => {
                setPublishingSession(session);
                void loadPublishing(session);
              }}
              onReloadServer={loadServerAutomation}
              onReconnect={connectPublishing}
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

function serverAccountForConfig(account) {
  const connected = account.status === "CONNECTED";
  return {
    ...account,
    handle: connected ? "Persistent isolated server profile" : "Website login required",
    loginIdentifier: "",
    credentialConfigured: connected,
    executionEngine: "server_worker",
    serverManaged: true
  };
}

function PublishingManager({
  status,
  session,
  initialPlatform,
  publishQueueUrl,
  publishingIdentityToken,
  allowedPlatforms,
  serverAutomation,
  serverAutomationError,
  managerStatus,
  accountEmail,
  onSession,
  onReloadServer,
  onReconnect,
  setNotice
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState(initialPlatform || "instagram");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loginAccountId, setLoginAccountId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [serverLogin, setServerLogin] = useState(null);
  const selectedServerPlatformAvailable = selectedPlatform === "instagram"
    ? Boolean(serverAutomation?.health?.features?.instagramPublishing)
    : selectedPlatform === "facebook"
      ? Boolean(serverAutomation?.health?.features?.facebookPublishing)
      : selectedPlatform === "x"
        ? Boolean(serverAutomation?.health?.features?.xPublishing)
        : selectedPlatform === "linkedin"
          ? Boolean(serverAutomation?.health?.features?.linkedinPublishing)
          : selectedPlatform === "youtube"
            ? Boolean(serverAutomation?.health?.features?.youtubePublishing)
            : false;
  const serverSupportedPlatforms = ["instagram", "facebook", "x", "linkedin", "youtube"];

  const combinedAccounts = useMemo(
    () => (serverAutomation?.accounts || []).map(serverAccountForConfig),
    [serverAutomation]
  );

  const platformAccounts = useMemo(
    () => combinedAccounts.filter(account => account.platform === selectedPlatform),
    [combinedAccounts, selectedPlatform]
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
      if (!serverSupportedPlatforms.includes(selectedPlatform)) throw new Error("Server Worker support for this platform is not available yet.");
      if (!selectedServerPlatformAvailable) throw new Error(platformLabels[selectedPlatform] + " Server Worker is not enabled.");
      const result = form.id
        ? await serverAutomationRequest("/accounts/" + encodeURIComponent(form.id), publishingIdentityToken, {
            method: "PATCH",
            body: JSON.stringify({ displayName: form.displayName.trim(), enabled: form.enabled })
          })
        : await serverAutomationRequest("/accounts", publishingIdentityToken, {
            method: "POST",
            body: JSON.stringify({ platform: selectedPlatform, displayName: form.displayName.trim() })
          });
      const account = result.account;
      setEditing(null);
      await onReloadServer();
      if (!form.id) {
        const loginResult = await serverAutomationRequest("/accounts/" + encodeURIComponent(account.id) + "/login", publishingIdentityToken, {
          method: "POST",
          body: "{}"
        });
        setServerLogin({ session: loginResult.session, accountName: account.displayName });
        setNotice({ tone: "success", message: account.displayName + " was created. Complete " + platformLabels[selectedPlatform] + " login in the private server browser." });
      } else {
        setNotice({ tone: "success", message: account.displayName + " server settings were updated." });
      }
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
      await serverAutomationRequest("/accounts/" + encodeURIComponent(account.id), publishingIdentityToken, { method: "DELETE" });
      await onReloadServer();
      setNotice({ tone: "success", message: account.displayName + " was removed." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const startLogin = async (account) => {
    setLoginAccountId(account.id);
    try {
      const result = await serverAutomationRequest("/accounts/" + encodeURIComponent(account.id) + "/login", publishingIdentityToken, {
        method: "POST",
        body: "{}"
      });
      setServerLogin({ session: result.session, accountName: account.displayName });
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

  if (status === "checking") {
    return <div className="config-loading"><Loader2 className="spin" size={23} />Checking Publish Queue access…</div>;
  }

  if (status === "offline") {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Publishing services are temporarily unavailable"
        copy="The website could not reach the publishing control API. Server Worker account management will return when it reconnects."
        action={
          <div className="config-empty-actions">
            <button className="config-primary" type="button" onClick={() => void onReconnect()}><RefreshCw size={15} />Try again</button>
          </div>
        }
      />
    );
  }

  if (status === "needs-upgrade") {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Publishing access needs to be refreshed"
        copy="The website could not verify this publishing access token. Refresh the page or sign in to AgenticThat again."
        action={
          <div className="config-empty-actions">
            <button className="config-primary" type="button" onClick={() => void onReconnect()}><RefreshCw size={15} />Try again</button>
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
          <small><ShieldCheck size={14} />This password belongs to <strong>{managerUsername}</strong> and protects server account configuration.</small>
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

      <section className={"config-server-worker-bar " + (serverAutomation?.health?.features?.publishing ? "online" : "offline")}>
        <span><Database size={19} /></span>
        <div>
          <strong>Server Worker</strong>
          <small>{serverAutomation?.health?.features?.publishing
            ? serverAutomation.health.livePublishingWorkerCount + " workers online — users do not need Companion."
            : serverAutomationError || "Server Worker is not enabled for this environment."}</small>
        </div>
        <i>{serverAutomation?.health?.features?.publishing ? "ONLINE" : "OFFLINE"}</i>
      </section>

      <div className="config-platform-tabs" role="tablist" aria-label="Publishing platform">
        {allowedPlatforms.map(platform => {
          const count = combinedAccounts.filter(account => account.platform === platform).length;
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
        <div><h3>{platformLabels[selectedPlatform]} accounts</h3><p>{serverSupportedPlatforms.includes(selectedPlatform) ? "Server accounts appear immediately in the publishing dashboard." : "Server Worker support for this platform is planned."}</p></div>
        {!editing && serverSupportedPlatforms.includes(selectedPlatform) && <button className="config-primary" type="button" disabled={!selectedServerPlatformAvailable} onClick={() => setEditing({ platform: selectedPlatform, enabled: true })}><Plus size={16} />Add account</button>}
      </div>

      {editing && (
        <PublishingAccountForm
          platform={selectedPlatform}
          account={editing.id ? editing : null}
          busy={busy}
          serverAvailable={selectedServerPlatformAvailable}
          onCancel={() => setEditing(null)}
          onSave={saveAccount}
        />
      )}

      {!editing && platformAccounts.length === 0 ? (
        <EmptyState
          icon={Plug}
          title={"No " + platformLabels[selectedPlatform] + " accounts"}
          copy={serverSupportedPlatforms.includes(selectedPlatform)
            ? selectedServerPlatformAvailable ? "Add a Server Worker account and complete login entirely through the website." : "Enable this platform's Server Worker before adding an account."
            : "This platform will become available after its server-side login and publishing worker is implemented."}
          action={serverSupportedPlatforms.includes(selectedPlatform) && selectedServerPlatformAvailable ? <button className="config-primary" type="button" onClick={() => setEditing({ platform: selectedPlatform, enabled: true })}><Plus size={16} />Add first account</button> : null}
        />
      ) : !editing && (
        <div className="config-account-list">
          {platformAccounts.map(account => (
            <article className="config-account-row publishing" key={account.id}>
              <span className="config-account-logo"><img src={platformLogos[account.platform]} alt="" /></span>
              <span className="config-account-main"><strong>{account.displayName}</strong><small>{account.handle}</small></span>
              <span className={"config-account-state " + (!account.enabled ? "paused" : account.credentialConfigured ? "" : "attention")}><i />{!account.enabled ? "Paused" : account.credentialConfigured ? "Ready" : "Reconnect required"}</span>
              <span className="config-account-meta config-account-engine"><Database size={14} /><span>Server worker</span></span>
              <div className="config-account-actions">
                <button className="open" type="button" onClick={() => openPublishingAccount(account)} disabled={!account.enabled || !account.credentialConfigured} title={!account.enabled ? "Enable this account before opening it" : !account.credentialConfigured ? "Complete Login before opening this workspace" : "Open publishing workspace"}><ArrowRight size={15} />Open</button>
                <button type="button" onClick={() => setEditing(account)} disabled={busy} title="Edit account details"><Pencil size={15} />Edit</button>
                <button type="button" onClick={() => void startLogin(account)} disabled={!account.enabled || Boolean(loginAccountId)} title={account.credentialConfigured ? "Sign in again and refresh the server session" : "Sign in through the server browser"}>{loginAccountId === account.id ? <Loader2 className="spin" size={15} /> : <KeyRound size={15} />}Login</button>
                <button className="danger" type="button" onClick={() => void removeAccount(account)} disabled={busy} title="Delete account"><Trash2 size={15} />Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {serverLogin && <ConfigServerLoginBrowser
        initialSession={serverLogin.session}
        accountName={serverLogin.accountName}
        publishingIdentityToken={publishingIdentityToken}
        onClose={() => setServerLogin(null)}
        onConnected={() => {
          setServerLogin(null);
          setNotice({ tone: "success", message: platformLabels[serverLogin.session.platform] + " connected to Server Worker and is ready in the publishing composer." });
          void onReloadServer();
        }}
      />}
    </div>
  );
}

function ConfigServerLoginBrowser({ initialSession, accountName, publishingIdentityToken, onClose, onConnected }) {
  const [session, setSession] = useState(initialSession);
  const [frameUrl, setFrameUrl] = useState("");
  const [error, setError] = useState("");
  const [clickFeedback, setClickFeedback] = useState(null);
  const inputQueue = useRef(Promise.resolve());
  const inputBuffer = useRef([]);
  const inputTimer = useRef();
  const clickTimer = useRef();

  useEffect(() => {
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const result = await serverAutomationRequest("/sessions/" + encodeURIComponent(initialSession.id), publishingIdentityToken);
        if (!active) return;
        setSession(result.session);
        if (result.session.state === "CONNECTED") {
          onConnected();
          return;
        }
        if (["FAILED", "CANCELLED", "EXPIRED"].includes(result.session.state)) return;
        timer = window.setTimeout(poll, 750);
      } catch (pollError) {
        if (active) setError(pollError.message || "Login status could not be loaded.");
      }
    };
    void poll();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [initialSession.id, onConnected, publishingIdentityToken]);

  useEffect(() => {
    if (!["STARTING", "AWAITING_USER"].includes(session.state)) return;
    let active = true;
    let timer;
    let objectUrl = "";
    const pollFrame = async () => {
      try {
        const blob = await serverAutomationFrame(initialSession.id, publishingIdentityToken);
        if (!active) return;
        const nextUrl = URL.createObjectURL(blob);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = nextUrl;
        setFrameUrl(nextUrl);
      } catch {
        // The isolated browser can be between frames while starting or closing.
      }
      if (active) timer = window.setTimeout(pollFrame, 250);
    };
    void pollFrame();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [initialSession.id, publishingIdentityToken, session.state]);

  const enqueueInputBatch = useCallback((inputs) => {
    if (!inputs.length) return;
    inputQueue.current = inputQueue.current
      .then(() => serverAutomationRequest("/sessions/" + encodeURIComponent(initialSession.id) + "/input", publishingIdentityToken, {
        method: "POST",
        body: JSON.stringify({ inputs })
      }))
      .catch(inputError => setError(inputError.message || "Browser input could not be forwarded."));
  }, [initialSession.id, publishingIdentityToken]);

  const flushInputBuffer = useCallback(() => {
    if (inputTimer.current) window.clearTimeout(inputTimer.current);
    inputTimer.current = undefined;
    const inputs = inputBuffer.current.splice(0, 32);
    enqueueInputBatch(inputs);
    if (inputBuffer.current.length) inputTimer.current = window.setTimeout(flushInputBuffer, 0);
  }, [enqueueInputBatch]);

  const sendInput = useCallback((input, flushNow = false) => {
    const last = inputBuffer.current.at(-1);
    if (input.type === "text" && last?.type === "text" && last.text.length + input.text.length <= 64) last.text += input.text;
    else inputBuffer.current.push(input);
    if (flushNow || inputBuffer.current.length >= 24) flushInputBuffer();
    else if (!inputTimer.current) inputTimer.current = window.setTimeout(flushInputBuffer, 120);
  }, [flushInputBuffer]);

  useEffect(() => () => {
    if (inputTimer.current) window.clearTimeout(inputTimer.current);
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
  }, []);

  const cancel = async () => {
    await serverAutomationRequest("/sessions/" + encodeURIComponent(initialSession.id), publishingIdentityToken, { method: "DELETE" }).catch(() => undefined);
    onClose();
  };

  return <div className="config-server-login-overlay" role="dialog" aria-modal="true" aria-labelledby="config-server-login-title">
    <section className="config-server-login-panel">
      <header><span><small>Private Server Worker browser</small><strong id="config-server-login-title">Connect {accountName}</strong><em>Type directly in the browser image. AgenticThat forwards input without storing the password.</em></span><button type="button" onClick={() => void cancel()}><X size={17} />Cancel</button></header>
      <div className="config-server-login-state"><Loader2 className={["STARTING", "AWAITING_USER"].includes(session.state) ? "spin" : ""} size={15} />{session.state.replaceAll("_", " ")}</div>
      {frameUrl ? <div className="config-server-login-frame-shell"><img
        className="config-server-login-frame"
        src={frameUrl}
        alt={"Interactive " + platformLabels[session.platform] + " login browser running on Server Worker"}
        tabIndex={0}
        draggable={false}
        onClick={event => {
          const image = event.currentTarget;
          const box = image.getBoundingClientRect();
          const left = ((event.clientX - box.left) / box.width) * 100;
          const top = ((event.clientY - box.top) / box.height) * 100;
          const id = Date.now();
          image.focus();
          setClickFeedback({ id, left, top });
          if (clickTimer.current) window.clearTimeout(clickTimer.current);
          clickTimer.current = window.setTimeout(() => setClickFeedback(current => current?.id === id ? null : current), 550);
          sendInput({ type: "click", x: (left / 100) * image.naturalWidth, y: (top / 100) * image.naturalHeight, button: "left" }, true);
        }}
        onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
          const special = {
            Tab: "Tab", Enter: "Enter", Escape: "Escape", Backspace: "Backspace", Delete: "Delete",
            ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
            Home: "Home", End: "End", " ": "Space"
          };
          if (special[event.key]) {
            event.preventDefault();
            sendInput({ type: "key", key: special[event.key] }, true);
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            sendInput({ type: "text", text: event.key });
          }
        }}
        onPaste={event => {
          event.preventDefault();
          const value = event.clipboardData.getData("text");
          const chunks = Array.from({ length: Math.ceil(value.length / 64) }, (_, index) => value.slice(index * 64, (index + 1) * 64));
          chunks.forEach((text, index) => sendInput({ type: "text", text }, index === chunks.length - 1));
        }}
        onWheel={event => {
          event.preventDefault();
          sendInput({ type: "wheel", deltaX: event.deltaX, deltaY: event.deltaY });
        }}
      />{clickFeedback && <span className="config-server-login-click" style={{ left: clickFeedback.left + "%", top: clickFeedback.top + "%" }} aria-hidden="true" />}</div> : <div className="config-server-login-loading"><Loader2 className="spin" size={24} /><span>Starting the isolated {platformLabels[session.platform]} browser…</span></div>}
      {(session.errorMessage || error) && <p className="config-server-login-error" role="alert">{session.errorMessage || error}</p>}
    </section>
  </div>;
}

function PublishingAccountForm({ platform, account, busy, serverAvailable, onCancel, onSave }) {
  const [displayName, setDisplayName] = useState(account?.displayName || "");
  const [enabled, setEnabled] = useState(account?.enabled ?? true);

  const submit = (event) => {
    event.preventDefault();
    void onSave({
      id: account?.id,
      displayName,
      enabled,
      executionEngine: "server_worker"
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
          <fieldset className="config-engine-field wide">
            <legend>Publishing engine</legend>
            <div className="config-engine-picker" role="group" aria-label="Choose publishing engine">
              <button type="button" disabled className="active" aria-pressed="true"><Database size={18} /><span><strong>Server Worker</strong><small>{serverAvailable ? "Website-only login and publishing; no download required" : "Not available in this environment"}</small></span></button>
            </div>
          </fieldset>
          <label className="config-toggle wide"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span><strong>Enabled for publishing</strong><small>Disabled accounts remain visible but cannot receive new posts.</small></span></label>
        </div>
        <div className="config-form-actions"><button className="config-secondary" type="button" onClick={onCancel}>Cancel</button><button className="config-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}{account ? "Save changes" : "Add account"}</button></div>
      </form>
    </section>
  );
}
