"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Loader2,
  LockKeyhole,
  MessageCircle,
  Plug,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
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
const messagingLabels = {
  telegram: "Telegram",
  whatsapp: "WhatsApp"
};
const messagingLogos = {
  telegram: "/telegram-logo.svg",
  whatsapp: "/whatsapp-logo.svg"
};
const roleLabels = {
  operations_manager: "Operations Manager",
  post_uploader: "Post Uploader",
  scheduler: "Scheduler",
  viewer: "Viewer"
};
const statusLabels = {
  queued: "Queued",
  processing: "Processing",
  posted: "Posted",
  failed: "Failed"
};

const services = [
  {
    id: "messaging",
    name: "Messaging Automation",
    category: "Messaging",
    description: "Connected sender accounts for Telegram and WhatsApp.",
    icon: MessageCircle,
    live: true
  },
  {
    id: "publishing",
    name: "Publish Queue Runner",
    category: "Publishing",
    description: "Social accounts and the content prepared for each destination.",
    icon: Send,
    live: true
  },
  {
    id: "engagement",
    name: "Post Engagement Agent",
    category: "Engagement",
    description: "Reserved space for future engagement account inventory.",
    icon: Zap,
    live: false
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

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function latestDate(values) {
  const timestamps = values
    .map((value) => new Date(value || "").getTime())
    .filter(Number.isFinite);
  if (timestamps.length === 0) return "";
  return new Date(Math.max(...timestamps)).toISOString();
}

function ServiceMark({ service }) {
  const Icon = service.icon;
  return <Icon size={22} />;
}

function InlineNotice({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className={"content-notice " + notice.tone} role="status">
      {notice.tone === "success" ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
      <span>{notice.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss message"><X size={16} /></button>
    </div>
  );
}

function EmptyState({ icon: Icon, title, copy, action }) {
  return (
    <div className="content-empty">
      <span><Icon size={28} /></span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <span className="content-metric">
      <Icon size={17} />
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function StatusPill({ active, children }) {
  return <span className={"content-pill " + (active ? "active" : "muted")}><i />{children}</span>;
}

function AccountField({ label, value }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value || "Not available"}</strong>
    </span>
  );
}

export default function ContentManager({
  initialService,
  initialMessagingPlatform,
  initialPublishingPlatform,
  user,
  telegramDashboardUrl,
  publishQueueUrl
}) {
  const [activeService, setActiveService] = useState(initialService || "messaging");
  const [messagingPlatform, setMessagingPlatform] = useState(initialMessagingPlatform || "telegram");
  const [publishingPlatform, setPublishingPlatform] = useState(initialPublishingPlatform || "instagram");
  const [notice, setNotice] = useState(null);
  const [telegramStatus, setTelegramStatus] = useState("checking");
  const [telegramUser, setTelegramUser] = useState(null);
  const [telegramAccounts, setTelegramAccounts] = useState([]);
  const [publishingStatus, setPublishingStatus] = useState("checking");
  const [publishingSession, setPublishingSession] = useState(null);
  const [publishingAccounts, setPublishingAccounts] = useState([]);
  const [publishingUploads, setPublishingUploads] = useState([]);
  const [publishingSchedules, setPublishingSchedules] = useState([]);
  const [storageConnections, setStorageConnections] = useState([]);

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
      setPublishingUploads([]);
      setPublishingSchedules([]);
      setStorageConnections([]);
      setPublishingStatus("needs-login");
      return;
    }

    setPublishingStatus("checking");
    try {
      const me = await publishingRequest("/api/auth/me", session.token);
      const [accountsResult, uploadsResult, schedulesResult, storageResult] = await Promise.allSettled([
        publishingRequest("/api/accounts", session.token),
        publishingRequest("/api/uploads", session.token),
        publishingRequest("/api/schedules", session.token),
        publishingRequest("/api/storage-connections", session.token)
      ]);

      const nextSession = { token: session.token, user: me };
      setPublishingSession(nextSession);
      setPublishingAccounts(accountsResult.status === "fulfilled" && Array.isArray(accountsResult.value) ? accountsResult.value : []);
      setPublishingUploads(uploadsResult.status === "fulfilled" && Array.isArray(uploadsResult.value) ? uploadsResult.value : []);
      setPublishingSchedules(schedulesResult.status === "fulfilled" && Array.isArray(schedulesResult.value) ? schedulesResult.value : []);
      setStorageConnections(storageResult.status === "fulfilled" && Array.isArray(storageResult.value) ? storageResult.value : []);
      setPublishingStatus("ready");
    } catch (error) {
      if (error.status === 401) {
        window.sessionStorage.removeItem(PUBLISH_SESSION_KEY);
        setPublishingSession(null);
        setPublishingAccounts([]);
        setPublishingUploads([]);
        setPublishingSchedules([]);
        setStorageConnections([]);
        setPublishingStatus("needs-login");
      } else {
        setPublishingStatus("offline");
      }
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadTelegram(), loadPublishing()]);
  }, [loadPublishing, loadTelegram]);

  const connectedAccounts = telegramAccounts.length + publishingAccounts.length;
  const activePublishingAccounts = publishingAccounts.filter((account) => account.enabled).length;
  const queuedUploads = publishingUploads.filter((upload) => upload.status === "queued").length;
  const activeDefinition = services.find((service) => service.id === activeService) || services[0];

  const selectService = (serviceId) => {
    setActiveService(serviceId);
    const url = new URL(window.location.href);
    url.searchParams.set("service", serviceId);
    if (serviceId === "messaging") {
      url.searchParams.set("platform", messagingPlatform);
    } else if (serviceId === "publishing") {
      url.searchParams.set("platform", publishingPlatform);
    } else {
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

  const selectPublishingPlatform = (platform) => {
    setPublishingPlatform(platform);
    const url = new URL(window.location.href);
    url.searchParams.set("service", "publishing");
    url.searchParams.set("platform", platform);
    window.history.replaceState({}, "", url);
  };

  const refreshActive = () => {
    if (activeService === "messaging" && messagingPlatform === "telegram") return loadTelegram();
    if (activeService === "publishing") return loadPublishing(publishingSession);
    return Promise.resolve();
  };

  return (
    <main className="content-shell">
      <header className="content-topbar">
        <a className="content-brand" href="/">
          <span>AT</span>
          <strong>AgenticThat</strong>
          <small>Content Manager</small>
        </a>
        <div className="content-workspace">
          <span>{String(user.businessName || user.name || "W").charAt(0).toUpperCase()}</span>
          <div><strong>{user.businessName || user.name}</strong><small>{user.email}</small></div>
        </div>
        <div className="content-top-actions">
          <a className="content-secondary" href="/config-manager"><Settings2 size={15} />Config Manager</a>
          <a className="content-back" href="/"><ArrowLeft size={16} />Back to services</a>
        </div>
      </header>

      <section className="content-overview">
        <div>
          <p><Database size={15} />Service account inventory</p>
          <h1>Content routing, accounts, and app visibility in one place.</h1>
          <span>Accounts are still added in Config Manager. This page shows where each connected account is available and what content is already attached to it.</span>
        </div>
        <div className="content-overview-metrics">
          <Metric icon={UsersRound} label="connected accounts" value={connectedAccounts} />
          <Metric icon={ShieldCheck} label="active publishing" value={activePublishingAccounts} />
          <Metric icon={FileText} label="queued posts" value={queuedUploads} />
        </div>
      </section>

      <div className="content-layout">
        <aside className="content-service-nav">
          <div className="content-nav-heading"><span>Services</span><small>Grouped by app</small></div>
          {services.map((service) => {
            const count = service.id === "messaging"
              ? telegramAccounts.length
              : service.id === "publishing"
                ? publishingAccounts.length
                : 0;
            return (
              <button
                key={service.id}
                className={activeService === service.id ? "active" : ""}
                type="button"
                onClick={() => selectService(service.id)}
              >
                <span className="content-service-mark"><ServiceMark service={service} /></span>
                <span><strong>{service.name}</strong><small>{service.category}</small></span>
                <i className={service.live ? "live" : "soon"}>{service.live ? count : "Soon"}</i>
              </button>
            );
          })}
          <div className="content-side-note">
            <CheckCircle2 size={18} />
            <span><strong>Read-only view</strong><small>Account creation and deletion stay in Config Manager.</small></span>
          </div>
        </aside>

        <section className="content-panel">
          <header className="content-panel-head">
            <div className="content-service-title">
              <span className="content-service-mark large"><ServiceMark service={activeDefinition} /></span>
              <div><p>{activeDefinition.category}</p><h2>{activeDefinition.name}</h2><span>{activeDefinition.description}</span></div>
            </div>
            {(activeService === "publishing" || (activeService === "messaging" && messagingPlatform === "telegram")) && (
              <button className="content-refresh" type="button" onClick={() => void refreshActive()}>
                <RefreshCw size={16} />Refresh
              </button>
            )}
          </header>

          <InlineNotice notice={notice} onClose={() => setNotice(null)} />

          {activeService === "messaging" && (
            <MessagingContent
              platform={messagingPlatform}
              onPlatformChange={selectMessagingPlatform}
              status={telegramStatus}
              user={telegramUser}
              accounts={telegramAccounts}
              dashboardUrl={telegramDashboardUrl}
              onReload={loadTelegram}
            />
          )}
          {activeService === "publishing" && (
            <PublishingContent
              status={publishingStatus}
              session={publishingSession}
              accounts={publishingAccounts}
              uploads={publishingUploads}
              schedules={publishingSchedules}
              storageConnections={storageConnections}
              platform={publishingPlatform}
              publishQueueUrl={publishQueueUrl}
              onPlatformChange={selectPublishingPlatform}
              onSession={(session) => {
                if (!session) {
                  window.sessionStorage.removeItem(PUBLISH_SESSION_KEY);
                  void loadPublishing(null);
                  return;
                }
                window.sessionStorage.setItem(PUBLISH_SESSION_KEY, JSON.stringify(session));
                setPublishingSession(session);
                void loadPublishing(session);
              }}
              setNotice={setNotice}
            />
          )}
          {activeService === "engagement" && (
            <PlaceholderPanel
              icon={Zap}
              title="Post Engagement Agent account inventory is planned"
              copy="When engagement accounts are enabled, monitored apps and connected profiles will appear here using the same service and app grouping."
              link="/config-manager?service=engagement"
            />
          )}
        </section>
      </div>
    </main>
  );
}

function MessagingContent({ platform, onPlatformChange, status, user, accounts, dashboardUrl, onReload }) {
  return (
    <>
      <div className="content-app-tabs messaging-tabs" role="tablist" aria-label="Messaging apps">
        {messagingPlatforms.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={platform === item}
            className={platform === item ? "active" : ""}
            key={item}
            onClick={() => onPlatformChange(item)}
          >
            <img src={messagingLogos[item]} alt="" />
            <span>{messagingLabels[item]}</span>
            <i className={item === "whatsapp" ? "soon" : ""}>{item === "telegram" ? accounts.length : "Soon"}</i>
          </button>
        ))}
      </div>

      {platform === "telegram" ? (
        <TelegramAccounts status={status} user={user} accounts={accounts} dashboardUrl={dashboardUrl} onReload={onReload} />
      ) : (
        <PlaceholderPanel
          icon={MessageCircle}
          title="WhatsApp account data will appear here"
          copy="The WhatsApp app is reserved as a placeholder for now. Once account adding is enabled in Config Manager, connected WhatsApp senders will be shown in this section."
          link="/config-manager?service=messaging&platform=whatsapp"
        />
      )}
    </>
  );
}

