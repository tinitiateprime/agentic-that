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
  Trash2,
  UsersRound,
  X,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { publishingFetch } from "../../lib/publishing-endpoint";

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

async function telegramRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
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
  if (token) headers.set("authorization", "Bearer " + token);
  const response = await publishingFetch(path, {
    ...init,
    headers
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

export default function ConfigManager({
  initialService,
  initialMessagingPlatform,
  initialPublishingPlatform,
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
  const [publishingSession, setPublishingSession] = useState(null);
  const [publishingAccounts, setPublishingAccounts] = useState([]);

  const loadTelegram = useCallback(async () => {
    setTelegramStatus("checking");
    try {
      const me = await telegramRequest("/me");
      const accountData = await telegramRequest("/telegram/accounts");
      setTelegramUser(me.user);
      setTelegramAccounts(accountData.accounts || []);
      setTelegramStatus("ready");
    } catch (error) {
      setTelegramUser(null);
      setTelegramAccounts([]);
      setTelegramStatus(error.status === 401 ? "needs-login" : "offline");
    }
  }, []);

  const loadPublishing = useCallback(async (candidateSession) => {
    const session = candidateSession ?? readPublishingSession();
    if (!session) {
      setPublishingSession(null);
      setPublishingAccounts([]);
      setPublishingStatus("needs-login");
      return;
    }
    setPublishingStatus("checking");
    try {
      const me = await publishingRequest("/api/auth/me", session.token);
      const accounts = await publishingRequest("/api/accounts", session.token);
      const current = { token: session.token, user: me };
      setPublishingSession(current);
      setPublishingAccounts(Array.isArray(accounts) ? accounts : []);
      setPublishingStatus(me.role === "operations_manager" ? "ready" : "needs-manager");
    } catch (error) {
      if (error.status === 401) {
        window.sessionStorage.removeItem(PUBLISH_SESSION_KEY);
        setPublishingSession(null);
        setPublishingAccounts([]);
        setPublishingStatus("needs-login");
      } else {
        setPublishingStatus("offline");
      }
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadTelegram(), loadPublishing()]);
  }, [loadPublishing, loadTelegram]);

  const connectedCount = telegramAccounts.length + publishingAccounts.length;
  const activeDefinition = services.find(service => service.id === activeService) || services[0];

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
    <main className="config-shell">
      <header className="config-topbar">
        <a className="config-brand" href="/">
          <span>AT</span>
          <strong>AgenticThat</strong>
          <small>Config Manager</small>
        </a>
        <div className="config-workspace">
          <span>{String(user.businessName || user.name || "W").charAt(0).toUpperCase()}</span>
          <div><strong>{user.businessName || user.name}</strong><small>{user.email}</small></div>
        </div>
        <div className="config-top-actions">
          <a className="config-secondary" href="/content-manager"><Database size={15} />Content Manager</a>
          <a className="config-back" href="/"><ArrowLeft size={16} />Back to services</a>
        </div>
      </header>

      <section className="config-hero">
        <div>
          <p className="config-kicker"><Settings2 size={15} />Central service configuration</p>
          <h1>Connect once. Use the account everywhere it belongs.</h1>
          <p>Accounts are configured here and automatically appear inside their respective services for selection and automation.</p>
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
          {services.map(service => (
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
                onClick={() => activeService === "messaging" ? void loadTelegram() : void loadPublishing()}
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
              accounts={telegramAccounts}
              dashboardUrl={telegramDashboardUrl}
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
              onSession={session => {
                setPublishingSession(session);
                void loadPublishing(session);
              }}
              onReload={() => loadPublishing(publishingSession)}
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
  );
}

function MessagingManager({
  platform,
  onPlatformChange,
  status,
  user,
  accounts,
  dashboardUrl,
  onReload,
  setNotice
}) {
  return (
    <>
      <div className="config-platform-tabs messaging-tabs" role="tablist" aria-label="Messaging platform">
        {messagingPlatforms.map(item => (
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
            <i className={item === "whatsapp" ? "planned" : ""}>{item === "telegram" ? accounts.length : "Soon"}</i>
          </button>
        ))}
      </div>

      {platform === "telegram" ? (
        <TelegramManager
          status={status}
          user={user}
          accounts={accounts}
          dashboardUrl={dashboardUrl}
          onReload={onReload}
          setNotice={setNotice}
        />
      ) : (
        <PlaceholderService
          icon={MessageCircle}
          title="WhatsApp configuration is reserved"
          copy="WhatsApp Business numbers, provider credentials, templates, and sender selection will be configured from this shared messaging area when the connector is enabled."
        />
      )}
    </>
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

function TelegramManager({ status, user, accounts, dashboardUrl, onReload, setNotice }) {
  const [connecting, setConnecting] = useState(false);
  const [stage, setStage] = useState("credentials");
  const [challengeId, setChallengeId] = useState("");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHash, setShowHash] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const resetConnection = () => {
    setConnecting(false);
    setStage("credentials");
    setChallengeId("");
    setApiId("");
    setApiHash("");
    setPhone("");
    setCode("");
    setPassword("");
  };

  const startConnection = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await telegramRequest("/telegram/login/start", {
        method: "POST",
        body: JSON.stringify({ telegramApiId: apiId.trim(), telegramApiHash: apiHash.trim(), phone: phone.trim() })
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
      const data = await telegramRequest("/telegram/login/" + encodeURIComponent(challengeId) + "/code", {
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
      const data = await telegramRequest("/telegram/login/" + encodeURIComponent(challengeId) + "/password", {
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
      await telegramRequest("/telegram/accounts/" + encodeURIComponent(account.id), { method: "DELETE" });
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
      <EmptyState
        icon={LockKeyhole}
        title="Sign in to the Telegram workspace once"
        copy="Config Manager uses the Telegram workspace session to connect accounts securely. Sign in there, return to this tab, and recheck."
        action={
          <div className="config-empty-actions">
            <a className="config-primary" href={dashboardUrl} target="_blank" rel="noreferrer">Open Telegram sign in<ExternalLink size={15} /></a>
            <button className="config-secondary" type="button" onClick={() => void onReload()}><RefreshCw size={15} />I signed in</button>
          </div>
        }
      />
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
            <div><p>New Telegram connection</p><h3>{stage === "credentials" ? "API credentials and phone" : stage === "code" ? "Verification code" : "Two-factor password"}</h3></div>
            <button type="button" onClick={resetConnection} aria-label="Close form"><X size={18} /></button>
          </header>

          {stage === "credentials" && (
            <form onSubmit={startConnection}>
              <div className="config-form-grid">
                <label><span>Telegram API ID</span><input value={apiId} onChange={event => setApiId(event.target.value)} inputMode="numeric" placeholder="12345678" required /></label>
                <label><span>Telegram API hash</span><div className="config-secret-input"><input type={showHash ? "text" : "password"} value={apiHash} onChange={event => setApiHash(event.target.value)} placeholder="32-character API hash" required /><button type="button" onClick={() => setShowHash(value => !value)}>{showHash ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
                <label className="wide"><span>Phone number with country code</span><input value={phone} onChange={event => setPhone(event.target.value)} type="tel" autoComplete="tel" placeholder="+91 98765 43210" required /></label>
              </div>
              <p className="config-form-help">Create API credentials at my.telegram.org. Telegram will send a one-time verification code to this account.</p>
              <div className="config-form-actions"><button className="config-secondary" type="button" onClick={resetConnection}>Cancel</button><button className="config-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}Send verification code</button></div>
            </form>
          )}

          {stage === "code" && (
            <form onSubmit={submitCode}>
              <label className="config-code-field"><span>Verification code</span><input value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="12345" autoFocus required /></label>
              <p className="config-form-help">Enter the newest code sent by Telegram. It is used once and is not saved.</p>
              <div className="config-form-actions"><button className="config-secondary" type="button" onClick={() => setStage("credentials")}>Start over</button><button className="config-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Verify account</button></div>
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
          copy="Use Connect Telegram account above to add the first account."
        />
      ) : (
        <div className="config-account-list">
          {accounts.map(account => (
            <article className="config-account-row" key={account.id}>
              <span className="config-account-logo"><img src="/telegram-logo.svg" alt="" /></span>
              <span className="config-account-main"><strong>{account.displayName || "Telegram account"}</strong><small>{account.username ? "@" + account.username : "Telegram user " + account.telegramUserId}</small></span>
              <span className="config-account-state"><i />Connected</span>
              <span className="config-account-meta">Available in Telegram</span>
              <button className="config-icon-danger" type="button" onClick={() => void removeAccount(account)} disabled={busy} aria-label={"Disconnect " + account.displayName}><Trash2 size={16} /></button>
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
  onSession,
  onReload,
  setNotice
}) {
  const [username, setUsername] = useState("operations.manager");
  const [password, setPassword] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState(initialPlatform || "instagram");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loginAccountId, setLoginAccountId] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const platformAccounts = useMemo(
    () => accounts.filter(account => account.platform === selectedPlatform),
    [accounts, selectedPlatform]
  );

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await publishingRequest("/api/auth/login", "", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password })
      });
      if (response.user.role !== "operations_manager") {
        throw new Error("Use an Operations Manager account to configure publishing accounts.");
      }
      const nextSession = { token: response.token, user: response.user };
      window.sessionStorage.setItem(PUBLISH_SESSION_KEY, JSON.stringify(nextSession));
      setPassword("");
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
        enabled: form.enabled
      });
      const account = form.id
        ? await publishingRequest("/api/accounts/" + encodeURIComponent(form.id), session.token, { method: "PATCH", body })
        : await publishingRequest("/api/platforms/" + selectedPlatform + "/accounts", session.token, { method: "POST", body });
      setEditing(null);
      setNotice({ tone: "success", message: account.displayName + " is now available throughout Publish Queue Runner." });
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

  const startLogin = async (account) => {
    setLoginAccountId(account.id);
    try {
      const result = await publishingRequest("/api/accounts/" + encodeURIComponent(account.id) + "/manual-login", session.token, { method: "POST" });
      setNotice({ tone: "success", message: result.message });
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setLoginAccountId("");
    }
  };

  if (status === "checking") {
    return <div className="config-loading"><Loader2 className="spin" size={23} />Checking Publish Queue access…</div>;
  }

  if (status === "offline") {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Publish Queue service is unavailable"
        copy="The publishing companion did not respond. Confirm the Chrome extension is installed and Start Publishing Companion.cmd is running."
        action={<button className="config-primary" type="button" onClick={() => void onReload()}><RefreshCw size={16} />Try again</button>}
      />
    );
  }

  if (status === "needs-login" || status === "needs-manager") {
    return (
      <div className="config-auth-card">
        <div className="config-auth-copy">
          <span><LockKeyhole size={25} /></span>
          <p>Protected configuration</p>
          <h3>Operations Manager access required</h3>
          <div>Sign in here once. The same secure session opens Publish Queue Runner, while account configuration remains in Config Manager.</div>
          <small><ShieldCheck size={14} />Use <strong>operations.manager</strong> with the publishing password assigned to this workspace.</small>
          {status === "needs-manager" && <small><CircleAlert size={14} />The current Publish Queue role cannot manage accounts.</small>}
        </div>
        <form onSubmit={signIn}>
          <label><span>Username</span><input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required /></label>
          <label><span>Password</span><div className="config-secret-input"><input type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
          <button className="config-primary full" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}Continue to accounts</button>
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

      <div className="config-platform-tabs" role="tablist" aria-label="Publishing platform">
        {publishPlatforms.map(platform => {
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
        <div><h3>{platformLabels[selectedPlatform]} accounts</h3><p>Accounts added here appear immediately in composers, schedules, and channel views.</p></div>
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
          copy="Add the first account here. Publish Queue Runner will automatically display it as a selectable destination."
          action={<button className="config-primary" type="button" onClick={() => setEditing({ platform: selectedPlatform, enabled: true })}><Plus size={16} />Add first account</button>}
        />
      ) : !editing && (
        <div className="config-account-list">
          {platformAccounts.map(account => (
            <article className="config-account-row publishing" key={account.id}>
              <span className="config-account-logo"><img src={platformLogos[account.platform]} alt="" /></span>
              <span className="config-account-main"><strong>{account.displayName}</strong><small>{account.handle}</small></span>
              <span className={"config-account-state " + (!account.enabled ? "paused" : account.credentialConfigured ? "" : "attention")}><i />{!account.enabled ? "Paused" : account.credentialConfigured ? "Login ready" : "Login required"}</span>
              <span className="config-account-meta">{account.loginIdentifier || "Manual Chrome login"}</span>
              <div className="config-account-actions">
                <button type="button" onClick={() => setEditing(account)} disabled={busy} title="Edit account"><Pencil size={15} /></button>
                <button type="button" onClick={() => void startLogin(account)} disabled={!account.enabled || Boolean(loginAccountId)} title={account.credentialConfigured ? "Refresh saved account login" : "Connect account login"}>{loginAccountId === account.id ? <Loader2 className="spin" size={15} /> : <KeyRound size={15} />}</button>
                <button className="danger" type="button" onClick={() => void removeAccount(account)} disabled={busy} title="Delete account"><Trash2 size={15} /></button>
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

  const submit = (event) => {
    event.preventDefault();
    void onSave({
      id: account?.id,
      displayName,
      handle,
      loginIdentifier,
      enabled
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
          <label><span>Login hint (optional)</span><input value={loginIdentifier} onChange={event => setLoginIdentifier(event.target.value)} placeholder="Only a label; enter login in Chrome" /></label>
          <label className="config-toggle wide"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span><strong>Enabled for publishing</strong><small>Disabled accounts remain visible but cannot receive new posts.</small></span></label>
        </div>
        <div className="config-form-actions"><button className="config-secondary" type="button" onClick={onCancel}>Cancel</button><button className="config-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}{account ? "Save changes" : "Add account"}</button></div>
      </form>
    </section>
  );
}