function TelegramAccounts({ status, user, accounts, dashboardUrl, onReload }) {
  if (status === "checking") {
    return <div className="content-loading"><Loader2 className="spin" size={22} />Loading Telegram accounts...</div>;
  }

  if (status === "offline") {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Telegram service is unavailable"
        copy="Start the Telegram service, then refresh Content Manager to load account data."
        action={<button className="content-primary" type="button" onClick={() => void onReload()}><RefreshCw size={16} />Try again</button>}
      />
    );
  }

  if (status === "needs-login") {
    return (
      <EmptyState
        icon={LockKeyhole}
        title="Sign in to the Telegram workspace"
        copy="Content Manager uses the same Telegram workspace session as Config Manager before it can display connected Telegram accounts."
        action={
          <div className="content-empty-actions">
            <a className="content-primary" href={dashboardUrl} target="_blank" rel="noreferrer">Open Telegram sign in<ExternalLink size={15} /></a>
            <button className="content-secondary" type="button" onClick={() => void onReload()}><RefreshCw size={15} />I signed in</button>
          </div>
        }
      />
    );
  }

  return (
    <div className="content-section-body">
      <div className="content-connection-bar">
        <div><CheckCircle2 size={18} /><span><strong>Telegram workspace connected</strong><small>Signed in as {user?.displayName || "Telegram user"}</small></span></div>
        <div className="content-bar-actions">
          <a className="content-secondary" href="/config-manager?service=messaging&platform=telegram"><Settings2 size={14} />Manage accounts</a>
          <a className="content-secondary" href={dashboardUrl} target="_blank" rel="noreferrer">Open Telegram<ExternalLink size={14} /></a>
        </div>
      </div>

      <CollectionHeader
        title="Telegram sender accounts"
        copy="Accounts added in Config Manager are available in Telegram selectors and outbound workflows."
        count={accounts.length}
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No Telegram accounts connected"
          copy="Connect the first Telegram account in Config Manager and it will appear here immediately."
          action={<a className="content-primary" href="/config-manager?service=messaging&platform=telegram"><Settings2 size={15} />Open Config Manager</a>}
        />
      ) : (
        <div className="content-account-grid">
          {accounts.map((account) => (
            <article className="content-account-card" key={account.id}>
              <header>
                <span><img src="/telegram-logo.svg" alt="" /></span>
                <div><h3>{account.displayName || "Telegram account"}</h3><p>{account.username ? "@" + account.username : "Telegram user " + account.telegramUserId}</p></div>
                <StatusPill active>Connected</StatusPill>
              </header>
              <div className="content-account-fields">
                <AccountField label="Telegram user ID" value={account.telegramUserId} />
                <AccountField label="Added" value={formatDate(account.createdAt)} />
                <AccountField label="Last updated" value={formatDate(account.updatedAt)} />
                <AccountField label="Available in" value="Telegram console" />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function PublishingContent({
  status,
  session,
  accounts,
  uploads,
  schedules,
  storageConnections,
  platform,
  publishQueueUrl,
  onPlatformChange,
  onSession,
  setNotice
}) {
  const [username, setUsername] = useState("operations.manager");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const platformAccounts = useMemo(
    () => accounts.filter((account) => account.platform === platform),
    [accounts, platform]
  );

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await publishingRequest("/api/auth/login", "", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password })
      });
      const nextSession = { token: response.token, user: response.user };
      setPassword("");
      onSession(nextSession);
      setNotice({ tone: "success", message: "Publish Queue content data is ready." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  if (status === "checking") {
    return <div className="content-loading"><Loader2 className="spin" size={22} />Loading Publish Queue content...</div>;
  }

  if (status === "offline") {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Publish Queue service is unavailable"
        copy="The publishing API did not respond. Use Refresh above; if the problem remains, check the Netlify function deployment or external runner URL."
        action={<a className="content-primary" href={publishQueueUrl} target="_blank" rel="noreferrer">Open runner<ExternalLink size={15} /></a>}
      />
    );
  }

  if (status === "needs-login") {
    return (
      <div className="content-auth-card">
        <div className="content-auth-copy">
          <span><LockKeyhole size={25} /></span>
          <p>Protected content data</p>
          <h3>Publish Queue sign in required</h3>
          <div>Use a Publish Queue workspace role to display connected social accounts, queued posts, schedules, and storage links.</div>
          <small><ShieldCheck size={14} />Use <strong>operations.manager</strong> with the publishing password assigned to this workspace.</small>
        </div>
        <form onSubmit={signIn}>
          <label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
          <label>
            <span>Password</span>
            <div className="content-secret-input">
              <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
          </label>
          <button className="content-primary full" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}Continue</button>
        </form>
      </div>
    );
  }

  const queuedCount = uploads.filter((upload) => upload.status === "queued").length;
  const postedCount = uploads.filter((upload) => upload.status === "posted").length;
  const scheduledCount = uploads.filter((upload) => upload.scheduledAt || upload.scheduleId).length;

  return (
    <div className="content-section-body">
      <div className="content-connection-bar">
        <div><CheckCircle2 size={18} /><span><strong>Publish Queue connected</strong><small>{session?.user?.fullName || "Workspace user"} - {roleLabels[session?.user?.role] || "Workspace role"}</small></span></div>
        <div className="content-bar-actions">
          <a className="content-secondary" href="/config-manager?service=publishing"><Settings2 size={14} />Manage accounts</a>
          <a className="content-secondary" href={publishQueueUrl} target="_blank" rel="noreferrer">Open runner<ExternalLink size={14} /></a>
          <button className="content-tertiary" type="button" onClick={() => onSession(null)}>Change login</button>
        </div>
      </div>

      <div className="content-status-grid">
        <Metric icon={UsersRound} label="publishing accounts" value={accounts.length} />
        <Metric icon={FileText} label="total posts" value={uploads.length} />
        <Metric icon={Clock3} label="scheduled posts" value={scheduledCount} />
        <Metric icon={CheckCircle2} label="posted" value={postedCount} />
        <Metric icon={Plug} label="storage links" value={storageConnections.length} />
        <Metric icon={Database} label="schedule templates" value={schedules.length} />
      </div>

      <div className="content-app-tabs" role="tablist" aria-label="Publishing apps">
        {publishPlatforms.map((item) => {
          const count = accounts.filter((account) => account.platform === item).length;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={platform === item}
              className={platform === item ? "active" : ""}
              key={item}
              onClick={() => onPlatformChange(item)}
            >
              <img src={platformLogos[item]} alt="" />
              <span>{platformLabels[item]}</span>
              <i>{count}</i>
            </button>
          );
        })}
      </div>

      <CollectionHeader
        title={platformLabels[platform] + " accounts"}
        copy="Each account card shows routing, content counts, storage links, and latest activity for this app."
        count={platformAccounts.length}
        meta={queuedCount + " queued across all publishing apps"}
      />

      {platformAccounts.length === 0 ? (
        <EmptyState
          icon={Plug}
          title={"No " + platformLabels[platform] + " accounts connected"}
          copy="Add accounts in Config Manager. They will appear here grouped under their publishing app."
          action={<a className="content-primary" href={"/config-manager?service=publishing&platform=" + platform}><Settings2 size={15} />Open Config Manager</a>}
        />
      ) : (
        <div className="content-account-grid">
          {platformAccounts.map((account) => (
            <PublishingAccountCard
              key={account.id}
              account={account}
              uploads={uploads.filter((upload) => upload.accountId === account.id)}
              storageConnections={storageConnections.filter((connection) => connection.accountId === account.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PublishingAccountCard({ account, uploads, storageConnections }) {
  const counts = uploads.reduce((result, upload) => {
    result[upload.status] = (result[upload.status] || 0) + 1;
    return result;
  }, {});
  const latestActivity = latestDate([
    account.updatedAt,
    ...uploads.map((upload) => upload.updatedAt || upload.uploadedAt),
    ...storageConnections.map((connection) => connection.updatedAt || connection.lastSyncedAt)
  ]);

  return (
    <article className="content-account-card publishing">
      <header>
        <span><img src={platformLogos[account.platform]} alt="" /></span>
        <div><h3>{account.displayName}</h3><p>{account.handle}</p></div>
        <StatusPill active={account.enabled && account.credentialConfigured}>{!account.enabled ? "Paused" : account.credentialConfigured ? "Ready" : "Login required"}</StatusPill>
      </header>
      <div className="content-post-counts">
        {Object.keys(statusLabels).map((status) => (
          <span key={status} className={status}>
            <strong>{counts[status] || 0}</strong>
            <small>{statusLabels[status]}</small>
          </span>
        ))}
      </div>
      <div className="content-account-fields">
        <AccountField label="Login identity" value={account.loginIdentifier} />
        <AccountField label="Publishing login" value={account.credentialConfigured ? "Saved session ready" : "Open Login in Config Manager"} />
        <AccountField label="Storage links" value={String(storageConnections.length)} />
        <AccountField label="Latest activity" value={formatDate(latestActivity)} />
        <AccountField label="Added" value={formatDate(account.createdAt)} />
      </div>
    </article>
  );
}

function CollectionHeader({ title, copy, count, meta }) {
  return (
    <div className="content-collection-head">
      <div><h3>{title}</h3><p>{copy}</p></div>
      <span>{count} {count === 1 ? "account" : "accounts"}{meta ? " - " + meta : ""}</span>
    </div>
  );
}

function PlaceholderPanel({ icon: Icon, title, copy, link }) {
  return (
    <div className="content-placeholder">
      <span><Icon size={34} /></span>
      <p>Placeholder</p>
      <h3>{title}</h3>
      <div>{copy}</div>
      <a href={link}><Settings2 size={15} />Open Config Manager</a>
    </div>
  );
}
