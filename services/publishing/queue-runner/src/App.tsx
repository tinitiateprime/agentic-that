"use client";

import {
  Loader2, RefreshCw, Upload, X,
  CalendarClock, Database, FileText, Pencil, Trash2,
  ArrowRight, BriefcaseBusiness, KeyRound, LockKeyhole, LogOut, ShieldCheck, UsersRound,
  CalendarDays, ChevronLeft, ChevronRight, CircleAlert, CircleCheckBig,
  CircleDashed, FolderOpen, LayoutDashboard, ListFilter, Send, TimerReset,
  Bookmark, Check, Clock3, Download, ExternalLink, Eye, Heart, Image as ImageIcon, MessageCircle, MonitorCheck, MoreHorizontal,
  Puzzle, Repeat2, Settings2, Share2, SlidersHorizontal, ThumbsUp, Video
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FaFacebook, FaInstagram, FaLinkedin, FaXTwitter, FaYoutube } from "react-icons/fa6";
import type { ActivityLog, ContentSubmission, Platform, PlatformAccount, PlatformUpload, PostFormat, PublishingSchedule, ScheduleFrequency, ScheduleStatus, UnifiedPostDestinationInput, UserProfile, UserRole } from "../shared/schema.ts";
import { platformLabels, platformPostRules, platforms, publishingEngineLabels, scheduleFrequencies, scheduleFrequencyLabels, userRoleLabels, userRoles } from "../shared/schema.ts";
import {
  api,
  ContentPreflightApiError,
  PublishingSafetyApiError,
  setAuthToken,
  setCentralAuthToken,
  type AuthResponse,
  type ServerAutomationAccount,
  type ServerAutomationLoginSession,
  type ServerAutomationOverview,
} from "./lib/api.ts";
import { detectPublishingExtension } from "../../../../lib/publishing-extension-bridge.ts";

// --- PLATFORM BRAND ICONS ---
const CustomIcon = ({ platform, size = 28 }: { platform: Platform; size?: number }) => {
  const iconProps = { size, style: { display: 'block' } };
  switch(platform) {
    case 'youtube': return <FaYoutube {...iconProps} color="#FF0000" />;
    case 'x': return <FaXTwitter {...iconProps} color="#000000" />;
    case 'instagram': return <FaInstagram {...iconProps} color="#E4405F" />;
    case 'linkedin': return <FaLinkedin {...iconProps} color="#0A66C2" />;
    case 'facebook': return <FaFacebook {...iconProps} color="#1877F2" />;
    default: return null;
  }
};

function StatusStateIcon({ state, size = 18 }: { state: string; size?: number }) {
  if (state === 'scheduled') return <CalendarClock size={size} />;
  if (state === 'queued') return <TimerReset size={size} />;
  if (state === 'processing') return <Send size={size} />;
  if (state === 'posted') return <CircleCheckBig size={size} />;
  return <CircleAlert size={size} />;
}

function accountHealthStatus(account: PlatformAccount): 'healthy' | 'warning' | 'paused' | 'restricted' {
  if (!account.enabled) return account.safetyStatus === 'restricted' ? 'restricted' : 'paused';
  return account.safetyStatus ?? 'healthy';
}

function accountConnectionLabel(account: PlatformAccount) {
  if (!account.enabled) return 'Paused';
  if (account.executionEngine === 'server_worker') {
    return account.readiness === 'ready' && account.credentialConfigured ? 'Ready' : 'Reconnect Required';
  }
  if (account.readiness === 'reconnect_required' || account.sessionStatus === 'reconnect_required' || !account.credentialConfigured) return 'Reconnect Required';
  if (account.readiness === 'waiting_for_companion' || account.companionStatus === 'offline') return 'Waiting for Companion';
  return 'Ready';
}

function accountPublishingEngine(account: PlatformAccount) {
  return account.executionEngine ?? 'companion';
}

function serverAccountForComposer(account: ServerAutomationAccount): PlatformAccount {
  const connected = account.status === 'CONNECTED';
  return {
    id: account.id,
    workspaceId: account.workspaceId,
    platform: account.platform,
    displayName: account.displayName,
    handle: connected ? 'Persistent server session' : 'Login required',
    loginIdentifier: '',
    credentialConfigured: connected,
    enabled: account.enabled && connected,
    sessionStatus: connected ? 'connected' : 'reconnect_required',
    readiness: connected ? 'ready' : 'reconnect_required',
    executionEngine: 'server_worker',
    safetyStatus: connected ? 'healthy' : 'restricted',
    safetyMode: 'protected',
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

const accountHealthLabels = {
  healthy: 'Green',
  warning: 'Warning',
  paused: 'Paused',
  restricted: 'Restricted',
} as const;

const platformColor: Record<Platform, string> = {
  youtube: '#FF0000',
  x: '#000000',
  instagram: '#E1306C',
  linkedin: '#0A66C2',
  facebook: '#1877F2'
};

const DONUT_CIRCUMFERENCE = 263.89;

function toLocalDateTimeInputValue(date: Date) {
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

type AuthSession = {
  token: string;
  user: UserProfile;
};

type PlatformAccessStatus = {
  state: 'checking' | 'ready' | 'error';
  configured: boolean;
  username: string;
  workspaceId: string;
  message?: string;
  upgradeRequired?: boolean;
  connectionHelpRequired?: boolean;
};

type RolePermissions = {
  canManageUsers: boolean;
  canViewActivity: boolean;
  canManageAccounts: boolean;
  canEditContent: boolean;
  canSchedulePosts: boolean;
  canRunAutomation: boolean;
};

type AutomationNotice = {
  variant: 'success' | 'error';
  title: string;
  message: string;
};

const AUTH_SESSION_KEY = 'agenticthat-publish-queue-session';
const companionDownloadUrl = process.env.NEXT_PUBLIC_PUBLISHING_COMPANION_DOWNLOAD_URL?.trim()
  || 'https://github.com/tinitiateprime/agentic-that/releases/latest/download/AgenticThat-Companion-Portable.zip';
const configuredExtensionInstallUrl = process.env.NEXT_PUBLIC_PUBLISHING_EXTENSION_URL?.trim() || '';
const extensionInstallUrl = configuredExtensionInstallUrl
  || 'https://github.com/tinitiateprime/agentic-that/releases/latest/download/AgenticThat-Companion-Extension.zip';
const localCompanionHealthUrl = 'http://127.0.0.1:8792/api/health';

const loginRoleOptions: Array<{ role: UserRole; username: string; description: string }> = [
  { role: 'operations_manager', username: 'operations.manager', description: 'Full workspace, users, audit, and automation access' },
  { role: 'post_uploader', username: 'content.uploader', description: 'Upload finished content and hand it to scheduling' },
  { role: 'scheduler', username: 'post.scheduler', description: 'Review selected destinations and assign publish times' },
  { role: 'viewer', username: 'workspace.viewer', description: 'Read-only access with no publishing actions' },
];

const roleInitials: Record<UserRole, string> = {
  operations_manager: 'OM',
  post_uploader: 'UP',
  scheduler: 'SC',
  viewer: 'VW',
};

function permissionsForRole(role: UserRole, centralAccessLevel?: 'view' | 'operate' | 'configure', capabilities?: string[]): RolePermissions {
  if (centralAccessLevel && Array.isArray(capabilities)) {
    return {
      canManageUsers: false,
      canViewActivity: capabilities.includes('publishing.view'),
      canManageAccounts: capabilities.includes('publishing.accounts.configure'),
      canEditContent: capabilities.includes('publishing.content.create') || capabilities.includes('publishing.content.edit'),
      canSchedulePosts: capabilities.includes('publishing.schedule.manage'),
      canRunAutomation: capabilities.includes('publishing.execute'),
    };
  }
  if (centralAccessLevel) return {
    canManageUsers: false,
    canViewActivity: centralAccessLevel === 'configure',
    canManageAccounts: centralAccessLevel === 'configure',
    canEditContent: centralAccessLevel !== 'view',
    canSchedulePosts: centralAccessLevel !== 'view',
    canRunAutomation: centralAccessLevel === 'configure',
  };
  return {
    canManageUsers: role === 'operations_manager',
    canViewActivity: role === 'operations_manager',
    canManageAccounts: role === 'operations_manager',
    canEditContent: role === 'operations_manager' || role === 'post_uploader',
    canSchedulePosts: role === 'operations_manager' || role === 'scheduler',
    canRunAutomation: role === 'operations_manager',
  };
}

function readSavedSession(): AuthSession | null {
  try {
    const saved = window.sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!saved) return null;
    const session = JSON.parse(saved) as AuthSession;
    if (!session.token || !session.user || !userRoles.includes(session.user.role)) return null;
    setAuthToken(session.token);
    return session;
  } catch {
    return null;
  }
}

export default function App({ publishingIdentityToken }: { publishingIdentityToken?: string }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [platformStatus, setPlatformStatus] = useState<PlatformAccessStatus>({
    state: publishingIdentityToken ? 'checking' : 'ready',
    configured: false,
    username: '',
    workspaceId: '',
  });

  useEffect(() => {
    if (publishingIdentityToken) {
      let cancelled = false;
      setCentralAuthToken(publishingIdentityToken);
      window.sessionStorage.removeItem(AUTH_SESSION_KEY);
      api.me()
        .then(user => {
          if (cancelled) return;
          setSession({ token: publishingIdentityToken, user });
          setPlatformStatus({ state: 'ready', configured: true, username: user.email || user.username, workspaceId: user.workspaceId });
        })
        .catch(error => {
          if (cancelled) return;
          setCentralAuthToken(null);
          window.sessionStorage.removeItem(AUTH_SESSION_KEY);
          setSession(null);
          const rawMessage = error instanceof Error ? error.message : 'The publishing workspace could not be opened.';
          const upgradeRequired = /sign in|session expired/i.test(rawMessage);
          const connectionHelpRequired = /companion|extension|unavailable|failed to fetch/i.test(rawMessage);
          setPlatformStatus({
            state: 'error',
            configured: false,
            username: '',
            workspaceId: '',
            message: upgradeRequired
              ? 'Your AgenticThat website session could not be verified. Refresh this page and sign in again if needed.'
              : rawMessage,
            upgradeRequired,
            connectionHelpRequired,
          });
        });
      return () => {
        cancelled = true;
      };
    }

    setCentralAuthToken(null);
    const savedSession = readSavedSession();
    if (!savedSession) return;

    let cancelled = false;
    api.me()
      .then(user => {
        if (cancelled) return;
        const currentSession = { token: savedSession.token, user };
        window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(currentSession));
        setSession(currentSession);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthToken(null);
        window.sessionStorage.removeItem(AUTH_SESSION_KEY);
        setSession(null);
      });

    return () => {
      cancelled = true;
    };
  }, [publishingIdentityToken]);

  const signIn = (response: AuthResponse) => {
    setCentralAuthToken(null);
    const nextSession = { token: response.token, user: response.user };
    setAuthToken(response.token);
    window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
  };

  const signOut = () => {
    setCentralAuthToken(null);
    window.sessionStorage.removeItem(AUTH_SESSION_KEY);
    setSession(null);
    if (publishingIdentityToken) {
      void fetch('/api/platform-auth/logout', { method: 'POST' }).finally(() => {
        window.location.href = '/';
      });
    }
  };

  return session
    ? <Dashboard session={session} onSignOut={signOut} />
    : publishingIdentityToken
      ? <main className='auth-page'><section className='auth-card'>
          <a className='auth-brand' href='/apps'>AgenticThat<span> / Publish Queue</span></a>
          <h1>{platformStatus.state === 'error' ? 'Publishing access could not be opened.' : 'Opening your publishing workspace…'}</h1>
          <p>{platformStatus.state === 'error' ? platformStatus.message : 'Verifying your AgenticThat role and workspace.'}</p>
          {platformStatus.state === 'error' && <a className='button primary' href='/apps'>Return to the Store</a>}
        </section></main>
    : <LandingPage onSignIn={signIn} />;
}

function PlatformManagerAccess({
  identityToken,
  status,
  onSignIn,
  onConfigured,
}: {
  identityToken: string;
  status: PlatformAccessStatus;
  onSignIn: (response: AuthResponse) => void;
  onConfigured: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [teamUsername, setTeamUsername] = useState('');
  const [accessMode, setAccessMode] = useState<'manager' | 'team'>('manager');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const firstSetup = !status.configured;
  const teamAccess = !firstSetup && accessMode === 'team';

  const submit = async () => {
    setError('');
    if (teamAccess && !teamUsername.trim()) return setError('Enter the username assigned by your Operations Manager.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (firstSetup && password !== confirmPassword) return setError('Passwords do not match.');
    setLoading(true);
    try {
      const response = teamAccess
        ? await api.login({ username: teamUsername.trim(), password })
        : firstSetup
          ? await api.setupPlatformManager(identityToken, password)
          : await api.loginPlatformManager(identityToken, password);
      if (response.user.workspaceId !== status.workspaceId) {
        throw new Error('These credentials belong to a different publishing workspace.');
      }
      if (firstSetup) onConfigured();
      onSignIn(response);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to continue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className='auth-page'>
      <section className='auth-visual' aria-label='Social publishing workspace'>
        <div className='auth-visual-content'>
          <a className='auth-brand' href='/apps'>AgenticThat<span> / Publish Queue</span></a>
          <div className='auth-message'>
            <p className='auth-kicker'>Your private publishing workspace</p>
            <h1>{firstSetup ? 'Create your manager access.' : 'Welcome back.'}</h1>
            <p>Publishing accounts, users, posts, and schedules stay isolated inside this workspace.</p>
          </div>
        </div>
      </section>
      <section className='auth-access' aria-labelledby='manager-access-title'>
        <div className='auth-access-inner'>
          <div className='auth-heading'>
            <p className='auth-kicker'>{teamAccess ? 'Assigned team access' : 'Operations Manager'}</p>
            <h2 id='manager-access-title'>{firstSetup ? 'Set your password' : teamAccess ? 'Team member sign in' : 'Enter your password'}</h2>
            <p>{teamAccess
              ? 'Use the username, password, and role assigned in Manage users.'
              : firstSetup
              ? 'Choose the Operations Manager password for this account. You will use it for future publishing logins.'
              : 'Use the Operations Manager password you created for this account.'}</p>
          </div>
          {status.state === 'checking' ? (
            <div className='temporary-access'><Loader2 className='spin' size={18} /><span>Checking workspace setup…</span></div>
          ) : status.state === 'error' ? (
            <>
              <p className='auth-error' role='alert'>{status.message}</p>
              {status.upgradeRequired && <div className='publishing-setup-actions'>
                <a href={companionDownloadUrl}><Download size={15} />Download latest Companion</a>
                <button type='button' onClick={() => window.location.reload()}><RefreshCw size={15} />Try again</button>
              </div>}
              {status.connectionHelpRequired && !status.upgradeRequired && <>
                <p className='temporary-access'>Refresh the page. If publishing is still unavailable, ask the Workspace Manager to open the paired Companion.</p>
                <div className='publishing-setup-actions'>
                  <button type='button' onClick={() => window.location.reload()}><RefreshCw size={15} />Try again</button>
                </div>
              </>}
            </>
          ) : (
            <form className='auth-form' onSubmit={event => { event.preventDefault(); void submit(); }}>
              {!firstSetup && <div className='workspace-access-switch' role='group' aria-label='Choose workspace sign-in type'>
                <button type='button' className={accessMode === 'manager' ? 'active' : ''} onClick={() => { setAccessMode('manager'); setPassword(''); setError(''); }}>Operations Manager</button>
                <button type='button' className={accessMode === 'team' ? 'active' : ''} onClick={() => { setAccessMode('team'); setPassword(''); setError(''); }}>Team member</button>
              </div>}
              {teamAccess ? <label>
                <span>Assigned username</span>
                <div className='auth-input'><KeyRound size={17} /><input value={teamUsername} onChange={event => setTeamUsername(event.target.value)} autoComplete='username' placeholder='Enter assigned username' /></div>
              </label> : <label>
                <span>Manager username</span>
                <div className='auth-input'><KeyRound size={17} /><input value={status.username} readOnly /></div>
              </label>}
              <label>
                <span>{firstSetup ? 'Create password' : teamAccess ? 'Assigned password' : 'Operations Manager password'}</span>
                <div className='auth-input'><LockKeyhole size={17} /><input type='password' value={password} onChange={event => setPassword(event.target.value)} autoComplete={firstSetup ? 'new-password' : 'current-password'} /></div>
              </label>
              {firstSetup && <label>
                <span>Confirm password</span>
                <div className='auth-input'><ShieldCheck size={17} /><input type='password' value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete='new-password' /></div>
              </label>}
              {error && <p className='auth-error' role='alert'>{error}</p>}
              <button type='submit' className='auth-submit' disabled={loading}>
                {loading ? <Loader2 className='spin' size={18} /> : <ArrowRight size={18} />}
                {firstSetup ? 'Create manager access' : teamAccess ? 'Sign in with assigned role' : 'Open publishing workspace'}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

function LandingPage({ onSignIn }: { onSignIn: (response: AuthResponse) => void }) {
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connectionState, setConnectionState] = useState<'checking' | 'extension-missing' | 'companion-missing' | 'chrome-missing' | 'ready'>('checking');
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [desktopBridgeDetected, setDesktopBridgeDetected] = useState(false);

  const checkConnection = useCallback(async () => {
    setConnectionState('checking');
    const extension = await detectPublishingExtension(true);
    setExtensionDetected(Boolean(extension));
    setDesktopBridgeDetected(extension?.version === 'desktop');
    try {
      const health = await api.health();
      setConnectionState(health.automationReady ? 'ready' : !health.chromeInstalled ? 'chrome-missing' : 'companion-missing');
    } catch {
      setConnectionState(extension ? 'companion-missing' : 'extension-missing');
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  const chooseRole = (role: UserRole) => {
    const credentials = loginRoleOptions.find(option => option.role === role);
    setSelectedRole(role);
    setUsername(credentials?.username ?? '');
    setError('');
  };

  const submit = async () => {
    setError('');
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }

    setLoading(true);
    try {
      onSignIn(await api.login({ username: username.trim(), password }));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className='auth-page'>
      <section className='auth-visual' aria-label='Social publishing workspace'>
        <div className='auth-visual-content'>
          <a className='auth-brand' href='/apps'>AgenticThat<span> / Publish Queue</span></a>
          <div className='auth-message'>
            <p className='auth-kicker'>Social publishing operations</p>
            <h1>Plan the work. Publish at the right moment.</h1>
            <p>One workspace for uploads, schedules, and connected publishing channels.</p>
          </div>
          <div className='auth-channel-row' aria-label='Supported platforms'>
            <span>YouTube</span><span>Instagram</span><span>LinkedIn</span><span>Facebook</span><span>X</span>
          </div>
        </div>
      </section>

      <section className='auth-access' aria-labelledby='access-title'>
        <div className='auth-access-inner'>
          <div className='auth-heading'>
            <p className='auth-kicker'>Secure workspace</p>
            <h2 id='access-title'>Sign in</h2>
            <p>Use your assigned workspace credentials. Your role controls which sections are available after sign in.</p>
          </div>

          <div className='publishing-setup-card'>
            <div className='publishing-setup-title'><MonitorCheck size={19} /><span><strong>{desktopBridgeDetected ? 'Companion publishing ready' : 'One-time publishing setup'}</strong><small>{desktopBridgeDetected ? 'Dashboard and live publishing browser are built into this app.' : 'Install both once. No project download or commands.'}</small></span></div>
            <div className='publishing-setup-checks'>
              <span className={connectionState === 'extension-missing' ? 'needs-action' : connectionState === 'checking' ? '' : 'ready'}><Puzzle size={16} /><b>{desktopBridgeDetected ? 'Companion bridge' : 'Chrome bridge'}</b><small>{desktopBridgeDetected ? 'Built in' : connectionState === 'extension-missing' ? 'Install or repair' : connectionState === 'checking' ? 'Checking…' : extensionDetected ? 'Installed' : 'Direct connection'}</small></span>
              <span className={connectionState === 'companion-missing' || connectionState === 'extension-missing' ? 'needs-action' : connectionState === 'ready' || connectionState === 'chrome-missing' ? 'ready' : ''}><Download size={16} /><b>Windows companion</b><small>{connectionState === 'companion-missing' ? 'Local service offline' : connectionState === 'extension-missing' ? 'Connection not confirmed' : connectionState === 'ready' || connectionState === 'chrome-missing' ? 'Running' : 'Checking'}</small></span>
            </div>
            {!desktopBridgeDetected && <div className='publishing-setup-actions'>
              <a href={extensionInstallUrl} target='_blank' rel='noreferrer'><Puzzle size={15} />{configuredExtensionInstallUrl ? 'Install extension' : 'Download Chrome bridge'}</a>
              <a href={companionDownloadUrl}><Download size={15} />Install Windows companion</a>
              <a href={localCompanionHealthUrl} target='_blank' rel='noreferrer'><CircleCheckBig size={15} />Test local service</a>
              <button type='button' onClick={() => void checkConnection()}><RefreshCw size={15} />Check again</button>
            </div>}
            {connectionState === 'extension-missing' && !configuredExtensionInstallUrl && <p>Allow Local network access if Chrome asks. Otherwise extract the bridge ZIP, open <strong>chrome://extensions</strong>, enable Developer mode, choose <strong>Load unpacked</strong>, and select the extracted folder.</p>}
            {connectionState === 'chrome-missing' && <p>Install Google Chrome or Microsoft Edge to use the system-browser login fallback.</p>}
            {connectionState === 'ready' && <p className='setup-ready-message'><CircleCheckBig size={15} />Publishing connection ready{desktopBridgeDetected ? ' inside Companion' : extensionDetected ? ' through the Chrome bridge' : ' through the direct local connection'}.</p>}
          </div>

          <div className='role-options' aria-label='Choose login type'>
            {loginRoleOptions.map(option => (
              <button
                type='button'
                key={option.role}
                className={`role-option ${selectedRole === option.role ? 'selected' : ''}`}
                aria-pressed={selectedRole === option.role}
                onClick={() => chooseRole(option.role)}
              >
                {option.role === 'operations_manager' ? <BriefcaseBusiness size={21} /> : <UsersRound size={21} />}
                <span><strong>{userRoleLabels[option.role]}</strong><small>{option.description}</small></span>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>

          <form className='auth-form' onSubmit={event => { event.preventDefault(); submit(); }}>
            <label>
              <span>Username</span>
              <div className='auth-input'><KeyRound size={17} /><input value={username} onChange={event => setUsername(event.target.value)} autoComplete='username' placeholder='Select a login type' /></div>
            </label>
            <label>
              <span>Password</span>
              <div className='auth-input'><LockKeyhole size={17} /><input type='password' value={password} onChange={event => setPassword(event.target.value)} autoComplete='current-password' placeholder='Select a login type' /></div>
            </label>

            {selectedRole && (
              <div className='temporary-access'>
                <ShieldCheck size={17} />
                <span>Role selected: <code>{userRoleLabels[selectedRole]}</code></span>
              </div>
            )}
            {error && <p className='auth-error' role='alert'>{error}</p>}
            <button type='submit' className='auth-submit' disabled={loading || connectionState !== 'ready'}>
              {loading ? <Loader2 className='spin' size={18} /> : <ArrowRight size={18} />}
              Sign in
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Dashboard({ session, onSignOut }: { session: AuthSession; onSignOut: () => void }) {
  const user = session.user;
  const permissions = useMemo(() => permissionsForRole(user.role, user.centralAccessLevel, user.capabilities), [user.role, user.centralAccessLevel, user.capabilities]);
  const [uploads, setUploads] = useState<PlatformUpload[]>([]);
  const [submissions, setSubmissions] = useState<ContentSubmission[]>([]);
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [schedules, setSchedules] = useState<PublishingSchedule[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [connectionMode, setConnectionMode] = useState<'central' | 'desktop' | 'extension' | 'direct' | 'checking'>('checking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [scheduleManagerOpen, setScheduleManagerOpen] = useState(false);
  const [userManagerOpen, setUserManagerOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [editingUpload, setEditingUpload] = useState<PlatformUpload | null>(null);
  const [schedulingSubmission, setSchedulingSubmission] = useState<ContentSubmission | null>(null);
  const [automationNotice, setAutomationNotice] = useState<AutomationNotice | null>(null);
  const [serverAutomation, setServerAutomation] = useState<ServerAutomationOverview | null>(null);
  const [serverAutomationError, setServerAutomationError] = useState<string | null>(null);

  const refresh = useCallback(async (showLoading = true) => {
    setError(null);
    if (showLoading) setLoading(true);
    try {
      const baseRequests = [
        api.health(),
        api.uploads(),
        api.submissions(),
        api.schedules(),
        api.accounts(),
      ] as const;
      const serverRequest = api.serverAutomationOverview()
        .then(overview => ({ overview, error: null as string | null }))
        .catch(serverError => ({
          overview: null,
          error: serverError instanceof Error ? serverError.message : 'The server publishing worker is unavailable.',
        }));
      const [health, latestUploads, latestSubmissions, latestSchedules, companionAccounts, latestServer] = await Promise.all([
        ...baseRequests,
        serverRequest,
      ]);
      setConnectionMode(health.transport);
      setIsRunning(health.automationRunning);
      setUploads(latestUploads);
      setSubmissions(latestSubmissions);
      setServerAutomation(latestServer.overview);
      setServerAutomationError(latestServer.error);
      const availableServerAccounts = latestServer.overview?.accounts
        .filter(account => account.platform === 'instagram'
          ? latestServer.overview?.health.features.instagramPublishing
          : account.platform === 'facebook' ? latestServer.overview?.health.features.facebookPublishing
          : account.platform === 'x' ? latestServer.overview?.health.features.xPublishing
          : account.platform === 'linkedin' ? latestServer.overview?.health.features.linkedinPublishing
          : account.platform === 'youtube' && latestServer.overview?.health.features.youtubePublishing)
        .map(serverAccountForComposer) ?? [];
      setAccounts([
        ...companionAccounts.filter(account => account.executionEngine !== 'server_worker'),
        ...availableServerAccounts,
      ]);
      setSchedules(latestSchedules);
      if (permissions.canManageUsers) {
        const [latestUsers, latestActivity] = await Promise.all([
          api.users(),
          api.activityLogs(100),
        ]);
        setUsers(latestUsers);
        setActivityLogs(latestActivity);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [permissions.canManageUsers]);

  useEffect(() => {
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(false), 5000);
    return () => window.clearInterval(refreshTimer);
  }, [refresh]);

  const handleRun = async () => {
    if (!permissions.canRunAutomation) return;
    setIsRunning(true);
    try {
      await api.runAutomation();
      setAutomationNotice({
        variant: 'success',
        title: connectionMode === 'central' ? 'Posts queued' : 'Automation started',
        message: connectionMode === 'central'
          ? 'The workspace Companion will publish automatically when it is online.'
          : 'Publishing will use saved manual sessions only. Accounts without an active saved session will fail for review.',
      });
      window.setTimeout(() => void refresh(false), 5000);
    } catch (e) {
      setIsRunning(false);
      setAutomationNotice({
        variant: 'error',
        title: 'Automation could not start',
        message: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  };

  const handleStop = async () => {
    if (!permissions.canRunAutomation) return;
    try {
      const result = await api.stopAutomation();
      setIsRunning(false);
      setAutomationNotice({
        variant: 'success',
        title: result.stopped ? 'Emergency stop requested' : 'Publishing is already stopped',
        message: result.message,
      });
      window.setTimeout(() => void refresh(false), 750);
    } catch (e) {
      setAutomationNotice({
        variant: 'error',
        title: 'Publishing could not be stopped',
        message: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  };

  return (
    <>
      <Workboard
        user={user}
        permissions={permissions}
        uploads={uploads}
        submissions={submissions}
        accounts={accounts}
        schedules={schedules}
        connectionMode={connectionMode}
        users={users}
        activityLogs={activityLogs}
        loading={loading}
        error={error}
        isRunning={isRunning}
        onRun={handleRun}
        onStop={handleStop}
        onRefresh={() => void refresh()}
        onSignOut={onSignOut}
        onOpenAccounts={(platform) => {
          window.location.href = '/config-manager?service=publishing&platform=' + platform;
        }}
        onOpenSchedules={() => permissions.canSchedulePosts && setScheduleManagerOpen(true)}
        onOpenUsers={() => setUserManagerOpen(true)}
        onOpenActivity={() => setActivityOpen(true)}
        onEdit={setEditingUpload}
        editingUpload={editingUpload}
        onCloseEdit={() => setEditingUpload(null)}
        onCreated={() => void refresh(false)}
        onScheduleSubmission={setSchedulingSubmission}
        serverAutomation={serverAutomation}
        serverAutomationError={serverAutomationError}
        onServerAutomationChanged={() => void refresh(false)}
      />
      {scheduleManagerOpen && (
        <ScheduleManagerModal
          schedules={schedules}
          uploads={uploads}
          onClose={() => setScheduleManagerOpen(false)}
          onSuccess={() => void refresh()}
        />
      )}
      {userManagerOpen && permissions.canManageUsers && (
        <UserManagementModal
          currentUser={user}
          users={users}
          onClose={() => setUserManagerOpen(false)}
          onSuccess={() => void refresh(false)}
        />
      )}
      {activityOpen && permissions.canViewActivity && (
        <ActivityLogModal
          activityLogs={activityLogs}
          onClose={() => setActivityOpen(false)}
        />
      )}
      {automationNotice && (
        <AutomationNoticeModal
          notice={automationNotice}
          onClose={() => setAutomationNotice(null)}
        />
      )}
      {schedulingSubmission && permissions.canSchedulePosts && (
        <ScheduleSubmissionModal
          submission={schedulingSubmission}
          accounts={accounts}
          schedules={schedules}
          onClose={() => setSchedulingSubmission(null)}
          onSuccess={() => {
            setSchedulingSubmission(null);
            void refresh(false);
          }}
        />
      )}
    </>
  );
}

function AutomationNoticeModal({ notice, onClose }: { notice: AutomationNotice; onClose: () => void }) {
  const isSuccess = notice.variant === 'success';

  return (
    <div className='modal-overlay automation-notice-overlay' onClick={onClose}>
      <div
        className={`automation-notice-panel ${notice.variant}`}
        role='dialog'
        aria-modal='true'
        aria-labelledby='automation-notice-title'
        onClick={event => event.stopPropagation()}
      >
        <div className='automation-notice-icon'>
          {isSuccess ? <CircleCheckBig size={28} /> : <CircleAlert size={28} />}
        </div>
        <div className='automation-notice-copy'>
          <h2 id='automation-notice-title'>{notice.title}</h2>
          <p>{notice.message}</p>
        </div>
        <button type='button' className='automation-notice-action' onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}

function toLocalDayKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function getAuditTimestamp(upload: PlatformUpload) {
  if (upload.status === 'posted') return upload.updatedAt;
  return upload.scheduledAt ?? upload.updatedAt ?? upload.uploadedAt;
}

function isWaitingForCompanion(upload: PlatformUpload, now = Date.now()) {
  return upload.statusDetail === 'waiting_for_companion'
    || (upload.status === 'queued' && Boolean(upload.scheduledAt) && Date.parse(upload.scheduledAt || '') <= now);
}

function getAuditAction(upload: PlatformUpload) {
  if (upload.status === 'posted') return 'Published';
  if (upload.statusDetail === 'reconnect_required') return 'Reconnect Required';
  if (upload.status === 'failed') return 'Needs attention';
  if (upload.statusDetail === 'opening_platform') return 'Opening Platform';
  if (upload.statusDetail === 'uploading') return 'Uploading';
  if (upload.statusDetail === 'publishing') return 'Publishing';
  if (upload.status === 'processing') return 'Publishing now';
  if (isWaitingForCompanion(upload)) return 'Waiting for Companion';
  if (upload.scheduledAt) return 'Scheduled';
  return 'Queued';
}

function formatEventTime(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

type DeliveryOutcomeTone = 'posted' | 'failed' | 'uncertain' | 'processing' | 'deferred' | 'scheduled' | 'queued';

function getDeliveryOutcome(upload: PlatformUpload): { tone: DeliveryOutcomeTone; label: string; detail: string; timestamp: string } {
  const timestamp = upload.postedAt ?? upload.lastAttemptAt ?? upload.updatedAt ?? upload.uploadedAt;
  if (upload.status === 'posted') {
    return { tone: 'posted', label: 'Posted', detail: `Confirmed delivered ${formatEventTime(timestamp)}`, timestamp };
  }
  if (upload.publishActionState === 'uncertain') {
    return { tone: 'uncertain', label: 'Confirmation unclear', detail: upload.failureReason || 'The final action was not retried. Inspect the platform before trying again.', timestamp };
  }
  if (upload.statusDetail === 'reconnect_required') {
    return { tone: 'failed', label: 'Reconnect Required', detail: upload.failureReason || 'The saved social-media session needs to be reconnected by a Publishing Manager.', timestamp };
  }
  if (upload.status === 'failed') {
    return { tone: 'failed', label: 'Failed', detail: upload.failureReason || 'Publishing stopped and needs review.', timestamp };
  }
  if (upload.status === 'processing') {
    const detailLabel = upload.statusDetail === 'opening_platform' ? 'Opening Platform'
      : upload.statusDetail === 'uploading' ? 'Uploading'
        : upload.statusDetail === 'publishing' ? 'Publishing'
          : 'Publishing now';
    return { tone: 'processing', label: detailLabel, detail: 'The local Companion is working on this destination.', timestamp };
  }
  if (upload.safetyDeferredUntil) {
    return { tone: 'deferred', label: 'Safety paused', detail: `${upload.safetyReason || 'Held by a safety limit.'} Resumes after ${formatEventTime(upload.safetyDeferredUntil)}.`, timestamp };
  }
  if (isWaitingForCompanion(upload)) {
    return { tone: 'scheduled', label: 'Waiting for Companion', detail: 'The job is safely queued and will retry when its assigned Companion is available.', timestamp: upload.scheduledAt! };
  }
  if (upload.scheduledAt) {
    return { tone: 'scheduled', label: 'Scheduled', detail: `Will publish ${formatEventTime(upload.scheduledAt)}`, timestamp: upload.scheduledAt };
  }
  return { tone: 'queued', label: 'Waiting', detail: 'Ready, but no publishing time has been assigned.', timestamp };
}

function formatCalendarHeading(dayKey: string) {
  const date = new Date(`${dayKey}T12:00:00`);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatComposerFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type ComposerScheduleMode = 'now' | 'exact' | 'template';

type ComposerScheduleDraft = {
  mode: ComposerScheduleMode;
  exactAt: string;
  scheduleId: string;
};

type ComposerCopyMode = 'edit' | 'preview';

type PlatformEligibility = {
  allowed: boolean;
  mediaCompatible: boolean;
  reason: string;
};

const emptyComposerSchedule = (): ComposerScheduleDraft => ({ mode: 'now', exactAt: '', scheduleId: '' });
const composerFormatOptions: Array<{ id: PostFormat; label: string; detail: string; icon: ReactNode }> = [
  { id: 'image', label: 'Image', detail: 'Single visual post', icon: <ImageIcon size={22} /> },
  { id: 'video', label: 'Video', detail: 'Short or long-form video', icon: <Video size={22} /> },
  { id: 'text', label: 'Text', detail: 'No media required', icon: <FileText size={22} /> },
];

function localScheduleDateTime(dateValue: string | undefined, time: string) {
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function scheduleCanReceivePosts(schedule: PublishingSchedule) {
  if (schedule.status !== 'active') return false;
  if (schedule.frequency !== 'onetime') return true;
  const runAt = localScheduleDateTime(schedule.endDate, schedule.time);
  return Boolean(runAt && runAt.getTime() > Date.now());
}

function getPlatformEligibility(platform: Platform, postFormat: PostFormat | null, file: File | null, title: string, description: string): PlatformEligibility {
  if (!postFormat) return { allowed: false, mediaCompatible: false, reason: 'Choose a post format first' };
  const rules = platformPostRules[platform];
  if (!rules.formats.includes(postFormat)) {
    return { allowed: false, mediaCompatible: false, reason: 'Text-only posts are not supported' };
  }
  if (postFormat !== 'text' && !file) {
    return { allowed: false, mediaCompatible: true, reason: `Add ${postFormat} to continue` };
  }
  if (file && postFormat !== 'text') {
    const fileFormat = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
    if (fileFormat !== postFormat) return { allowed: false, mediaCompatible: false, reason: `Choose a valid ${postFormat}` };
  }
  const titleRequired = rules.titleRequired || rules.titleRequiredFor?.includes(postFormat);
  if (titleRequired && !title.trim()) return { allowed: false, mediaCompatible: true, reason: 'Add YouTube title' };
  if (!description.trim()) return { allowed: false, mediaCompatible: true, reason: postFormat === 'text' ? 'Write your post text' : 'Add a description' };
  if (rules.titleLimit && title.length > rules.titleLimit) {
    return { allowed: false, mediaCompatible: true, reason: `Title limit: ${rules.titleLimit} characters` };
  }
  if (description.length > rules.descriptionLimit) {
    return { allowed: true, mediaCompatible: true, reason: `Edit text for ${rules.descriptionLimit.toLocaleString()} limit` };
  }
  return { allowed: true, mediaCompatible: true, reason: 'Ready for this post' };
}

function effectivePlatformDescription(platform: Platform, base: string, overrides: Partial<Record<Platform, string>>) {
  return overrides[platform]?.trim() || base.trim();
}

function platformDescriptionError(platform: Platform, text: string) {
  if (!text.trim()) return 'Description is required.';
  const limit = platformPostRules[platform].descriptionLimit;
  if (text.length > limit) return `${platformLabels[platform]} limit is ${limit.toLocaleString()} characters.`;
  return '';
}

function scheduleDraftError(draft: ComposerScheduleDraft, schedules: PublishingSchedule[]) {
  if (draft.mode === 'exact') {
    if (!draft.exactAt) return 'Choose a publish date and time.';
    const timestamp = Date.parse(draft.exactAt);
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return 'Choose a future publish date and time.';
  }
  if (draft.mode === 'template') {
    const scheduleId = Number(draft.scheduleId);
    const schedule = schedules.find(item => item.id === scheduleId);
    if (!schedule || !scheduleCanReceivePosts(schedule)) {
      return 'Choose an active future schedule template.';
    }
  }
  return '';
}

function destinationSchedule(draft: ComposerScheduleDraft): Omit<UnifiedPostDestinationInput, 'accountId'> {
  if (draft.mode === 'exact') return { scheduledAt: new Date(draft.exactAt).toISOString() };
  if (draft.mode === 'template') return { scheduleId: Number(draft.scheduleId) };
  return {};
}

async function validateServerMedia(file: File, targetPlatforms: Platform[]) {
  const standardMedia = ["image/jpeg", "image/png", "video/mp4", "video/quicktime"];
  const instagramImage = ["image/webp", "image/gif", "image/avif", "image/tiff"];
  if (!standardMedia.includes(file.type) && !(instagramImage.includes(file.type) && targetPlatforms.every(platform => platform === "instagram"))) {
    throw new Error("The server worker supports JPEG, PNG, MP4, and MOV media. Instagram-only posts also support WebP, GIF, AVIF, and TIFF images.");
  }
  const video = file.type.startsWith("video/");
  if (file.size < 1) throw new Error(`The server ${video ? "video" : "image"} cannot be empty.`);
}

function ComposerPreviewMedia({ file, previewUrl, platform, postFormat }: { file: File | null; previewUrl: string; platform: Platform; postFormat: PostFormat }) {
  if (postFormat === 'text') return null;
  if (!file || !previewUrl) return <div className='composer-preview-empty'>Add media</div>;
  const className = `composer-preview-media ${platform} ${file.type.startsWith('video/') ? 'video' : 'image'}`;
  return file.type.startsWith('video/')
    ? <video className={className} src={previewUrl} muted loop playsInline controls />
    : <img className={className} src={previewUrl} alt='Post preview media' />;
}

function ComposerPlatformPreview({
  platform,
  file,
  previewUrl,
  title,
  description,
  postFormat,
}: {
  platform: Platform;
  file: File | null;
  previewUrl: string;
  title: string;
  description: string;
  postFormat: PostFormat;
}) {
  const isVideo = postFormat === 'video';
  const name = 'AgenticThat';
  const handle = platform === 'x' ? '@agenticthat' : '';
  const media = <ComposerPreviewMedia file={file} previewUrl={previewUrl} platform={platform} postFormat={postFormat} />;

  if (platform === 'linkedin') return <article className='composer-preview-card linkedin'>
    <header><span className='avatar' /><div><strong>{name}</strong><small>8m · Public</small></div><MoreHorizontal size={17} /></header>
    <p>{description}</p>{media}
    <footer><span><ThumbsUp size={16} />Like</span><span><MessageCircle size={16} />Comment</span><span><Repeat2 size={16} />Repost</span><span><Send size={16} />Send</span></footer>
  </article>;

  if (platform === 'facebook') return <article className='composer-preview-card facebook'>
    <header><span className='avatar' /><div><strong>{name}</strong><small>13m · Public</small></div><MoreHorizontal size={17} /></header>
    <p>{description}</p>{postFormat !== 'text' && <div className='facebook-media-wrap'>{media}{isVideo && <span className='video-time'>0:06 / 0:06</span>}</div>}
    <footer><ThumbsUp size={18} /><MessageCircle size={18} /><Share2 size={18} /></footer>
  </article>;

  if (platform === 'x') return <article className='composer-preview-card x'>
    <header><span className='avatar' /><div><strong>{name}</strong> <small>{handle} · 29m</small><p>{description}</p>{media}</div><MoreHorizontal size={17} /></header>
    <footer><MessageCircle size={17} /><Repeat2 size={17} /><Heart size={17} /><span>1</span><Bookmark size={17} /><Share2 size={17} /></footer>
  </article>;

  if (platform === 'instagram') return <article className='composer-preview-card instagram'>
    <div className='instagram-media'>{media}</div><aside><header><span className='avatar' /><strong>{name}</strong><MoreHorizontal size={17} /></header><p><strong>{name}</strong> {description}</p><footer><Heart size={17} /><MessageCircle size={17} /><Send size={17} /><Bookmark size={17} /></footer></aside>
  </article>;

  if (platform === 'youtube' && !isVideo) return <article className={`composer-preview-card youtube-community ${postFormat === 'text' ? 'text-only' : ''}`}>
    <header><span className='avatar youtube-channel-avatar'>t</span><div><strong>{name}</strong><small>acc1 · Community</small></div><MoreHorizontal size={17} /></header>
    <p>{description}</p>{media}
    <footer><span><ThumbsUp size={16} />Like</span><span><MessageCircle size={16} />Comment</span><span><Share2 size={16} />Share</span></footer>
  </article>;

  return <article className='composer-preview-card youtube'>
    <div className='youtube-player'>{media}</div>
    <h3>{title || 'Video title'}</h3>
    <div className='youtube-meta'><span className='youtube-avatar'>a</span><strong>{name}</strong><button type='button'>Subscribe</button></div>
    <p>{description}</p>
  </article>;
}

function PolishedComposerPreview({
  platform,
  file,
  previewUrl,
  title,
  description,
  postFormat,
}: {
  platform: Platform;
  file: File | null;
  previewUrl: string;
  title: string;
  description: string;
  postFormat: PostFormat;
}) {
  const isVideo = postFormat === 'video';
  const media = <ComposerPreviewMedia file={file} previewUrl={previewUrl} platform={platform} postFormat={postFormat} />;
  const name = 'AgenticThat';

  if (platform === 'linkedin') return <article className='composer-preview-card linkedin polished'>
    <header><span className='avatar' /><div><strong>{name} <b>· You</b></strong><small>8m · Public</small></div><MoreHorizontal size={18} /></header>
    <p>{description}</p>{media}
    <footer><span><ThumbsUp size={18} />Like</span><span><MessageCircle size={18} />Comment</span><span><Repeat2 size={18} />Repost</span><span><Send size={18} />Send</span></footer>
  </article>;

  if (platform === 'facebook') return <article className='composer-preview-card facebook polished'>
    <header><span className='avatar' /><div><strong>{name}</strong><small>13m · Public</small></div><MoreHorizontal size={18} /></header>
    <p>{description}</p>{postFormat !== 'text' && <div className='facebook-media-wrap'>{media}{isVideo && <span className='video-time'>0:06 / 0:06</span>}</div>}
    <footer><span><ThumbsUp size={21} /></span><span><MessageCircle size={21} /></span><span><Share2 size={21} /></span></footer>
    <div className='facebook-comment'><span className='avatar small' /><em>Write a comment...</em></div>
  </article>;

  if (platform === 'x') return <article className='composer-preview-card x polished'>
    <header><span className='avatar' /><div><strong>{name}</strong> <small>@account - 29m</small><p>{description}</p>{media}</div><MoreHorizontal size={18} /></header>
    <footer><MessageCircle size={20} /><Repeat2 size={20} /><Heart size={20} /><span>1</span><Bookmark size={20} /><Share2 size={20} /></footer>
  </article>;

  if (platform === 'instagram') return <article className='composer-preview-card instagram polished'>
    <div className='instagram-media'>{media}</div><aside><header><span className='avatar' /><strong>{name}</strong><MoreHorizontal size={18} /></header><p><strong>{name}</strong> {description}</p><footer><Heart size={20} /><MessageCircle size={20} /><Send size={20} /><Bookmark size={20} /></footer><small>Add a comment...</small></aside>
  </article>;

  if (platform === 'youtube' && !isVideo) return <article className={`composer-preview-card youtube-community polished ${postFormat === 'text' ? 'text-only' : ''}`}>
    <header><span className='avatar youtube-channel-avatar'>t</span><div><strong>{name}</strong><small>acc1 · Community</small></div><MoreHorizontal size={18} /></header>
    <p>{description}</p>{media}
    <footer><span><ThumbsUp size={18} />Like</span><span><MessageCircle size={18} />Comment</span><span><Share2 size={18} />Share</span></footer>
  </article>;

  return <article className='composer-preview-card youtube polished'>
    <div className='youtube-player'>{media}</div>
    <h3>{title || 'Video title'}</h3>
    <div className='youtube-meta'><span className='youtube-avatar'>a</span><strong>{name}</strong><button type='button'>Subscribe</button></div>
    <p>{description}</p>
  </article>;
}

function UnifiedComposer({
  accounts,
  schedules,
  canSchedule,
  handoffOnly,
  canManageAccounts,
  canPublishNow,
  onOpenAccounts,
  onCreated,
}: {
  accounts: PlatformAccount[];
  schedules: PublishingSchedule[];
  canSchedule: boolean;
  handoffOnly: boolean;
  canManageAccounts: boolean;
  canPublishNow: boolean;
  onOpenAccounts: (platform: Platform) => void;
  onCreated: () => void;
}) {
  const [postFormat, setPostFormat] = useState<PostFormat | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [additionalFiles, setAdditionalFiles] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const [title, setTitle] = useState('');
  const [youtubeAudience, setYoutubeAudience] = useState<'' | 'made_for_kids' | 'not_made_for_kids'>('');
  const [youtubeVisibility, setYoutubeVisibility] = useState<'' | 'public' | 'unlisted' | 'private'>('');
  const [description, setDescription] = useState('');
  const [platformDescriptions, setPlatformDescriptions] = useState<Partial<Record<Platform, string>>>({});
  const [copyMode, setCopyMode] = useState<ComposerCopyMode>('preview');
  const [activeCopyPlatform, setActiveCopyPlatform] = useState<Platform>('instagram');
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [sharedSchedule, setSharedSchedule] = useState<ComposerScheduleDraft>(emptyComposerSchedule);
  const [scheduleOverrides, setScheduleOverrides] = useState<Record<string, ComposerScheduleDraft>>({});
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [pendingPreflightWarnings, setPendingPreflightWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const serverSubmissionId = useRef(crypto.randomUUID());
  const serverUploadedMedia = useRef<{
    files: File[];
    media: Array<{ storageKey: string; fileName: string; mimeType: string; size: number }>;
  } | null>(null);
  const selectedFiles = useMemo(() => file ? [file, ...additionalFiles] : [], [file, additionalFiles]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  useEffect(() => {
    setPendingPreflightWarnings([]);
    setMessage(current => current?.type === 'warning' ? null : current);
  }, [postFormat, file, additionalFiles, title, youtubeAudience, youtubeVisibility, description, platformDescriptions, selectedAccountIds, sharedSchedule, scheduleOverrides, rightsConfirmed]);

  useEffect(() => {
    serverSubmissionId.current = crypto.randomUUID();
  }, [title, youtubeAudience, youtubeVisibility, description, platformDescriptions, selectedAccountIds, sharedSchedule, scheduleOverrides]);

  const eligibility = useMemo(() => Object.fromEntries(platforms.map(platform => [
    platform,
    getPlatformEligibility(platform, postFormat, file, title, description),
  ])) as Record<Platform, PlatformEligibility>, [postFormat, file, title, description]);

  const enabledAccounts = useMemo(() => accounts.filter(account => account.enabled && (
    accountPublishingEngine(account) !== 'server_worker'
    || postFormat === null
    || postFormat === 'image'
    || postFormat === 'video'
    || (postFormat === 'text' && ['facebook', 'x', 'linkedin', 'youtube'].includes(account.platform))
  )), [accounts, postFormat]);
  const eligibleAccountIds = useMemo(() => new Set(enabledAccounts
    .filter(account => eligibility[account.platform].allowed)
    .map(account => account.id)), [enabledAccounts, eligibility]);

  useEffect(() => {
    setSelectedAccountIds(current => current.filter(accountId => eligibleAccountIds.has(accountId)));
    setScheduleOverrides(current => Object.fromEntries(Object.entries(current).filter(([accountId]) => eligibleAccountIds.has(accountId))));
  }, [eligibleAccountIds]);

  const selectedAccounts = useMemo(() => selectedAccountIds
    .map(accountId => accounts.find(account => account.id === accountId))
    .filter((account): account is PlatformAccount => Boolean(account)), [accounts, selectedAccountIds]);
  const selectedPlatforms = useMemo(() => [...new Set(selectedAccounts.map(account => account.platform))], [selectedAccounts]);
  // Show YouTube's required video fields before destination selection. When
  // these fields depended on an already-selected YouTube account, eligibility
  // required a title while the UI hid the only title input: a circular lock.
  const showYoutubeTitle = postFormat === 'video';
  const youtubeVideoSelected = Boolean(postFormat === 'video' && selectedPlatforms.includes('youtube'));
  const selectedNeedsTitle = youtubeVideoSelected;
  const contentReady = Boolean(postFormat && description.trim() && (postFormat === 'text' || file));
  const activeSchedules = schedules.filter(scheduleCanReceivePosts);

  useEffect(() => {
    setPlatformDescriptions(current => Object.fromEntries(Object.entries(current).filter(([platform]) => selectedPlatforms.includes(platform as Platform))) as Partial<Record<Platform, string>>);
    if (selectedPlatforms.length && !selectedPlatforms.includes(activeCopyPlatform)) setActiveCopyPlatform(selectedPlatforms[0]);
  }, [activeCopyPlatform, selectedPlatforms]);

  const chooseFile = (nextFile: File | null) => {
    setMessage(null);
    if (nextFile && !nextFile.type.startsWith('image/') && !nextFile.type.startsWith('video/')) {
      setMessage({ type: 'error', text: 'Choose one image or video file.' });
      return;
    }
    if (nextFile && postFormat && !nextFile.type.startsWith(`${postFormat}/`)) {
      setMessage({ type: 'error', text: `Choose a ${postFormat} file for the selected format.` });
      return;
    }
    setFile(nextFile);
    setAdditionalFiles([]);
    setRightsConfirmed(false);
    serverSubmissionId.current = crypto.randomUUID();
    serverUploadedMedia.current = null;
  };

  const chooseFiles = (nextFiles: File[]) => {
    setMessage(null);
    if (nextFiles.length > 10) {
      setMessage({ type: 'error', text: 'Instagram carousels support up to 10 images or videos.' });
      return;
    }
    const invalid = nextFiles.find(nextFile => !nextFile.type.startsWith('image/') && !nextFile.type.startsWith('video/'));
    if (invalid) {
      setMessage({ type: 'error', text: `${invalid.name} is not an image or video.` });
      return;
    }
    if (postFormat && nextFiles.some(nextFile => !nextFile.type.startsWith(`${postFormat}/`))) {
      setMessage({ type: 'error', text: `Choose only ${postFormat} files for this carousel.` });
      return;
    }
    setFile(nextFiles[0] ?? null);
    setAdditionalFiles(nextFiles.slice(1));
    setRightsConfirmed(false);
    serverSubmissionId.current = crypto.randomUUID();
    serverUploadedMedia.current = null;
  };

  const chooseFormat = (nextFormat: PostFormat) => {
    setMessage(null);
    setPostFormat(nextFormat);
    setFile(null);
    setAdditionalFiles([]);
    setRightsConfirmed(false);
    serverSubmissionId.current = crypto.randomUUID();
    serverUploadedMedia.current = null;
    if (nextFormat !== 'video') setTitle('');
  };

  const toggleAccount = (accountId: string) => {
    setSelectedAccountIds(current => current.includes(accountId)
      ? current.filter(id => id !== accountId)
      : [...current, accountId]);
  };

  const togglePlatform = (platform: Platform) => {
    const platformAccountIds = enabledAccounts
      .filter(account => account.platform === platform && eligibility[platform].allowed)
      .map(account => account.id);
    if (!platformAccountIds.length) return;
    setSelectedAccountIds(current => {
      const allSelected = platformAccountIds.every(accountId => current.includes(accountId));
      return allSelected
        ? current.filter(accountId => !platformAccountIds.includes(accountId))
        : [...new Set([...current, ...platformAccountIds])];
    });
  };

  const openPlatformCopy = (platform: Platform, mode: ComposerCopyMode) => {
    setActiveCopyPlatform(platform);
    setCopyMode(mode);
    if (mode === 'edit' && platformDescriptions[platform] === undefined) {
      setPlatformDescriptions(current => ({ ...current, [platform]: description }));
    }
  };

  const updateSharedSchedule = (patch: Partial<ComposerScheduleDraft>) => {
    setSharedSchedule(current => ({ ...current, ...patch }));
  };

  const toggleOverride = (accountId: string) => {
    setScheduleOverrides(current => {
      if (current[accountId]) {
        const next = { ...current };
        delete next[accountId];
        return next;
      }
      return { ...current, [accountId]: { ...sharedSchedule } };
    });
  };

  const updateOverride = (accountId: string, patch: Partial<ComposerScheduleDraft>) => {
    setScheduleOverrides(current => ({
      ...current,
      [accountId]: { ...(current[accountId] ?? sharedSchedule), ...patch },
    }));
  };

  const resetComposer = () => {
    setPostFormat(null);
    setFile(null);
    setAdditionalFiles([]);
    setTitle('');
    setYoutubeAudience('');
    setYoutubeVisibility('');
    setDescription('');
    setPlatformDescriptions({});
    setCopyMode('preview');
    setSelectedAccountIds([]);
    setRightsConfirmed(false);
    setPendingPreflightWarnings([]);
    setScheduleOverrides({});
    setSharedSchedule(emptyComposerSchedule());
    serverSubmissionId.current = crypto.randomUUID();
    serverUploadedMedia.current = null;
  };

  const submit = async (confirmWarnings = false) => {
    setMessage(null);
    if (!postFormat) return setMessage({ type: 'error', text: 'Choose an image, video, or text post format.' });
    if (postFormat !== 'text' && !file) return setMessage({ type: 'error', text: `Choose one ${postFormat} file.` });
    if (postFormat !== 'text' && !rightsConfirmed) return setMessage({ type: 'error', text: 'Confirm that you own this media or have permission to publish it.' });
    if (selectedNeedsTitle && !title.trim()) return setMessage({ type: 'error', text: handoffOnly ? 'Enter a video title.' : 'Enter a YouTube title.' });
    if (!description.trim()) return setMessage({ type: 'error', text: postFormat === 'text' ? 'Write your post text.' : 'Enter a post description.' });
    if (handoffOnly) {
      if (!selectedAccounts.length) return setMessage({ type: 'error', text: 'Choose at least one compatible publishing account.' });
      setSubmitting(true);
      try {
        await api.createSubmission({
          postFormat,
          file,
          title: selectedNeedsTitle ? title.trim() : '',
          description: description.trim(),
          rightsConfirmed,
          destinations: selectedAccounts.map(account => ({ accountId: account.id })),
          confirmWarnings,
        });
        resetComposer();
        setMessage({ type: 'success', text: 'Saved and sent to the scheduler. This submission remains available after you sign out.' });
        onCreated();
      } catch (error) {
        if (error instanceof ContentPreflightApiError && error.code === 'CONTENT_PREFLIGHT_WARNINGS') {
          const warnings = [...new Set(error.issues.map(issue => issue.message))];
          setPendingPreflightWarnings(warnings);
          setMessage({ type: 'warning', text: `Review before continuing: ${warnings.join(' ')}` });
        } else {
          setPendingPreflightWarnings([]);
          setMessage({ type: 'error', text: error instanceof Error ? error.message : 'The content could not be handed to scheduling.' });
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (!selectedAccounts.length) return setMessage({ type: 'error', text: 'Choose at least one compatible publishing account.' });
    const invalidAccount = selectedAccounts.find(account => !eligibility[account.platform].allowed);
    if (invalidAccount) return setMessage({ type: 'error', text: `${platformLabels[invalidAccount.platform]} is not compatible with the current post.` });

    if (canSchedule) {
      const sharedError = scheduleDraftError(sharedSchedule, schedules);
      if (sharedError) return setMessage({ type: 'error', text: `Shared timing: ${sharedError}` });
      for (const account of selectedAccounts) {
        const override = scheduleOverrides[account.id];
        if (!override) continue;
        const overrideError = scheduleDraftError(override, schedules);
        if (overrideError) return setMessage({ type: 'error', text: `${account.displayName}: ${overrideError}` });
      }
    }

    for (const platform of selectedPlatforms) {
      const error = platformDescriptionError(platform, effectivePlatformDescription(platform, description, platformDescriptions));
      if (error) return setMessage({ type: 'error', text: `${platformLabels[platform]}: ${error}` });
    }

    const destinations: UnifiedPostDestinationInput[] = selectedAccounts.map(account => ({
      accountId: account.id,
      description: effectivePlatformDescription(account.platform, description, platformDescriptions),
      ...(canSchedule ? destinationSchedule(scheduleOverrides[account.id] ?? sharedSchedule) : {}),
    }));

    const serverDestinations = destinations.filter(destination => {
      const account = selectedAccounts.find(item => item.id === destination.accountId);
      return account && accountPublishingEngine(account) === 'server_worker';
    });
    const centralDestinations = destinations.filter(destination => !serverDestinations.includes(destination));
    if (serverDestinations.length && centralDestinations.length) {
      return setMessage({ type: 'error', text: 'Choose only Server Worker accounts for website publishing.' });
    }
    if (!serverDestinations.length && additionalFiles.length) {
      return setMessage({ type: 'error', text: 'Multiple files currently require a server-managed Instagram account.' });
    }
    if (serverDestinations.length) {
      const serverAccounts = serverDestinations.map(destination => selectedAccounts.find(item => item.id === destination.accountId)!);
      if (postFormat === 'text' && serverAccounts.some(account => !['facebook', 'x', 'linkedin', 'youtube'].includes(account.platform))) {
        return setMessage({ type: 'error', text: 'Server text-only publishing is currently available for Facebook, X, LinkedIn, and YouTube Community.' });
      }
      if (postFormat !== 'text' && !file) {
        return setMessage({ type: 'error', text: 'Choose at least one image or video file.' });
      }
      if (additionalFiles.length && serverAccounts.some(account => account.platform !== 'instagram')) {
        return setMessage({ type: 'error', text: 'Carousel posts currently require only server-managed Instagram accounts.' });
      }
      const youtubeVideoSelected = postFormat === 'video' && serverAccounts.some(account => account.platform === 'youtube');
      if (youtubeVideoSelected && (!title.trim() || !youtubeAudience || !youtubeVisibility)) {
        return setMessage({ type: 'error', text: 'Choose the YouTube title, audience, and visibility before publishing a video.' });
      }
      if (serverDestinations.some(destination => destination.scheduleId)) {
        return setMessage({ type: 'error', text: 'Server worker accounts currently support Publish now or an exact date and time, not schedule templates.' });
      }
      try {
        await Promise.all(selectedFiles.map(selectedFile => validateServerMedia(selectedFile, serverAccounts.map(account => account.platform))));
      } catch (validationError) {
        return setMessage({ type: 'error', text: validationError instanceof Error ? validationError.message : 'The server media is invalid.' });
      }
      const scheduledCount = serverDestinations.filter(destination => destination.scheduledAt).length;
      const authorized = window.confirm(
        scheduledCount === serverDestinations.length && scheduledCount > 0
          ? `Schedule ${serverDestinations.length} ${serverDestinations.length === 1 ? 'post' : 'posts'} on the server? The server will perform the final publish action at the selected time.`
          : `Publish to ${serverDestinations.length} server-managed ${serverDestinations.length === 1 ? 'account' : 'accounts'} now? This authorizes one final publish action per account.`,
      );
      if (!authorized) return setMessage({ type: 'warning', text: 'Server publishing was not authorized. Nothing was queued.' });

      setSubmitting(true);
      try {
        const cached = serverUploadedMedia.current;
        const uploadedMedia = cached
          && cached.files.length === selectedFiles.length
          && cached.files.every((cachedFile, index) => cachedFile === selectedFiles[index])
          ? cached.media
          : await Promise.all(selectedFiles.map(async selectedFile => (await api.uploadServerAutomationMedia(selectedFile)).media));
        serverUploadedMedia.current = { files: selectedFiles, media: uploadedMedia };
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        await Promise.all(serverDestinations.map(destination => api.createServerAutomationJob({
          accountId: destination.accountId,
          scheduledAt: destination.scheduledAt || new Date(Date.now() - 1_000).toISOString(),
          originalTimezone: timezone,
          caption: destination.description || description.trim(),
          media: uploadedMedia.map(uploaded => ({
            storageKey: uploaded.storageKey,
            fileName: uploaded.fileName,
            mimeType: uploaded.mimeType,
          })),
          ...(selectedAccounts.find(item => item.id === destination.accountId)?.platform === 'youtube' && postFormat === 'video'
            ? { platformOptions: { youtube: { title: title.trim(), audience: youtubeAudience as 'made_for_kids' | 'not_made_for_kids', visibility: youtubeVisibility as 'public' | 'unlisted' | 'private' } } }
            : {}),
          idempotencyKey: `dashboard-${serverSubmissionId.current}-${destination.accountId}`,
        })));
        resetComposer();
        setMessage({
          type: 'success',
          text: scheduledCount
            ? `${serverDestinations.length} server ${serverDestinations.length === 1 ? 'post was' : 'posts were'} scheduled.`
            : `${serverDestinations.length} server ${serverDestinations.length === 1 ? 'post was' : 'posts were'} queued for publishing.`,
        });
        onCreated();
      } catch (serverError) {
        setMessage({ type: 'error', text: serverError instanceof Error ? serverError.message : 'The server post could not be queued.' });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      const safety = await api.assessPublishingSafety(postFormat, destinations);
      await api.authorizePublishing();
      const created = await api.createUnifiedPost({
        postFormat,
        file,
        title: selectedNeedsTitle ? title.trim() : '',
        description: description.trim(),
        destinations,
        rightsConfirmed,
        confirmWarnings,
      });
      const channelCount = new Set(created.map(upload => upload.platform)).size;
      const immediateUploads = created.filter(upload => !upload.scheduledAt && !upload.scheduleId && !upload.safetyDeferredUntil);
      const safetyWaitCount = safety.issues.length;
      const safetyWaitNote = safetyWaitCount
        ? ` ${safetyWaitCount} ${safetyWaitCount === 1 ? 'destination is' : 'destinations are'} waiting automatically for the next safe publishing window.`
        : '';
      let publishingError = '';
      if (canPublishNow && immediateUploads.length > 0) {
        try {
          await api.runAutomation(immediateUploads.map(upload => upload.id));
        } catch (error) {
          publishingError = error instanceof Error ? error.message : 'Publisher automation could not start.';
        }
      }
      resetComposer();
      if (publishingError) {
        setMessage({ type: 'error', text: `${created.length} destination ${created.length === 1 ? 'was' : 'were'} saved, but publishing could not start: ${publishingError}` });
      } else if (canPublishNow && immediateUploads.length > 0) {
        const scheduledCount = created.length - immediateUploads.length;
        setMessage({
          type: 'success',
          text: `Publishing started for ${immediateUploads.length} ${immediateUploads.length === 1 ? 'post' : 'posts'} across ${channelCount} ${channelCount === 1 ? 'app' : 'apps'}${scheduledCount ? `; ${scheduledCount} scheduled ${scheduledCount === 1 ? 'post remains' : 'posts remain'} queued` : ''}.${safetyWaitNote}`,
        });
      } else {
        setMessage({ type: 'success', text: `${created.length} ${created.length === 1 ? 'post' : 'destination posts'} queued across ${channelCount} ${channelCount === 1 ? 'app' : 'apps'}.${safetyWaitNote}` });
      }
      onCreated();
    } catch (error) {
      if (error instanceof PublishingSafetyApiError) {
        setPendingPreflightWarnings([]);
        setMessage({ type: 'warning', text: `Choose a safer time: ${error.issues.map(issue => issue.message).join(' ') || error.message}` });
      } else if (error instanceof ContentPreflightApiError && error.code === 'CONTENT_PREFLIGHT_WARNINGS') {
        const warnings = [...new Set(error.issues.map(issue => issue.message))];
        setPendingPreflightWarnings(warnings);
        setMessage({ type: 'warning', text: `Review before publishing: ${warnings.join(' ')}` });
      } else {
        setPendingPreflightWarnings([]);
        setMessage({ type: 'error', text: error instanceof Error ? error.message : 'The post could not be created.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className='unified-composer' aria-labelledby='unified-composer-heading'>
      <header className='unified-composer-heading'>
        <div><p className='section-kicker'>{handoffOnly ? 'Content handoff' : 'Universal post'}</p><h1 id='unified-composer-heading'>{handoffOnly ? 'Prepare content for scheduling.' : 'Create once. Publish everywhere it fits.'}</h1><span>{handoffOnly ? 'Upload the finished content and choose its destination accounts. The scheduler only assigns the publishing time.' : 'Choose a format, tailor the content, and send it to every compatible account from one controlled workflow.'}</span></div>
        <div className='composer-progress' aria-label='Post creation steps'><span className={contentReady ? 'done' : 'active'}>1<i>Content</i></span><span className={handoffOnly ? contentReady ? 'active' : '' : contentReady && selectedAccounts.length ? 'done' : contentReady ? 'active' : ''}>2<i>{handoffOnly ? 'Handoff' : 'Destinations'}</i></span>{!handoffOnly && <span className={selectedAccounts.length ? 'active' : ''}>3<i>Timing</i></span>}</div>
      </header>

      <div className='composer-content-grid'>
        <div className='composer-input-column'>
          <div className='composer-format-picker'>
            <div className='composer-format-heading'><span><small className='section-kicker'>Post format</small><strong>What are you publishing?</strong></span>{postFormat && <small>Selected: {postFormat}</small>}</div>
            <div className='composer-format-options' role='group' aria-label='Choose post format'>
              {composerFormatOptions.map(option => <button type='button' key={option.id} className={postFormat === option.id ? 'selected' : ''} aria-pressed={postFormat === option.id} onClick={() => chooseFormat(option.id)}>
                <span>{option.icon}</span><strong>{option.label}</strong><small>{option.detail}</small>{postFormat === option.id && <i><Check size={13} /></i>}
              </button>)}
            </div>
          </div>

          {postFormat && <div key={postFormat} className={`composer-format-stage format-${postFormat}`}>
            {postFormat !== 'text' && <div
              className={`composer-upload ${dragActive ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
              onDragEnter={event => { event.preventDefault(); setDragActive(true); }}
              onDragOver={event => event.preventDefault()}
              onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
              onDrop={event => { event.preventDefault(); setDragActive(false); chooseFiles([...event.dataTransfer.files]); }}
            >
              <input id='unified-post-file' type='file' multiple accept={`${postFormat}/*`} onChange={event => chooseFiles([...(event.target.files ?? [])])} />
              {file && previewUrl ? <div className='composer-media-preview'>
                {postFormat === 'video' ? <video src={previewUrl} muted controls playsInline /> : <img src={previewUrl} alt='Selected post media' />}
                <button type='button' aria-label='Remove selected media' onClick={() => chooseFile(null)}><X size={16} /></button>
                <span>{postFormat === 'video' ? <Video size={15} /> : <ImageIcon size={15} />}<strong>{selectedFiles.length > 1 ? `${selectedFiles.length} carousel items` : file.name}</strong><small>{selectedFiles.length > 1 ? `${formatComposerFileSize(selectedFiles.reduce((total, item) => total + item.size, 0))} total` : formatComposerFileSize(file.size)}</small></span>
              </div> : <label htmlFor='unified-post-file'><Upload size={25} /><strong>Drop up to 10 {postFormat} files here</strong><span>Choose multiple files for an Instagram carousel</span><small>Large files are transferred in secure 4 MB chunks</small></label>}
            </div>}

            {showYoutubeTitle && <label className='composer-field'><span>{handoffOnly ? 'Video title' : 'YouTube title'} <small>{title.length}/100</small></span><input value={title} onChange={event => setTitle(event.target.value)} placeholder={handoffOnly ? 'Required so every supported app remains available' : 'Required only when YouTube is selected'} maxLength={100} /></label>}
            {youtubeVideoSelected && !handoffOnly && <>
              <label className='composer-field'><span>YouTube audience <small>Required for COPPA compliance</small></span><select value={youtubeAudience} onChange={event => setYoutubeAudience(event.target.value as typeof youtubeAudience)} required><option value=''>Choose audience…</option><option value='not_made_for_kids'>No, it is not made for kids</option><option value='made_for_kids'>Yes, it is made for kids</option></select></label>
              <label className='composer-field'><span>YouTube visibility <small>No default is assumed</small></span><select value={youtubeVisibility} onChange={event => setYoutubeVisibility(event.target.value as typeof youtubeVisibility)} required><option value=''>Choose visibility…</option><option value='private'>Private</option><option value='unlisted'>Unlisted</option><option value='public'>Public</option></select></label>
            </>}
            <label className={`composer-field ${postFormat === 'text' ? 'composer-text-field' : ''}`}>
              <span>{postFormat === 'text' ? 'Post text' : 'Description'} <small>{description.length} characters</small></span>
              <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder={postFormat === 'text' ? 'Write the text you want to publish…' : 'Default caption for all apps. YouTube uses this as the video description.'} rows={postFormat === 'text' ? 10 : 6} />
              {postFormat === 'text' && <small className='composer-text-support'><CircleCheckBig size={13} />Available for X, Facebook, LinkedIn, and YouTube Community. Instagram is excluded.</small>}
            </label>
            {postFormat !== 'text' && <label className='composer-rights-confirmation'><input type='checkbox' checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} /><ShieldCheck size={16} /><span><strong>Media rights confirmed</strong><small>I own this media or have permission to publish it.</small></span></label>}
          </div>}

          {!postFormat && <div className='composer-format-prompt'><span><ArrowRight size={18} /></span><div><strong>Select a format to continue</strong><small>The composer will reveal only the fields and channels that apply.</small></div></div>}
        </div>

        <div className='composer-destination-column'>
          <div className='composer-section-title composer-channel-title'><span><small className='section-kicker'>Channel control</small><strong>Publishing channels</strong><small>Choose accounts, edit app text, and preview before creating destinations.</small></span><span className='composer-selected-count'>{selectedAccounts.length} selected</span></div>
          <div className='composer-platform-grid'>
            {platforms.map(platform => {
              const state = eligibility[platform];
              const platformAccounts = enabledAccounts.filter(account => account.platform === platform);
              const selectedCount = platformAccounts.filter(account => selectedAccountIds.includes(account.id)).length;
              const selectable = state.allowed && platformAccounts.length > 0;
              const activePanel = selectedCount > 0 && activeCopyPlatform === platform;
              const platformText = effectivePlatformDescription(platform, description, platformDescriptions);
              const textError = platformDescriptionError(platform, platformText);
              return <article key={platform} data-platform={platform} className={`composer-platform-card platform-${platform} ${state.allowed ? 'compatible' : 'incompatible'} ${selectedCount ? 'selected' : ''} ${activePanel ? 'expanded' : ''}`}>
                <button type='button' className='composer-platform-toggle' disabled={!selectable} onClick={() => togglePlatform(platform)}>
                  <span className='composer-platform-logo'><CustomIcon platform={platform} size={27} /></span>
                  <span><strong>{platformLabels[platform]}</strong><small>{state.reason}</small></span>
                  <i>{selectedCount ? <Check size={14} /> : state.allowed ? platformAccounts.length : '—'}</i>
                </button>
                {state.allowed && platformAccounts.length > 0 && <div className='composer-account-choices'>
                  {platformAccounts.map(account => <label key={account.id} className={accountConnectionLabel(account) === 'Ready' ? 'session-ready' : 'session-required'}><input type='checkbox' checked={selectedAccountIds.includes(account.id)} onChange={() => toggleAccount(account.id)} /><span><strong>{account.displayName}</strong><small>{account.handle} · {publishingEngineLabels[accountPublishingEngine(account)]} · {accountConnectionLabel(account)}</small></span></label>)}
                </div>}
                {state.allowed && platformAccounts.length === 0 && <div className='composer-no-account'><span>No enabled account</span>{canManageAccounts && <button type='button' onClick={() => onOpenAccounts(platform)}>Open Config Manager</button>}</div>}
                <div className='composer-platform-tools'>{!handoffOnly && <button type='button' disabled={!selectedCount} className={activePanel && copyMode === 'edit' ? 'active' : ''} onClick={() => selectedCount && openPlatformCopy(platform, 'edit')}><Pencil size={14} />Edit text</button>}<button type='button' disabled={!selectedCount} className={activePanel && copyMode === 'preview' ? 'active' : ''} onClick={() => selectedCount && openPlatformCopy(platform, 'preview')}><Eye size={14} />Preview</button></div>
                {activePanel && <div className={`composer-platform-panel ${copyMode}`}>
                  {copyMode === 'edit' ? <label className={`composer-platform-copy ${textError ? 'error' : ''}`}><span><strong>{platformLabels[platform]} {postFormat === 'text' ? 'post text' : 'description'}</strong><small>{platformText.length}/{platformPostRules[platform].descriptionLimit.toLocaleString()}</small></span><textarea value={platformDescriptions[platform] ?? description} onChange={event => setPlatformDescriptions(current => ({ ...current, [platform]: event.target.value }))} rows={5} />{platformDescriptions[platform] !== undefined && <button type='button' onClick={() => setPlatformDescriptions(current => { const next = { ...current }; delete next[platform]; return next; })}>Use default {postFormat === 'text' ? 'post text' : 'description'}</button>}{textError && <em>{textError}</em>}</label> : <div className='composer-card-preview'><PolishedComposerPreview platform={platform} file={file} previewUrl={previewUrl} title={title} description={platformText} postFormat={postFormat ?? 'image'} /></div>}
                </div>}
              </article>;
            })}
          </div>
        </div>
      </div>

      <div className='composer-timing'>
        <div className='composer-section-title'><span><strong>Publishing time</strong><small>Use one setting for every destination, then override only where needed.</small></span><Clock3 size={20} /></div>
        {canSchedule ? <>
          <div className='composer-shared-schedule'>
            <label><span>Shared timing</span><select value={sharedSchedule.mode} onChange={event => updateSharedSchedule({ mode: event.target.value as ComposerScheduleMode })}><option value='now'>Add to queue now</option><option value='exact'>Exact date and time</option><option value='template'>Schedule template</option></select></label>
            {sharedSchedule.mode === 'exact' && <label><span>Date and time</span><input type='datetime-local' min={toLocalDateTimeInputValue(new Date(Date.now() + 60_000))} value={sharedSchedule.exactAt} onChange={event => updateSharedSchedule({ exactAt: event.target.value })} /></label>}
            {sharedSchedule.mode === 'template' && <label><span>Template</span><select value={sharedSchedule.scheduleId} onChange={event => updateSharedSchedule({ scheduleId: event.target.value })}><option value=''>Choose schedule</option>{activeSchedules.map(schedule => <option key={schedule.id} value={schedule.id}>{schedule.name} · {scheduleFrequencyLabels[schedule.frequency]} at {schedule.time}</option>)}</select></label>}
          </div>
          {selectedAccounts.length > 0 && <div className='composer-destination-timing'>
            {selectedAccounts.map(account => {
              const override = scheduleOverrides[account.id];
              return <article key={account.id}>
                <div className='composer-destination-account'><CustomIcon platform={account.platform} size={21} /><span><strong>{account.displayName}</strong><small>{publishingEngineLabels[accountPublishingEngine(account)]} · {override ? 'Custom timing' : 'Uses shared timing'}</small></span></div>
                <label className='composer-override-toggle'><input type='checkbox' checked={Boolean(override)} onChange={() => toggleOverride(account.id)} /><SlidersHorizontal size={14} />Override</label>
                {override && <div className='composer-override-fields'><select value={override.mode} onChange={event => updateOverride(account.id, { mode: event.target.value as ComposerScheduleMode })}><option value='now'>Queue now</option><option value='exact'>Exact time</option><option value='template'>Template</option></select>{override.mode === 'exact' && <input type='datetime-local' min={toLocalDateTimeInputValue(new Date(Date.now() + 60_000))} value={override.exactAt} onChange={event => updateOverride(account.id, { exactAt: event.target.value })} />}{override.mode === 'template' && <select value={override.scheduleId} onChange={event => updateOverride(account.id, { scheduleId: event.target.value })}><option value=''>Choose schedule</option>{activeSchedules.map(schedule => <option key={schedule.id} value={schedule.id}>{schedule.name} · {schedule.time}</option>)}</select>}</div>}
              </article>;
            })}
          </div>}
        </> : <div className='composer-role-note'><TimerReset size={18} /><span><strong>{handoffOnly ? 'Selected destinations are locked for the scheduler.' : 'Posts will enter the queue immediately.'}</strong><small>{handoffOnly ? 'Your upload and destination accounts are saved together; the scheduler only chooses when they publish.' : 'Your role can prepare content; a scheduler can assign publishing times afterward.'}</small></span></div>}
      </div>

      <footer className='composer-footer'>
        <div>{message && <p className={`composer-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.type === 'success' ? <CircleCheckBig size={17} /> : <CircleAlert size={17} />}{message.text}</p>}</div>
        <button type='button' className='composer-publish-button' disabled={submitting || !contentReady || !selectedAccounts.length} onClick={() => void submit(pendingPreflightWarnings.length > 0)}>{submitting ? <Loader2 className='spin' size={18} /> : pendingPreflightWarnings.length ? <ShieldCheck size={18} /> : <Send size={18} />}{submitting ? 'Preparing posts…' : pendingPreflightWarnings.length ? 'Confirm and continue' : handoffOnly ? `Send ${selectedAccounts.length || ''} ${selectedAccounts.length === 1 ? 'destination' : 'destinations'} to scheduler` : canPublishNow ? `Publish to ${selectedAccounts.length || ''} ${selectedAccounts.length === 1 ? 'destination' : 'destinations'}` : `Create ${selectedAccounts.length || ''} ${selectedAccounts.length === 1 ? 'destination' : 'destinations'}`}</button>
      </footer>
    </section>
  );
}

type ServerBrowserInput =
  | { type: 'click'; x: number; y: number; button: 'left' | 'middle' | 'right' }
  | { type: 'key'; key: string }
  | { type: 'text'; text: string }
  | { type: 'wheel'; deltaX: number; deltaY: number };

function ServerLoginBrowser({
  initialSession,
  accountName,
  onClose,
  onConnected,
}: {
  initialSession: ServerAutomationLoginSession;
  accountName: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [session, setSession] = useState(initialSession);
  const [frameUrl, setFrameUrl] = useState('');
  const [error, setError] = useState('');
  const [clickFeedback, setClickFeedback] = useState<{ id: number; left: number; top: number } | null>(null);
  const inputQueue = useRef(Promise.resolve());
  const inputBuffer = useRef<ServerBrowserInput[]>([]);
  const inputTimer = useRef<number | undefined>(undefined);
  const clickTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await api.serverAutomationLoginSession(initialSession.id);
        if (!active) return;
        setSession(result.session);
        if (result.session.state === 'CONNECTED') {
          onConnected();
          return;
        }
        if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(result.session.state)) return;
        timer = window.setTimeout(poll, 750);
      } catch (pollError) {
        if (active) setError(pollError instanceof Error ? pollError.message : 'Login status could not be loaded.');
      }
    };
    void poll();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [initialSession.id, onConnected]);

  useEffect(() => {
    if (!['STARTING', 'AWAITING_USER'].includes(session.state)) return;
    let active = true;
    let timer: number | undefined;
    let objectUrl = '';
    const pollFrame = async () => {
      try {
        const blob = await api.serverAutomationLoginFrame(initialSession.id);
        if (!active) return;
        const nextUrl = URL.createObjectURL(blob);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = nextUrl;
        setFrameUrl(nextUrl);
      } catch {
        // The browser can be between frames while starting or closing.
      }
      if (active) timer = window.setTimeout(pollFrame, 250);
    };
    void pollFrame();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [initialSession.id, session.state]);

  const enqueueInputBatch = useCallback((inputs: ServerBrowserInput[]) => {
    if (!inputs.length) return;
    inputQueue.current = inputQueue.current
      .then(() => api.sendServerAutomationLoginInputs(initialSession.id, inputs))
      .catch(inputError => setError(inputError instanceof Error ? inputError.message : 'Browser input could not be forwarded.'));
  }, [initialSession.id]);

  const flushInputBuffer = useCallback(() => {
    if (inputTimer.current) window.clearTimeout(inputTimer.current);
    inputTimer.current = undefined;
    const inputs = inputBuffer.current.splice(0, 32);
    enqueueInputBatch(inputs);
    if (inputBuffer.current.length) inputTimer.current = window.setTimeout(flushInputBuffer, 0);
  }, [enqueueInputBatch]);

  const sendInput = useCallback((input: ServerBrowserInput, flushNow = false) => {
    const last = inputBuffer.current.at(-1);
    if (input.type === 'text' && last?.type === 'text' && last.text.length + input.text.length <= 64) {
      last.text += input.text;
    } else {
      inputBuffer.current.push(input);
    }
    if (flushNow || inputBuffer.current.length >= 24) {
      flushInputBuffer();
    } else if (!inputTimer.current) {
      inputTimer.current = window.setTimeout(flushInputBuffer, 120);
    }
  }, [flushInputBuffer]);

  useEffect(() => () => {
    if (inputTimer.current) window.clearTimeout(inputTimer.current);
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
  }, []);

  const cancel = async () => {
    await api.cancelServerAutomationLogin(initialSession.id).catch(() => undefined);
    onClose();
  };

  return <div className='server-login-overlay' role='dialog' aria-modal='true' aria-labelledby='server-login-title'>
    <section className='server-login-panel'>
      <header><span><small>Private server browser</small><strong id='server-login-title'>Connect {accountName}</strong><em>Type directly in the browser image. AgenticThat forwards input without storing the password.</em></span><button type='button' onClick={() => void cancel()}><X size={17} />Cancel</button></header>
      <div className='server-login-state'><CircleDashed className={['STARTING', 'AWAITING_USER'].includes(session.state) ? 'spin' : ''} size={15} />{session.state.replaceAll('_', ' ')}</div>
      {frameUrl ? <div className='server-login-frame-shell'><img
        className='server-login-frame'
        src={frameUrl}
        alt='Interactive Instagram login browser running on the server'
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
          sendInput({
            type: 'click',
            x: (left / 100) * image.naturalWidth,
            y: (top / 100) * image.naturalHeight,
            button: 'left',
          }, true);
        }}
        onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
          const special: Record<string, string> = {
            Tab: 'Tab', Enter: 'Enter', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete',
            ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
            Home: 'Home', End: 'End', ' ': 'Space',
          };
          if (special[event.key]) {
            event.preventDefault();
            sendInput({ type: 'key', key: special[event.key] }, true);
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            sendInput({ type: 'text', text: event.key });
          }
        }}
        onPaste={event => {
          event.preventDefault();
          const value = event.clipboardData.getData('text');
          const chunks = Array.from({ length: Math.ceil(value.length / 64) }, (_, index) => value.slice(index * 64, (index + 1) * 64));
          chunks.forEach((text, index) => sendInput({ type: 'text', text }, index === chunks.length - 1));
        }}
        onWheel={event => {
          event.preventDefault();
          sendInput({ type: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY });
        }}
      />{clickFeedback && <span className='server-login-click-feedback' style={{ left: `${clickFeedback.left}%`, top: `${clickFeedback.top}%` }} aria-hidden='true' />}</div> : <div className='server-login-loading'><Loader2 className='spin' size={24} /><span>Starting the isolated Instagram browser…</span></div>}
      {(error || session.errorMessage) && <p className='server-worker-error' role='alert'>{error || session.errorMessage}</p>}
    </section>
  </div>;
}

function ServerWorkerPanel({
  overview,
  error,
  onChanged,
}: {
  overview: ServerAutomationOverview | null;
  error: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const accounts = overview?.accounts ?? [];
  const accountNames = useMemo(() => new Map(accounts.map(account => [account.id, account.displayName])), [accounts]);

  const cancelJob = async (jobId: string) => {
    setBusy(jobId);
    setNotice('');
    try {
      await api.cancelServerAutomationJob(jobId);
      setNotice('Scheduled server post cancelled.');
      onChanged();
    } catch (actionError) {
      setNotice(actionError instanceof Error ? actionError.message : 'The scheduled post could not be cancelled.');
    } finally {
      setBusy('');
    }
  };

  return <section className='server-worker-panel' aria-labelledby='server-worker-heading'>
    <header>
      <span><MonitorCheck size={21} /></span>
      <div><p className='section-kicker'>Website-only publishing beta</p><h2 id='server-worker-heading'>Server publishing worker</h2><small>{overview ? `${overview.health.livePublishingWorkerCount} workers online · ${accounts.filter(account => account.status === 'CONNECTED').length} connected accounts` : 'Worker connection unavailable'}</small></div>
      <a className='server-worker-manage-link' href='/config-manager?service=publishing&platform=instagram'><Settings2 size={14} />Manage accounts</a>
      <i className={overview?.health.features.publishing ? 'online' : 'offline'}>{overview?.health.features.publishing ? 'ONLINE' : 'OFFLINE'}</i>
    </header>
    {error && <p className='server-worker-error' role='alert'>{error}</p>}
    {overview && <>
      {notice && <p className='server-worker-notice' role='status'>{notice}</p>}
      <div className='server-worker-jobs'>
        <strong>Recent server jobs</strong>
        {overview.jobs.length ? overview.jobs.slice(0, 8).map(job => <article key={job.id}>
          <span><strong>{accountNames.get(job.accountId) || `${platformLabels[job.platform]} account`}</strong><small>{new Date(job.scheduledAt).toLocaleString()} · {job.caption || job.media[0]?.fileName}</small>{(job.errorMessage || job.progressMessage) && <em>{job.errorMessage || job.progressMessage}</em>}</span>
          <i className={`state-${job.state.toLowerCase()}`}>{job.state.replaceAll('_', ' ')}</i>
          {job.state === 'SCHEDULED' && <button type='button' disabled={busy === job.id} onClick={() => void cancelJob(job.id)}><X size={13} />Cancel</button>}
        </article>) : <p className='server-worker-empty'>No server publishing jobs yet. Connected accounts appear in the composer below.</p>}
      </div>
    </>}
  </section>;
}

function Workboard({
  user,
  permissions,
  uploads,
  submissions,
  accounts,
  schedules,
  connectionMode,
  users,
  activityLogs,
  loading,
  error,
  isRunning,
  onRun,
  onStop,
  onRefresh,
  onSignOut,
  onOpenAccounts,
  onOpenSchedules,
  onOpenUsers,
  onOpenActivity,
  onEdit,
  editingUpload,
  onCloseEdit,
  onCreated,
  onScheduleSubmission,
  serverAutomation,
  serverAutomationError,
  onServerAutomationChanged,
}: {
  user: UserProfile;
  permissions: RolePermissions;
  uploads: PlatformUpload[];
  submissions: ContentSubmission[];
  accounts: PlatformAccount[];
  schedules: PublishingSchedule[];
  connectionMode: 'central' | 'desktop' | 'extension' | 'direct' | 'checking';
  users: UserProfile[];
  activityLogs: ActivityLog[];
  loading: boolean;
  error: string | null;
  isRunning: boolean;
  onRun: () => void;
  onStop: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onOpenAccounts: (platform: Platform) => void;
  onOpenSchedules: () => void;
  onOpenUsers: () => void;
  onOpenActivity: () => void;
  onEdit: (upload: PlatformUpload) => void;
  editingUpload: PlatformUpload | null;
  onCloseEdit: () => void;
  onCreated: () => void;
  onScheduleSubmission: (submission: ContentSubmission) => void;
  serverAutomation: ServerAutomationOverview | null;
  serverAutomationError: string | null;
  onServerAutomationChanged: () => void;
}) {
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(() => toLocalDayKey(new Date()));
  const [activeView, setActiveView] = useState('overview');
  const [schedulePlatform, setSchedulePlatform] = useState<Platform | null>(null);
  const accountById = useMemo(() => new Map(accounts.map(account => [account.id, account])), [accounts]);
  const metrics = useMemo(() => {
    const posted = uploads.filter(upload => upload.status === 'posted').length;
    const failed = uploads.filter(upload => upload.status === 'failed').length;
    const queued = uploads.filter(upload => upload.status === 'queued').length;
    const scheduled = uploads.filter(upload => upload.status === 'queued' && upload.scheduledAt).length;
    return { posted, failed, queued, scheduled, total: uploads.length };
  }, [uploads]);

  const eventByDay = useMemo(() => {
    const events: Record<string, PlatformUpload[]> = {};
    uploads.forEach(upload => {
      const dayKey = toLocalDayKey(getAuditTimestamp(upload));
      if (!dayKey) return;
      events[dayKey] ??= [];
      events[dayKey].push(upload);
    });
    Object.values(events).forEach(dayEvents => dayEvents.sort((a, b) => Date.parse(getAuditTimestamp(b)) - Date.parse(getAuditTimestamp(a))));
    return events;
  }, [uploads]);

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const offset = new Date(year, month, 1).getDay();
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(year, month, index - offset + 1);
      const dayKey = toLocalDayKey(date);
      return { date, dayKey, currentMonth: date.getMonth() === month, events: eventByDay[dayKey] ?? [] };
    });
  }, [calendarMonth, eventByDay]);

  const upcoming = useMemo(() => uploads
    .filter(upload => upload.scheduledAt && upload.status !== 'posted')
    .sort((a, b) => Date.parse(a.scheduledAt ?? '') - Date.parse(b.scheduledAt ?? ''))
    .slice(0, 1), [uploads]);

  const statusMix = useMemo(() => [
    { id: 'scheduled', label: 'Scheduled', detail: 'Timed', value: uploads.filter(upload => upload.status === 'queued' && upload.scheduledAt).length, color: '#318EC2' },
    { id: 'queued', label: 'In queue', detail: 'Needs a time', value: uploads.filter(upload => upload.status === 'queued' && !upload.scheduledAt).length, color: '#B17A08' },
    { id: 'processing', label: 'Publishing', detail: 'In progress', value: uploads.filter(upload => upload.status === 'processing').length, color: '#7367D8' },
    { id: 'posted', label: 'Delivered', detail: 'Complete', value: uploads.filter(upload => upload.status === 'posted').length, color: '#14895E' },
    { id: 'failed', label: 'Review', detail: 'Needs input', value: uploads.filter(upload => upload.status === 'failed').length, color: '#C65448' },
  ], [uploads]);

  const broadcastMix = useMemo(() => platforms.map(platform => ({
    platform,
    label: platformLabels[platform],
    value: uploads.filter(upload => upload.platform === platform && upload.status === 'posted').length,
  })), [uploads]);

  const selectedEvents = eventByDay[selectedDay] ?? [];
  const monthLabel = calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const nextAction = upcoming[0];
  const statusTotal = statusMix.reduce((total, status) => total + status.value, 0);
  const reviewQueue = useMemo(() => {
    const priority: Record<PlatformUpload['status'], number> = { failed: 0, queued: 1, processing: 2, posted: 3 };
    return uploads
      .filter(upload => upload.status !== 'posted')
      .sort((a, b) => {
        const statusDiff = priority[a.status] - priority[b.status];
        if (statusDiff) return statusDiff;
        const aTime = a.scheduledAt ? Date.parse(a.scheduledAt) : Number.MAX_SAFE_INTEGER;
        const bTime = b.scheduledAt ? Date.parse(b.scheduledAt) : Number.MAX_SAFE_INTEGER;
        return aTime - bTime || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
  }, [uploads]);
  const recentDeliveries = useMemo(() => [...uploads]
    .sort((a, b) => Date.parse(b.postedAt ?? b.lastAttemptAt ?? b.updatedAt ?? b.uploadedAt) - Date.parse(a.postedAt ?? a.lastAttemptAt ?? a.updatedAt ?? a.uploadedAt))
    .slice(0, 18), [uploads]);
  const deliveredTotal = broadcastMix.reduce((total, channel) => total + channel.value, 0);
  const broadcastSegments = useMemo(() => {
    if (!deliveredTotal) return [];
    let offset = 0;
    return broadcastMix.filter(channel => channel.value > 0).map(channel => {
      const length = (channel.value / deliveredTotal) * DONUT_CIRCUMFERENCE;
      const segment = { ...channel, length, offset };
      offset += length;
      return segment;
    });
  }, [broadcastMix, deliveredTotal]);
  const trackingSummary = `${metrics.total} tracked ${metrics.total === 1 ? 'post' : 'posts'} across ${accounts.length} publishing ${accounts.length === 1 ? 'account' : 'accounts'}`;
  const canEditPosts = permissions.canRunAutomation || permissions.canSchedulePosts;
  const awaitingSubmissions = submissions.filter(submission => submission.status === 'awaiting_schedule');
  const enabledAccountsCount = accounts.filter(account => account.enabled).length;
  const activeSchedulesCount = schedules.filter(schedule => schedule.status === 'active').length;
  const accountAttentionCount = accounts.filter(account => accountHealthStatus(account) !== 'healthy').length;
  const attentionCount = reviewQueue.filter(upload => upload.status === 'failed' || (upload.status === 'queued' && !upload.scheduledAt)).length + awaitingSubmissions.length + accountAttentionCount;
  const healthyChannelCount = platforms.filter(platform => accounts.some(account => account.platform === platform && accountHealthStatus(account) === 'healthy')).length;
  const overviewCards = [
    { id: 'queue', label: 'Queue', value: metrics.queued, detail: `${metrics.scheduled} scheduled`, icon: <TimerReset size={18} />, tone: 'queue' },
    { id: 'attention', label: 'Needs action', value: attentionCount, detail: `${accountAttentionCount} account alerts`, icon: <CircleAlert size={18} />, tone: 'attention' },
    { id: 'delivered', label: 'Delivered', value: metrics.posted, detail: `${metrics.failed} failed`, icon: <CircleCheckBig size={18} />, tone: 'success' },
    { id: 'channels', label: 'Channels', value: healthyChannelCount, detail: `${enabledAccountsCount} enabled accounts`, icon: <UsersRound size={18} />, tone: 'channels' },
  ];

  const shiftCalendarMonth = (amount: number) => {
    const next = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + amount, 1);
    setCalendarMonth(next);
    setSelectedDay(toLocalDayKey(next));
  };

  const navigateWorkboard = (sectionId: string) => {
    setActiveView(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className='workboard-app'>
      <section className='workboard-shell'>
      <header className='workboard-topbar'>
        <a className='workboard-brand' href='/apps' title='Back to AgenticThat Store'><span>AT</span><div><strong>AgenticThat</strong><small>Publishing workspace</small></div></a>
        <nav className='workboard-nav' aria-label='Publishing workspace'>
          <button className={activeView === 'overview' ? 'active' : ''} onClick={() => navigateWorkboard('overview')}><Upload size={16} />Create</button>
          <button className={activeView === 'channels' ? 'active' : ''} onClick={() => navigateWorkboard('channels')}><FolderOpen size={16} />Channels</button>
          <button className={activeView === 'operations' ? 'active' : ''} onClick={() => navigateWorkboard('operations')}><ListFilter size={16} />Review <small>{reviewQueue.length + awaitingSubmissions.length}</small></button>
          <button className={activeView === 'schedule' ? 'active' : ''} onClick={() => navigateWorkboard('schedule')}><CalendarDays size={16} />Schedule</button>
        </nav>
        <div className='workboard-actions'>
          <a className='workboard-global-link' href='/config-manager?service=publishing'><Settings2 size={14} />Connections</a>
          <span className='workboard-status' title={connectionMode === 'central' ? 'Shared workspace queue with server-managed publishing accounts' : connectionMode === 'desktop' ? 'Running inside the AgenticThat Companion app' : connectionMode === 'extension' ? 'Connected through the AgenticThat Chrome extension' : 'Connected directly to the local companion'}><CircleDashed size={14} className={loading ? 'spin' : ''} />{connectionMode === 'central' ? 'Server workspace' : connectionMode === 'desktop' ? 'Companion workspace' : connectionMode === 'extension' ? 'Extension ready' : connectionMode === 'direct' ? 'Companion ready' : 'Checking'}</span>
          {permissions.canViewActivity && <button className='workboard-tool' title='Activity log' onClick={onOpenActivity}><ListFilter size={18} /></button>}
          {permissions.canRunAutomation && (isRunning
            ? <button className='workboard-stop' onClick={onStop}><X size={16} />Emergency stop</button>
            : <button className='workboard-run' onClick={onRun}><Send size={16} />Run automation</button>)}
          <button className='workboard-tool' title='Refresh workspace' onClick={onRefresh}><RefreshCw size={18} className={loading ? 'spin' : ''} /></button>
          <span className='workboard-user' title={`${user.fullName} - ${userRoleLabels[user.role]}`}>{roleInitials[user.role]}</span>
          <button className='workboard-tool signout-tool' title='Sign out' onClick={onSignOut}><LogOut size={18} /></button>
        </div>
      </header>

      {error && <div className='workspace-error' role='alert'><CircleAlert size={18} /><span><strong>Workspace data could not refresh</strong><small>{error}</small></span><button type='button' onClick={onRefresh}><RefreshCw size={14} />Retry</button></div>}

      {(serverAutomation || serverAutomationError) && <ServerWorkerPanel
        overview={serverAutomation}
        error={serverAutomationError}
        onChanged={onServerAutomationChanged}
      />}

      <section className='dashboard-overview' aria-labelledby='dashboard-overview-heading'>
        <div className='dashboard-welcome'>
          <p className='section-kicker'>Operational overview</p>
          <h1 id='dashboard-overview-heading'>Publishing workspace</h1>
          <span>{user.fullName} · {userRoleLabels[user.role]}</span>
          <div className={`dashboard-context ${attentionCount ? 'needs-attention' : 'healthy'}`}>
            {attentionCount ? <CircleAlert size={17} /> : <CircleCheckBig size={17} />}
            <span><strong>{attentionCount ? `${attentionCount} ${attentionCount === 1 ? 'item needs' : 'items need'} attention` : 'Publishing operations are clear'}</strong><small>{activeSchedulesCount} active {activeSchedulesCount === 1 ? 'schedule' : 'schedules'} · {healthyChannelCount} connected {healthyChannelCount === 1 ? 'channel' : 'channels'}</small></span>
          </div>
        </div>
        <div className='dashboard-stat-grid'>
          {overviewCards.map(card => (
            <article key={card.id} className={`dashboard-stat-card tone-${card.tone}`}>
              <span>{card.icon}</span>
              <div><strong>{card.value}</strong><small>{card.label}</small><em>{card.detail}</em></div>
            </article>
          ))}
        </div>
      </section>

      <section className='safety-control-strip' aria-labelledby='safety-controls-heading'>
        <header>
          <span><ShieldCheck size={20} /></span>
          <div><strong id='safety-controls-heading'>Publishing safeguards active</strong><small>Checks run at the stage where they matter. They reduce avoidable risk, but no browser publisher can guarantee zero platform restrictions.</small></div>
          <em>5 layers on</em>
        </header>
        <div className='safety-control-grid'>
          <article><CircleCheckBig size={15} /><span><strong>Pre-flight checks</strong><small>Before a post enters the queue</small></span></article>
          <article><TimerReset size={15} /><span><strong>Dynamic pacing</strong><small>Immediately before publishing</small></span></article>
          <article><LockKeyhole size={15} /><span><strong>One job per account</strong><small>While a browser job is active</small></span></article>
          <article><CircleAlert size={15} /><span><strong>Stop on risk</strong><small>CAPTCHA, warning, checkpoint or 429</small></span></article>
          <article><ShieldCheck size={15} /><span><strong>No blind final retry</strong><small>Unclear results require inspection</small></span></article>
        </div>
      </section>

      {!loading && accounts.length === 0 && (
        <section className='publishing-context-guide' aria-labelledby='publishing-context-guide-title'>
          <div className='publishing-context-heading'>
            <span><MonitorCheck size={23} /></span>
            <div>
              <p className='section-kicker'>Before your first post</p>
              <h2 id='publishing-context-guide-title'>{permissions.canManageAccounts ? 'Prepare your publishing workspace' : 'Publishing is waiting for an account'}</h2>
              <small>{permissions.canManageAccounts ? 'This one-time setup makes the account available to your permitted teammates.' : 'A Publishing Manager completes this one-time setup. You can create content as soon as an account appears.'}</small>
            </div>
          </div>
          <ol className='publishing-context-steps' aria-label='Publishing setup steps'>
            <li><i><Database size={19} /></i><strong>Connect server account</strong><small>No user download</small></li>
            <li><i><KeyRound size={19} /></i><strong>Sign in once</strong><small>Use the account login</small></li>
            <li><i><Send size={19} /></i><strong>Create a post</strong><small>Choose account and publish</small></li>
          </ol>
          {permissions.canManageAccounts
            ? <a href='/config-manager?service=publishing'><Settings2 size={15} />Open Connections<ArrowRight size={15} /></a>
            : <em>Manager setup required</em>}
        </section>
      )}

      <section className='dashboard-workflow' id='overview' aria-label='Create posts and review priority work'>
        <div className='dashboard-create-panel'>
          {permissions.canEditContent ? <UnifiedComposer accounts={accounts} schedules={schedules} canSchedule={permissions.canSchedulePosts} handoffOnly={!permissions.canRunAutomation} canManageAccounts={permissions.canManageAccounts} canPublishNow={permissions.canRunAutomation} onOpenAccounts={onOpenAccounts} onCreated={onCreated} /> : <section className='composer-readonly'><div><p className='section-kicker'>Universal post</p><h1>One post, every compatible destination.</h1><span>Your role can review this workspace. Content upload is available to operations managers and post uploaders.</span></div><LockKeyhole size={28} /></section>}
        </div>
      </section>

      <section className='delivery-ledger' aria-labelledby='delivery-ledger-heading'>
        <header className='delivery-ledger-head'>
          <div><p className='section-kicker'>Destination-by-destination proof</p><h2 id='delivery-ledger-heading'>Recent publishing results</h2><span>Each app and account has its own clear outcome. The same post sent to five apps appears as five results.</span></div>
          <div className='delivery-ledger-summary' aria-label={`${metrics.posted} posted, ${metrics.failed} failed, ${metrics.total - metrics.posted - metrics.failed} open`}>
            <span className='posted'><strong>{metrics.posted}</strong><small>Posted</small></span>
            <span className='failed'><strong>{metrics.failed}</strong><small>Failed</small></span>
            <span><strong>{metrics.total - metrics.posted - metrics.failed}</strong><small>Open</small></span>
          </div>
        </header>
        {recentDeliveries.length === 0 ? (
          <div className='delivery-ledger-empty'><Send size={24} /><span><strong>No destination results yet</strong><small>Create a post to see separate results for every selected app and account.</small></span></div>
        ) : (
          <div className='delivery-ledger-list'>
            {recentDeliveries.map(upload => {
              const outcome = getDeliveryOutcome(upload);
              const account = accountById.get(upload.accountId);
              return <button type='button' className={`delivery-ledger-row tone-${outcome.tone}`} key={upload.id} onClick={() => canEditPosts && onEdit(upload)} disabled={!canEditPosts}>
                <span className='delivery-ledger-media'><PostMediaPreview upload={upload} compact /></span>
                <span className='delivery-ledger-destination'><CustomIcon platform={upload.platform} size={20} /><span><strong>{account?.displayName || platformLabels[upload.platform]}</strong><small>{account?.handle || platformLabels[upload.platform]}</small></span></span>
                <span className='delivery-ledger-content'><strong>{upload.title || upload.originalName}</strong><small title={outcome.detail}>{outcome.detail}</small></span>
                <span className={`delivery-outcome tone-${outcome.tone}`}><StatusStateIcon state={outcome.tone} size={15} /><span><strong>{outcome.label}</strong><small>{upload.attemptCount ? `${upload.attemptCount} ${upload.attemptCount === 1 ? 'attempt' : 'attempts'}` : formatEventTime(outcome.timestamp)}</small></span></span>
                {canEditPosts && <ChevronRight size={16} />}
              </button>;
            })}
          </div>
        )}
      </section>

      <section className='handoff-queue' aria-labelledby='handoff-queue-heading'>
        <header className='workboard-section-head'>
          <div><p className='section-kicker'>Uploader to scheduler</p><h2 id='handoff-queue-heading'>Content handoff queue</h2></div>
          <span>{awaitingSubmissions.length} awaiting schedule</span>
        </header>
        <div className='handoff-list'>
          {submissions.length === 0 ? (
            <div className='handoff-empty'><FolderOpen size={24} /><span><strong>No content submissions yet</strong><small>Uploads saved by a post uploader will remain here after sign-out.</small></span></div>
          ) : submissions.slice(0, 12).map(submission => (
            <article className={`handoff-row ${submission.status}`} key={submission.id}>
              <span className='handoff-format'><SubmissionMediaPreview submission={submission} /></span>
              <span className='handoff-copy'><strong>{submission.title || submission.originalName}</strong><small>{submission.description} · Created by {submission.createdByName || submission.createdByUserId} · {submission.scheduledByUserId ? `Scheduled by ${submission.scheduledByName || submission.scheduledByUserId}` : `Saved ${formatEventTime(submission.createdAt)}`}</small></span>
              <span className={`handoff-status ${submission.status}`}>{submission.status === 'awaiting_schedule' ? 'Awaiting schedule' : submission.status === 'scheduling' ? 'Scheduling' : 'Scheduled'}</span>
              {submission.status === 'awaiting_schedule' && permissions.canSchedulePosts
                ? <button type='button' className='btn-primary' onClick={() => onScheduleSubmission(submission)}><CalendarClock size={15} />Choose schedule</button>
                : <span className='handoff-readonly'>{submission.status === 'scheduled' ? `${submission.destinationUploadIds.length} destinations` : user.role === 'viewer' ? 'View only' : 'Scheduler will complete this'}</span>}
            </article>
          ))}
        </div>
      </section>

      <section className='platform-metrics' id='channels' aria-labelledby='post-metrics-heading'>
        <header className='workboard-section-head'><div><p className='section-kicker'>Channel control</p><h2 id='post-metrics-heading'>Publishing channels</h2></div><span>{trackingSummary}</span></header>
        <div className='platform-metric-grid'>
          {platforms.map(platform => {
            const platformPosts = uploads.filter(upload => upload.platform === platform);
            const platformAccounts = accounts.filter(account => account.platform === platform);
            return (
              <article key={platform} className={`platform-metric-card platform-${platform}`}>
                <div className='platform-metric-card-top'><CustomIcon platform={platform} size={34} /><span>{platformLabels[platform]}</span><ChevronRight size={16} /></div>
                <div className='platform-metric-number'><strong>{platformPosts.length}</strong><span>posts</span></div>
                <div className='platform-account-summary'><UsersRound size={13} /><span>{platformAccounts.length} {platformAccounts.length === 1 ? 'account' : 'accounts'} · {platformPosts.filter(post => post.status === 'queued').length} queued</span></div>
                <div className='platform-card-actions'>
                  {permissions.canSchedulePosts && <button type='button' onClick={() => setSchedulePlatform(platform)}><CalendarClock size={14} />Schedule</button>}
                  {permissions.canManageAccounts && <button type='button' onClick={() => onOpenAccounts(platform)}><Settings2 size={14} />Config Manager</button>}
                </div>
              </article>
            );
          })}
        </div>
        <div className='account-health-dashboard' aria-label='Publishing account health'>
          <div className='account-health-heading'><ShieldCheck size={17} /><span><strong>Account health</strong><small>Live safety state for every connected account</small></span></div>
          <div className='account-health-list'>{accounts.length === 0 ? <span className='account-health-empty'>No publishing accounts connected.</span> : accounts.map(account => {
            const health = accountHealthStatus(account);
            return <article key={account.id} className={`account-health-row ${health}`}>
              <CustomIcon platform={account.platform} size={18} />
              <span><strong>{account.displayName}</strong><small>{account.handle} · {accountConnectionLabel(account)} · {publishingEngineLabels[accountPublishingEngine(account)]} · {account.safetyMode === 'protected' ? 'Protected pace' : 'Standard pace'}{account.twoFactorEnabled ? ' · 2FA' : ' · 2FA recommended'}</small></span>
              <em>{accountHealthLabels[health]}</em>
              {account.safetyReason && <small title={account.safetyReason}>{account.safetyReason}</small>}
            </article>;
          })}</div>
        </div>
      </section>

      {permissions.canManageUsers && (
        <section className='workboard-user-manager' aria-labelledby='user-manager-heading'>
          <header className='workboard-section-head'>
            <div><p className='section-kicker'>Workspace access</p><h2 id='user-manager-heading'>User management</h2></div>
            <button className='btn-primary' onClick={onOpenUsers}><UsersRound size={16} />Manage users</button>
          </header>
          <div className='user-access-strip'>
            {users.length === 0 ? <div className='user-access-empty'><UsersRound size={23} /><span>No users loaded</span></div> : users.slice(0, 4).map(item => (
              <button key={item.id} type='button' className='user-access-chip' onClick={onOpenUsers}>
                <span className='workboard-user'>{roleInitials[item.role]}</span>
                <span><strong>{item.fullName}</strong><small>{userRoleLabels[item.role]}</small></span>
              </button>
            ))}
            {users.length > 4 && <button type='button' className='user-access-more' onClick={onOpenUsers}>+{users.length - 4}</button>}
          </div>
        </section>
      )}

      <section className='workboard-schedule-manager' aria-labelledby='schedule-manager-heading'>
        <header className='workboard-section-head'>
          <div><p className='section-kicker'>Reusable timing</p><h2 id='schedule-manager-heading'>Schedule manager</h2></div>
          {permissions.canSchedulePosts && <button className='btn-primary' onClick={onOpenSchedules}><CalendarClock size={16} />Add or manage</button>}
        </header>
        <div className='schedule-card-grid'>
          {schedules.length === 0 ? <button className='schedule-empty-card' onClick={onOpenSchedules} disabled={!permissions.canSchedulePosts}><CalendarClock size={24} /><span><strong>No schedules yet</strong><small>Create schedules like Daily, Weekly, Monthly, One time, or Custom.</small></span><ChevronRight size={18} /></button> : schedules.map(schedule => {
            const assignedPosts = uploads.filter(upload => upload.scheduleId === schedule.id).length;
            return <button className='schedule-summary-card' key={schedule.id} onClick={onOpenSchedules} disabled={!permissions.canSchedulePosts}>
              <span className='schedule-card-id'>#{schedule.id}</span>
              <span className='schedule-card-main'><strong>{schedule.name}</strong><small>{schedule.frequency === 'custom' ? schedule.customCronExpression : `${scheduleFrequencyLabels[schedule.frequency]} at ${schedule.time}`}{schedule.endDate ? ` until ${schedule.endDate}` : ''}</small></span>
              <span className={`schedule-card-state ${schedule.status}`}>{schedule.status}</span>
              <span className='schedule-card-accounts'><FileText size={14} />{assignedPosts}</span>
              <ChevronRight size={17} />
            </button>;
          })}
        </div>
      </section>

      <section className='workboard-focus-grid' id='operations'>
        <section className='operations-summary-grid'>
          <article className='status-board'>
            <header className='workboard-section-head'><div><p className='section-kicker'>Live workload</p><h2>Post status</h2></div><span>{statusTotal} tracked</span></header>
            <div className='status-pod-list' role='img' aria-label={`${statusMix.map(status => `${status.value} ${status.label}`).join(', ')}`}>
              {statusMix.map(status => <div className='status-pod' key={status.id}><span className='status-pod-icon' style={{ color: status.color, backgroundColor: `${status.color}18` }}><StatusStateIcon state={status.id} size={19} /></span><div><strong>{status.value}</strong><span>{status.label}</span><small>{status.detail}</small></div></div>)}
            </div>
          </article>
          <article className='review-queue-board'>
            <header className='workboard-section-head'><div><p className='section-kicker'>Pre-publish review</p><h2>Review queue</h2></div><span>{reviewQueue.length} open</span></header>
            <div className='review-queue-list'>{reviewQueue.length === 0 ? <div className='review-queue-empty'><CircleCheckBig size={24} /><strong>Nothing waiting for review.</strong><span>Every tracked post has been delivered.</span></div> : reviewQueue.map(upload => (
              <button className='review-queue-row' key={upload.id} onClick={() => canEditPosts && onEdit(upload)} disabled={!canEditPosts}>
                <div className={`review-queue-media review-${upload.status}`}><PostMediaPreview upload={upload} compact /><i><CustomIcon platform={upload.platform} size={17} /></i></div>
                <span><strong>{upload.title || upload.originalName}</strong><small title={upload.failureReason}>{accountById.get(upload.accountId)?.handle ?? platformLabels[upload.platform]} · {upload.status === 'failed' ? upload.failureReason || 'Needs review' : isWaitingForCompanion(upload) ? 'Waiting safely for the assigned Companion' : upload.scheduledAt ? formatEventTime(upload.scheduledAt) : upload.status === 'processing' ? 'Publishing now' : 'Needs a publish time'}</small></span>
                <Pencil size={14} />
              </button>
            ))}</div>
            {reviewQueue.length > 0 && <footer className='review-queue-footer'>{canEditPosts ? 'Select any post to inspect its platform preview and edit details.' : 'Your role can view this queue but cannot edit posts.'}</footer>}
          </article>
        </section>

        <article className='broadcast-mix-board'>
          <header className='workboard-section-head'><div><p className='section-kicker'>Publishing performance</p><h2>Delivery mix</h2></div><CircleCheckBig size={20} /></header>
          <div className='broadcast-mix-content'>
            <div className='broadcast-donut' role='img' aria-label={`${deliveredTotal} successful deliveries distributed across channels`}>
              <svg viewBox='0 0 120 120' aria-hidden='true'>
                <circle className='broadcast-donut-track' cx='60' cy='60' r='42' />
                {broadcastSegments.map(channel => <circle key={channel.platform} className='broadcast-donut-segment' cx='60' cy='60' r='42' stroke={platformColor[channel.platform]} strokeDasharray={`${Math.max(0, channel.length - 3)} ${DONUT_CIRCUMFERENCE}`} strokeDashoffset={-channel.offset} />)}
              </svg>
              <div className='broadcast-donut-center'><strong>{deliveredTotal}</strong><span>delivered</span></div>
            </div>
            <div className='broadcast-legend' aria-label='Delivered posts by channel'>
              {broadcastMix.map(channel => {
                const share = deliveredTotal ? Math.round((channel.value / deliveredTotal) * 100) : 0;
                return <div className={channel.value ? '' : 'inactive-channel'} key={channel.platform}><span style={{ backgroundColor: platformColor[channel.platform] }} /><strong>{channel.label}</strong><small>{channel.value} · {share}%</small></div>;
              })}
            </div>
          </div>
          <footer className='broadcast-mix-footer'>{deliveredTotal ? 'Share of successful deliveries across every channel.' : 'Delivery results will appear here as channels publish posts.'}</footer>
        </article>

        <article className='legacy-next-action-board'>
          <header className='workboard-section-head'><div><p className='section-kicker'>Next action</p><h2>{nextAction ? 'Ready for its moment' : 'Nothing scheduled yet'}</h2></div><CalendarClock size={20} /></header>
          {nextAction ? (
            <button className='next-action-content' onClick={() => canEditPosts && onEdit(nextAction)} disabled={!canEditPosts}>
              <CustomIcon platform={nextAction.platform} size={29} />
              <span><strong>{nextAction.title || nextAction.originalName}</strong><small>{accountById.get(nextAction.accountId)?.handle ?? platformLabels[nextAction.platform]} · {formatEventTime(nextAction.scheduledAt ?? nextAction.updatedAt)}</small></span>
              <Pencil size={16} />
            </button>
          ) : <div className='next-action-empty'><CalendarDays size={24} /><span>Choose a post and set its date from the channel portfolio.</span></div>}
        </article>
      </section>

      <section className='workboard-calendar-section' id='schedule'>
        <article className='calendar-board'>
          <header className='workboard-section-head'><div><p className='section-kicker'>Schedule map</p><h2>{monthLabel}</h2></div><div className='calendar-navigation'><button className='workboard-tool' title='Previous month' onClick={() => shiftCalendarMonth(-1)}><ChevronLeft size={18} /></button><button className='workboard-tool' title='Next month' onClick={() => shiftCalendarMonth(1)}><ChevronRight size={18} /></button></div></header>
          <div className='workboard-calendar'>
            <div className='calendar-grid' role='grid' aria-label={`Post calendar for ${monthLabel}`}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span className='calendar-weekday' key={day}>{day}</span>)}
              {calendarDays.map(day => <button type='button' key={day.dayKey} className={`calendar-day ${day.currentMonth ? '' : 'outside-month'} ${day.dayKey === selectedDay ? 'selected-day' : ''} ${day.events.length ? 'has-events' : ''}`} onClick={() => setSelectedDay(day.dayKey)} aria-label={`${formatCalendarHeading(day.dayKey)}, ${day.events.length} events`}><span className='calendar-day-number'>{day.date.getDate()}</span><span className='calendar-event-icons'>{day.events.slice(0, 3).map(upload => <CustomIcon key={upload.id} platform={upload.platform} size={14} />)}{day.events.length > 3 && <span className='calendar-more-events'>+{day.events.length - 3}</span>}</span></button>)}
            </div>
            <aside className='workboard-day-inspector'><div><span>{formatCalendarHeading(selectedDay)}</span><strong>{selectedEvents.length}</strong></div>{selectedEvents.length === 0 ? <p>No publishing activity on this day.</p> : selectedEvents.map(upload => <button key={upload.id} onClick={() => canEditPosts && onEdit(upload)} disabled={!canEditPosts}><CustomIcon platform={upload.platform} size={17} /><span><strong>{upload.title || upload.originalName}</strong><small>{accountById.get(upload.accountId)?.handle ?? platformLabels[upload.platform]} · {getAuditAction(upload)}</small></span><time>{new Date(getAuditTimestamp(upload)).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</time></button>)}</aside>
          </div>
        </article>

        <article className='legacy-broadcast-mix-board'>
          <header className='workboard-section-head'><div><p className='section-kicker'>Broadcast output</p><h2>Channel distribution</h2></div><CircleCheckBig size={20} /></header>
          <div className='broadcast-mix-content'>
            <div className='broadcast-donut' role='img' aria-label={`${deliveredTotal} successful deliveries distributed across channels`}>
              <svg viewBox='0 0 120 120' aria-hidden='true'>
                <circle className='broadcast-donut-track' cx='60' cy='60' r='42' />
                {broadcastSegments.map(channel => <circle key={channel.platform} className='broadcast-donut-segment' cx='60' cy='60' r='42' stroke={platformColor[channel.platform]} strokeDasharray={`${Math.max(0, channel.length - 3)} ${DONUT_CIRCUMFERENCE}`} strokeDashoffset={-channel.offset} />)}
              </svg>
              <div className='broadcast-donut-center'><strong>{deliveredTotal}</strong><span>delivered</span></div>
            </div>
            <div className='broadcast-legend' aria-label='Delivered posts by channel'>
              {broadcastMix.map(channel => {
                const share = deliveredTotal ? Math.round((channel.value / deliveredTotal) * 100) : 0;
                return <div className={channel.value ? '' : 'inactive-channel'} key={channel.platform}><span style={{ backgroundColor: platformColor[channel.platform] }} /><strong>{channel.label}</strong><small>{channel.value} · {share}%</small></div>;
              })}
            </div>
          </div>
          <footer className='broadcast-mix-footer'>{deliveredTotal ? 'Share of successful deliveries across every channel.' : 'Your broadcast mix will appear as channels complete deliveries.'}</footer>
        </article>
      </section>

      {schedulePlatform && permissions.canSchedulePosts && (
        <PlatformScheduleModal
          platform={schedulePlatform}
          uploads={uploads.filter(upload => upload.platform === schedulePlatform)}
          accounts={accounts.filter(account => account.platform === schedulePlatform)}
          onClose={() => setSchedulePlatform(null)}
          onEdit={upload => {
            setSchedulePlatform(null);
            onEdit(upload);
          }}
        />
      )}
      {editingUpload && canEditPosts && <EditPostModal upload={editingUpload} accounts={accounts.filter(item => item.platform === editingUpload.platform)} schedules={schedules} permissions={permissions} onClose={onCloseEdit} onSuccess={onRefresh} />}
      </section>
    </main>
  );
}

function ScheduleSubmissionModal({
  submission,
  accounts,
  schedules,
  onClose,
  onSuccess,
}: {
  submission: ContentSubmission;
  accounts: PlatformAccount[];
  schedules: PublishingSchedule[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const destinationsLocked = submission.selectedAccountIds.length > 0;
  const compatibleAccounts = useMemo(() => accounts.filter(account => {
    if (destinationsLocked && !submission.selectedAccountIds.includes(account.id)) return false;
    if (!account.enabled) return false;
    const rules = platformPostRules[account.platform];
    if (!rules.formats.includes(submission.postFormat)) return false;
    if (submission.description.length > rules.descriptionLimit) return false;
    const needsTitle = rules.titleRequired || rules.titleRequiredFor?.includes(submission.postFormat);
    if (needsTitle && !submission.title?.trim()) return false;
    return !(rules.titleLimit && (submission.title?.length ?? 0) > rules.titleLimit);
  }), [accounts, destinationsLocked, submission]);
  const activeSchedules = schedules.filter(scheduleCanReceivePosts);
  const [selectedAccountIds] = useState<string[]>(() => destinationsLocked
    ? submission.selectedAccountIds
    : compatibleAccounts.map(account => account.id));
  const [timingMode, setTimingMode] = useState<'exact' | 'template'>('exact');
  const [exactAt, setExactAt] = useState(() => toLocalDateTimeInputValue(new Date(Date.now() + 60 * 60_000)));
  const [scheduleId, setScheduleId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingPreflightWarnings, setPendingPreflightWarnings] = useState<string[]>([]);

  const submit = async (confirmWarnings = false) => {
    setError('');
    if (!selectedAccountIds.length) return setError('Choose at least one compatible publishing account.');
    const scheduleDraft: ComposerScheduleDraft = { mode: timingMode, exactAt, scheduleId };
    const timingError = scheduleDraftError(scheduleDraft, schedules);
    if (timingError) return setError(timingError);
    const destinations = selectedAccountIds.map(accountId => ({ accountId, ...destinationSchedule(scheduleDraft) }));
    setLoading(true);
    try {
      await api.assessPublishingSafety(submission.postFormat, destinations);
      await api.scheduleSubmission(
        submission.id,
        destinations,
        confirmWarnings,
      );
      onSuccess();
    } catch (submissionError) {
      if (submissionError instanceof PublishingSafetyApiError) {
        setPendingPreflightWarnings([]);
        setError(`Choose a safer time: ${submissionError.issues.map(issue => issue.message).join(' ') || submissionError.message}`);
      } else if (submissionError instanceof ContentPreflightApiError && submissionError.code === 'CONTENT_PREFLIGHT_WARNINGS') {
        const warnings = [...new Set(submissionError.issues.map(issue => issue.message))];
        setPendingPreflightWarnings(warnings);
        setError(`Review before scheduling: ${warnings.join(' ')}`);
      } else {
        setPendingPreflightWarnings([]);
        setError(submissionError instanceof Error ? submissionError.message : 'The submission could not be scheduled.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='modal-overlay' onClick={onClose}>
      <div className='modal-panel submission-schedule-modal' role='dialog' aria-modal='true' aria-labelledby='submission-schedule-heading' onClick={event => event.stopPropagation()}>
        <div className='modal-head'><span id='submission-schedule-heading'>Schedule selected destinations</span><button onClick={onClose}><X size={22} /></button></div>
        <div className='modal-body'>
          <div className='submission-schedule-summary'>
            <span className='handoff-format'><SubmissionMediaPreview submission={submission} /></span>
            <span><strong>{submission.title || submission.originalName}</strong><small>{submission.description}</small></span>
          </div>
          <section className='submission-destination-section'>
            <div className='workboard-section-head'><div><p className='section-kicker'>Destinations</p><h2>{destinationsLocked ? 'Selected by uploader' : 'Compatible legacy destinations'}</h2></div><span>{selectedAccountIds.length} {destinationsLocked ? 'locked' : 'selected'}</span></div>
            <div className='submission-account-grid'>
              {compatibleAccounts.length === 0 ? <div className='handoff-empty'><CircleAlert size={22} /><span><strong>No compatible enabled accounts</strong><small>An operations manager must configure an account that supports this content.</small></span></div> : compatibleAccounts.map(account => (
                <label key={account.id} className={selectedAccountIds.includes(account.id) ? 'selected' : ''}>
                  <input type='checkbox' checked readOnly disabled />
                  <CustomIcon platform={account.platform} size={22} />
                  <span><strong>{account.displayName}</strong><small>{platformLabels[account.platform]} · {publishingEngineLabels[accountPublishingEngine(account)]}</small></span>
                </label>
              ))}
            </div>
          </section>
          <section className='submission-timing-section'>
            <div className='workboard-section-head'><div><p className='section-kicker'>Timing</p><h2>Required publish time</h2></div><CalendarClock size={20} /></div>
            <div className='account-form-grid'>
              <div className='field'><label>Timing type</label><select value={timingMode} onChange={event => { setTimingMode(event.target.value as 'exact' | 'template'); setPendingPreflightWarnings([]); }}><option value='exact'>Exact date and time</option><option value='template'>Schedule template</option></select></div>
              {timingMode === 'exact'
                ? <div className='field'><label>Date and time</label><input type='datetime-local' min={toLocalDateTimeInputValue(new Date(Date.now() + 60_000))} value={exactAt} onChange={event => { setExactAt(event.target.value); setPendingPreflightWarnings([]); }} /></div>
                : <div className='field'><label>Schedule template</label><select value={scheduleId} onChange={event => { setScheduleId(event.target.value); setPendingPreflightWarnings([]); }}><option value=''>Choose schedule</option>{activeSchedules.map(schedule => <option key={schedule.id} value={schedule.id}>{schedule.name} · {scheduleFrequencyLabels[schedule.frequency]} at {schedule.time}</option>)}</select></div>}
            </div>
          </section>
          {error && <div className='workspace-error' role='alert'><CircleAlert size={17} /><span><strong>Cannot schedule this content</strong><small>{error}</small></span></div>}
          <div className='account-form-actions'><button className='btn-outline' onClick={onClose}>Cancel</button><button className='btn-primary' onClick={() => void submit(pendingPreflightWarnings.length > 0)} disabled={loading || !compatibleAccounts.length}>{loading ? <Loader2 className='spin' size={17} /> : pendingPreflightWarnings.length ? <ShieldCheck size={17} /> : <CalendarClock size={17} />}{pendingPreflightWarnings.length ? 'Confirm and schedule' : `Schedule ${selectedAccountIds.length || ''} ${selectedAccountIds.length === 1 ? 'destination' : 'destinations'}`}</button></div>
        </div>
      </div>
    </div>
  );
}

function PlatformScheduleModal({
  platform,
  uploads,
  accounts,
  onClose,
  onEdit,
}: {
  platform: Platform;
  uploads: PlatformUpload[];
  accounts: PlatformAccount[];
  onClose: () => void;
  onEdit: (upload: PlatformUpload) => void;
}) {
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const accountById = useMemo(() => new Map(accounts.map(account => [account.id, account])), [accounts]);
  const schedulableUploads = useMemo(() => uploads
    .filter(upload => upload.status !== 'posted')
    .sort((a, b) => {
      const aUnscheduled = !a.scheduledAt && !a.scheduleId ? 0 : 1;
      const bUnscheduled = !b.scheduledAt && !b.scheduleId ? 0 : 1;
      if (aUnscheduled !== bUnscheduled) return aUnscheduled - bUnscheduled;
      const aTime = a.scheduledAt ? Date.parse(a.scheduledAt) : Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledAt ? Date.parse(b.scheduledAt) : Number.MAX_SAFE_INTEGER;
      return aTime - bTime || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    }), [uploads]);
  const visibleUploads = accountFilter === 'all'
    ? schedulableUploads
    : schedulableUploads.filter(upload => upload.accountId === accountFilter);
  const waitingCount = schedulableUploads.filter(upload => upload.status === 'queued' && !upload.scheduledAt && !upload.scheduleId).length;
  const scheduledCount = schedulableUploads.filter(upload => upload.scheduledAt || upload.scheduleId).length;
  const failedCount = schedulableUploads.filter(upload => upload.status === 'failed').length;

  const scheduleLabel = (upload: PlatformUpload) => {
    if (upload.status === 'failed') return 'Needs review';
    if (upload.status === 'processing') return 'Publishing now';
    if (isWaitingForCompanion(upload)) return 'Waiting for Companion';
    if (upload.scheduledAt) return formatEventTime(upload.scheduledAt);
    if (upload.scheduleId) return `Template #${upload.scheduleId}`;
    return 'Needs a publish time';
  };

  return (
    <div className='modal-overlay' onClick={onClose}>
      <div className='modal-panel platform-schedule-modal' role='dialog' aria-modal='true' aria-labelledby='platform-schedule-heading' onClick={event => event.stopPropagation()}>
        <div className='modal-head'>
          <span id='platform-schedule-heading'>{platformLabels[platform]} post scheduling</span>
          <button onClick={onClose}><X size={22} /></button>
        </div>
        <div className='platform-schedule-layout'>
          <aside className='platform-schedule-sidebar'>
            <div className='platform-schedule-title'>
              <CustomIcon platform={platform} size={36} />
              <span><strong>{platformLabels[platform]}</strong><small>{schedulableUploads.length} open posts</small></span>
            </div>
            <div className='platform-schedule-stat-grid'>
              <span><strong>{waitingCount}</strong><small>Need time</small></span>
              <span><strong>{scheduledCount}</strong><small>Scheduled</small></span>
              <span><strong>{failedCount}</strong><small>Review</small></span>
            </div>
            <div className='platform-schedule-account-list' aria-label={`${platformLabels[platform]} accounts`}>
              <button type='button' className={accountFilter === 'all' ? 'active' : ''} onClick={() => setAccountFilter('all')}>
                <UsersRound size={17} />
                <span><strong>All accounts</strong><small>{schedulableUploads.length} posts</small></span>
              </button>
              {accounts.map(account => {
                const count = schedulableUploads.filter(upload => upload.accountId === account.id).length;
                return (
                  <button type='button' key={account.id} className={accountFilter === account.id ? 'active' : ''} onClick={() => setAccountFilter(account.id)}>
                    <CustomIcon platform={platform} size={17} />
                    <span><strong>{account.displayName}</strong><small>{account.handle} - {count} posts</small></span>
                  </button>
                );
              })}
            </div>
          </aside>
          <section className='platform-schedule-main'>
            <header>
              <div><p className='section-kicker'>Individual timing</p><h3>{accountFilter === 'all' ? 'Choose a post' : accountById.get(accountFilter)?.displayName ?? 'Choose a post'}</h3></div>
              <span>{visibleUploads.length} shown</span>
            </header>
            <div className='platform-schedule-post-list'>
              {visibleUploads.length === 0 ? (
                <div className='platform-schedule-empty'>
                  <CalendarDays size={26} />
                  <strong>No posts waiting here.</strong>
                  <span>Create a post or choose another account to schedule publishing.</span>
                </div>
              ) : visibleUploads.map(upload => (
                <button type='button' className='platform-schedule-post-row' key={upload.id} onClick={() => onEdit(upload)}>
                  <div className={`review-queue-media review-${upload.status}`}><PostMediaPreview upload={upload} compact /></div>
                  <span className='platform-schedule-post-copy'>
                    <strong>{upload.title || upload.originalName}</strong>
                    <small>{accountById.get(upload.accountId)?.handle ?? platformLabels[platform]} - {scheduleLabel(upload)}</small>
                  </span>
                  <span className={`platform-schedule-state ${upload.scheduledAt || upload.scheduleId ? 'scheduled' : upload.status}`}>{upload.scheduledAt || upload.scheduleId ? 'scheduled' : upload.status}</span>
                  <Pencil size={16} />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ScheduleManagerModal({ schedules, uploads, onClose, onSuccess }: {
  schedules: PublishingSchedule[];
  uploads: PlatformUpload[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [editing, setEditing] = useState<PublishingSchedule | 'new' | null>(schedules.length === 0 ? 'new' : null);
  const [name, setName] = useState('');
  const [time, setTime] = useState('09:00');
  const [frequency, setFrequency] = useState<ScheduleFrequency>('daily');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<ScheduleStatus>('active');
  const [customCronExpression, setCustomCronExpression] = useState('');
  const [loading, setLoading] = useState(false);

  const openForm = (schedule?: PublishingSchedule) => {
    setEditing(schedule ?? 'new');
    setName(schedule?.name ?? '');
    setTime(schedule?.time ?? '09:00');
    setFrequency(schedule?.frequency ?? 'daily');
    setEndDate(schedule?.endDate ?? '');
    setStatus(schedule?.status ?? 'active');
    setCustomCronExpression(schedule?.customCronExpression ?? '');
  };

  const closeForm = () => {
    setEditing(null);
    setName('');
    setTime('09:00');
    setFrequency('daily');
    setEndDate('');
    setStatus('active');
    setCustomCronExpression('');
  };

  const saveSchedule = async () => {
    if (!name.trim()) return alert('Schedule name is required.');
    if (!time) return alert('Schedule time is required.');
    if (frequency === 'onetime' && !endDate) return alert('One-time schedules need a date.');
    if (frequency === 'onetime') {
      const runAt = localScheduleDateTime(endDate, time);
      if (!runAt || runAt.getTime() <= Date.now()) return alert('One-time schedules must be set to a future date and time.');
    }
    if (frequency === 'custom' && !customCronExpression.trim()) return alert('Custom schedules need a cron expression.');
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        time,
        frequency,
        endDate: endDate || undefined,
        status,
        customCronExpression: frequency === 'custom' ? customCronExpression.trim() : undefined
      };
      if (editing === 'new') await api.createSchedule(payload);
      else await api.updateSchedule(editing!.id, payload);
      closeForm();
      onSuccess();
    } catch (error) {
      alert('Error: ' + (error instanceof Error ? error.message : 'Could not save schedule'));
    } finally {
      setLoading(false);
    }
  };

  const removeSchedule = async (schedule: PublishingSchedule) => {
    const postCount = uploads.filter(upload => upload.scheduleId === schedule.id).length;
    if (postCount > 0) return alert('Remove this schedule from posts before deleting it.');
    if (!confirm(`Delete schedule ${schedule.name}?`)) return;
    setLoading(true);
    try {
      await api.deleteSchedule(schedule.id);
      onSuccess();
    } catch (error) {
      alert('Error: ' + (error instanceof Error ? error.message : 'Could not delete schedule'));
    } finally {
      setLoading(false);
    }
  };

  return <div className='modal-overlay' onClick={onClose}>
    <div className='modal-panel schedule-manager-modal' onClick={event => event.stopPropagation()}>
      <div className='modal-head'><span>Schedule manager</span><button onClick={onClose}><X size={22} /></button></div>
      <div className='modal-body'>
        {editing ? <div className='schedule-form'>
          <div className='account-form-heading'><CalendarClock size={34} /><div><strong>{editing === 'new' ? 'Add schedule' : 'Edit schedule'}</strong><span>Create one reusable schedule and assign it to posts.</span></div></div>
          <div className='account-form-grid'>
            <div className='field'><label>Schedule name</label><input value={name} onChange={event => setName(event.target.value)} placeholder='Morning daily' /></div>
            <div className='field'><label>Time 24HH-MI</label><input type='time' value={time} onChange={event => setTime(event.target.value)} /></div>
            <div className='field'><label>Frequency</label><select value={frequency} onChange={event => setFrequency(event.target.value as ScheduleFrequency)}>{scheduleFrequencies.map(item => <option key={item} value={item}>{scheduleFrequencyLabels[item]}</option>)}</select></div>
            <div className='field'><label>{frequency === 'onetime' ? 'Schedule date' : 'Schedule end date'}</label><input type='date' value={endDate} onChange={event => setEndDate(event.target.value)} /></div>
            <div className='field'><label>Status</label><select value={status} onChange={event => setStatus(event.target.value as ScheduleStatus)}><option value='active'>Active</option><option value='inactive'>Inactive</option></select></div>
            {frequency === 'custom' && <div className='field'><label>Custom cron</label><input value={customCronExpression} onChange={event => setCustomCronExpression(event.target.value)} placeholder='30 9 * * 1-5' /></div>}
          </div>
          <div className='account-form-actions'><button className='btn-outline' onClick={closeForm}>Cancel</button><button className='btn-primary' onClick={saveSchedule} disabled={loading}>{loading ? <Loader2 className='spin' size={17} /> : <ShieldCheck size={17} />}Save schedule</button></div>
        </div> : <div className='schedule-list-view'>
          <div className='account-list-intro'><div><strong>{schedules.length} reusable {schedules.length === 1 ? 'schedule' : 'schedules'}</strong><span>Assign schedules from each post edit form.</span></div><button className='btn-primary' onClick={() => openForm()}><CalendarClock size={16} />Add schedule</button></div>
          <div className='schedule-list'>
            {schedules.length === 0 ? <div className='account-list-empty'><CalendarClock size={27} /><strong>No schedules yet</strong><span>Add a schedule, then select it from any post.</span><button className='btn-primary' onClick={() => openForm()}>Add first schedule</button></div> : schedules.map(schedule => {
              const postCount = uploads.filter(upload => upload.scheduleId === schedule.id).length;
              return <article className='schedule-row' key={schedule.id}>
                <div className='schedule-row-id'>#{schedule.id}</div>
                <div className='schedule-row-main'><strong>{schedule.name}</strong><small>{schedule.frequency === 'custom' ? schedule.customCronExpression : `${scheduleFrequencyLabels[schedule.frequency]} at ${schedule.time}`}{schedule.endDate ? ` - ends ${schedule.endDate}` : ''}</small></div>
                <span className={`schedule-status ${schedule.status}`}>{schedule.status}</span>
                <span className='schedule-account-count'><FileText size={14} />{postCount}</span>
                <button className='btn-outline' onClick={() => openForm(schedule)}><Pencil size={14} />Edit</button>
                <button className='btn-danger ghost-danger' onClick={() => removeSchedule(schedule)} disabled={loading || postCount > 0}><Trash2 size={14} /></button>
              </article>;
            })}
          </div>
        </div>}
      </div>
    </div>
  </div>;
}

function AccountManagerModal({ platform, accounts, onClose, onSuccess }: {
  platform: Platform;
  accounts: PlatformAccount[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [editing, setEditing] = useState<PlatformAccount | 'new' | null>(accounts.length === 0 ? 'new' : null);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [safetyMode, setSafetyMode] = useState<'standard' | 'protected'>('protected');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginAccountId, setLoginAccountId] = useState<string | null>(null);
  const externalLoginByDefault = platform === 'x' || platform === 'youtube';

  const openForm = (account?: PlatformAccount) => {
    setEditing(account ?? 'new');
    setDisplayName(account?.displayName ?? '');
    setHandle(account?.handle ?? '');
    setLoginIdentifier(account?.loginIdentifier ?? '');
    setEnabled(account?.enabled ?? true);
    setSafetyMode(account?.safetyMode ?? (account ? 'standard' : 'protected'));
    setTwoFactorEnabled(account?.twoFactorEnabled ?? false);
  };

  const closeForm = () => {
    setEditing(null);
    setDisplayName('');
    setHandle('');
    setLoginIdentifier('');
    setEnabled(true);
    setSafetyMode('protected');
    setTwoFactorEnabled(false);
  };

  const openManualLogin = async (account: PlatformAccount, surface: 'engine' | 'embedded' | 'external' = 'engine') => {
    setLoginAccountId(account.id);
    try {
      const result = await api.startManualLogin(account.id, surface);
      alert(result.message);
      onSuccess();
    } catch (error) {
      alert('Error: ' + (error instanceof Error ? error.message : 'Could not open manual login'));
    } finally {
      setLoginAccountId(null);
    }
  };

  const saveAccount = async (loginAfterSave = false) => {
    if (!displayName.trim()) return alert('Account name is required.');
    if (!handle.trim()) return alert('Account handle is required.');
    setLoading(true);
    try {
      const payload = {
        displayName: displayName.trim(),
        handle: handle.trim(),
        loginIdentifier: loginIdentifier.trim(),
        enabled,
        executionEngine: 'companion' as const,
        safetyMode,
        twoFactorEnabled,
      };
      const account = editing === 'new'
        ? await api.createAccount(platform, payload)
        : await api.updateAccount(editing!.id, payload);
      closeForm();
      onSuccess();
      if (loginAfterSave) await openManualLogin(account);
    } catch (error) {
      alert('Error: ' + (error instanceof Error ? error.message : 'Could not save account'));
    } finally {
      setLoading(false);
    }
  };

  const removeAccount = async (account: PlatformAccount) => {
    if (!confirm(`Delete ${account.displayName}?`)) return;
    setLoading(true);
    try {
      await api.deleteAccount(account.id);
      onSuccess();
    } catch (error) {
      alert('Error: ' + (error instanceof Error ? error.message : 'Could not delete account'));
    } finally {
      setLoading(false);
    }
  };

  return <div className='modal-overlay' onClick={onClose}>
    <div className='modal-panel account-manager-modal' onClick={event => event.stopPropagation()}>
      <div className='modal-head'><span>{platformLabels[platform]} accounts</span><button onClick={onClose}><X size={22} /></button></div>
      <div className='modal-body'>
        {editing ? <div className='account-form'>
          <div className='account-form-heading'><KeyRound size={34} /><div><strong>{editing === 'new' ? 'Add account' : 'Edit account'}</strong><span>Secure login creates the saved browser session used at schedule time.</span></div></div>
          <div className='account-form-grid'>
            <div className='field'><label>Account name</label><input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder='Brand Instagram' /></div>
            <div className='field'><label>Handle</label><input value={handle} onChange={event => setHandle(event.target.value)} placeholder='@brand' /></div>
            <div className='field'><label>Login hint (optional)</label><input value={loginIdentifier} onChange={event => setLoginIdentifier(event.target.value)} placeholder='Only a label; credentials stay on the provider sign-in page' /></div>
            <div className='field'><label>Account pacing</label><select value={safetyMode} onChange={event => setSafetyMode(event.target.value as 'standard' | 'protected')}><option value='protected'>Protected — newer accounts</option><option value='standard'>Standard — established accounts</option></select><small>Protected mode lowers posting pace; it does not block the account.</small></div>
            <div className='account-engine-field account-form-wide'><label>Publishing location</label><div className='account-engine-picker'><button type='button' className='active' aria-pressed='true' disabled><MonitorCheck size={18} /><span><strong>Companion</strong><small>All uploads and publishing run in visible protected Companion tabs. Chrome or Edge is used only as a login fallback.</small></span></button></div></div>
            <label className='account-enabled-toggle'><input type='checkbox' checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span>Enabled for publishing</span></label>
            <label className='account-enabled-toggle'><input type='checkbox' checked={twoFactorEnabled} onChange={event => setTwoFactorEnabled(event.target.checked)} /><span>2FA is enabled on this account</span></label>
          </div>
          <div className='account-form-actions'>
            <button className='btn-outline' onClick={closeForm}>Cancel</button>
            <button className='btn-outline' onClick={() => saveAccount(true)} disabled={loading}>{loading ? <Loader2 className='spin' size={17} /> : <KeyRound size={17} />}Save & login</button>
            <button className='btn-primary' onClick={() => saveAccount(false)} disabled={loading}>{loading ? <Loader2 className='spin' size={17} /> : <ShieldCheck size={17} />}Save account</button>
          </div>
        </div> : <div className='account-list-view'>
          <div className='account-list-intro'><div><strong>{accounts.length} {platformLabels[platform]} {accounts.length === 1 ? 'account' : 'accounts'}</strong><span>Open login for each account once, then scheduled posts reuse that saved session.</span></div><button className='btn-primary' onClick={() => openForm()}><KeyRound size={16} />Add account</button></div>
          <div className='storage-access-list'>
            {accounts.length === 0 ? <div className='account-list-empty'><UsersRound size={27} /><strong>No publishing accounts yet</strong><span>Add an account, then open its login page and sign in manually.</span><button className='btn-primary' onClick={() => openForm()}>Add first account</button></div> : accounts.map(account => <article className='storage-access-row account-session-row' key={account.id}>
              <span className='publishing-account-icon'><CustomIcon platform={account.platform} size={18} /></span>
              <span><strong>{account.displayName}</strong><small>{account.handle} · {publishingEngineLabels[accountPublishingEngine(account)]} · {account.safetyMode === 'protected' ? 'protected pace' : 'standard pace'}{account.twoFactorEnabled ? ' · 2FA' : ''}</small></span>
              <span className={`schedule-status ${account.enabled ? 'active' : 'inactive'}`}>{account.enabled ? 'active' : 'paused'}</span>
              <span className='storage-access-path'>{account.loginIdentifier || publishingEngineLabels[accountPublishingEngine(account)]}</span>
              <button className='btn-outline' onClick={() => openForm(account)} disabled={loading}><Pencil size={14} />Edit</button>
              <button className='btn-outline' onClick={() => openManualLogin(account)} disabled={Boolean(loginAccountId) || !account.enabled} title={externalLoginByDefault ? 'Open secure login in Chrome or Edge and save it through Companion' : 'Open secure login inside Companion'}>
                {loginAccountId === account.id ? <Loader2 className='spin' size={14} /> : externalLoginByDefault ? <ExternalLink size={14} /> : <KeyRound size={14} />}{externalLoginByDefault ? 'Chrome login' : 'Login'}
              </button>
              {!externalLoginByDefault && <button className='btn-outline account-browser-fallback' onClick={() => openManualLogin(account, 'external')} disabled={Boolean(loginAccountId) || !account.enabled} title='Log in with Chrome or Edge, then transfer the verified session into Companion' aria-label={`Open ${account.displayName} login in Chrome or Edge`}>
                <ExternalLink size={14} />Chrome
              </button>}
              <button className='btn-danger ghost-danger' onClick={() => removeAccount(account)} disabled={loading}><Trash2 size={14} /></button>
            </article>)}
          </div>
        </div>}
      </div>
    </div>
  </div>;
}

function UserManagementModal({ currentUser, users, onClose, onSuccess }: {
  currentUser: UserProfile;
  users: UserProfile[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [editing, setEditing] = useState<UserProfile | 'new' | null>(users.length === 0 ? 'new' : null);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const openForm = (user?: UserProfile) => {
    setEditing(user ?? 'new');
    setUsername(user?.username ?? '');
    setFullName(user?.fullName ?? '');
    setEmail(user?.email ?? '');
    setRole(user?.role ?? 'viewer');
    setIsActive(user?.isActive ?? true);
    setPassword('');
  };

  const closeForm = () => {
    setEditing(null);
    setUsername('');
    setFullName('');
    setEmail('');
    setRole('viewer');
    setIsActive(true);
    setPassword('');
  };

  const saveUser = async () => {
    if (!username.trim()) return alert('Username is required.');
    if (!fullName.trim()) return alert('Full name is required.');
    if (editing === 'new' && password.length < 8) return alert('Password must be at least 8 characters.');
    setLoading(true);
    try {
      if (editing === 'new') {
        await api.createUser({ username: username.trim(), fullName: fullName.trim(), email: email.trim(), role, isActive, password });
      } else if (editing) {
        await api.updateUser(editing.id, { username: username.trim(), fullName: fullName.trim(), email: email.trim(), role, isActive, password: password || undefined });
      }
      closeForm();
      onSuccess();
    } catch (error) {
      alert('Error: ' + (error instanceof Error ? error.message : 'Could not save user'));
    } finally {
      setLoading(false);
    }
  };

  const deactivate = async (user: UserProfile) => {
    if (user.id === currentUser.id) return alert('You cannot deactivate your own session from here.');
    if (!confirm(`Deactivate ${user.fullName}?`)) return;
    setLoading(true);
    try {
      await api.deactivateUser(user.id);
      onSuccess();
    } catch (error) {
      alert('Error: ' + (error instanceof Error ? error.message : 'Could not deactivate user'));
    } finally {
      setLoading(false);
    }
  };

  return <div className='modal-overlay' onClick={onClose}>
    <div className='modal-panel account-manager-modal user-manager-modal' onClick={event => event.stopPropagation()}>
      <div className='modal-head'><span>User roles</span><button onClick={onClose}><X size={22} /></button></div>
      <div className='modal-body'>
        {editing ? <div className='account-form'>
          <div className='account-form-heading'><UsersRound size={34} /><div><strong>{editing === 'new' ? 'Add user' : 'Edit user'}</strong><span>Managers assign one role per user. The backend enforces each role.</span></div></div>
          <div className='account-form-grid'>
            <div className='field'><label>Username</label><input value={username} onChange={event => setUsername(event.target.value)} /></div>
            <div className='field'><label>Full name</label><input value={fullName} onChange={event => setFullName(event.target.value)} /></div>
            <div className='field account-form-wide'><label>Email</label><input value={email} onChange={event => setEmail(event.target.value)} /></div>
            <div className='field'><label>Role</label><select value={role} onChange={event => setRole(event.target.value as UserRole)}>{userRoles.map(item => <option key={item} value={item}>{userRoleLabels[item]}</option>)}</select></div>
            <label className='account-enabled-toggle'><input type='checkbox' checked={isActive} onChange={event => setIsActive(event.target.checked)} /><span>Active user</span></label>
            <div className='field account-form-wide'><label>{editing === 'new' ? 'Password' : 'New password'}</label><input type='password' value={password} onChange={event => setPassword(event.target.value)} autoComplete='new-password' /></div>
          </div>
          <div className='account-form-actions'><button className='btn-outline' onClick={closeForm}>Cancel</button><button className='btn-primary' onClick={saveUser} disabled={loading}>{loading ? <Loader2 className='spin' size={17} /> : <ShieldCheck size={17} />}Save user</button></div>
        </div> : <div className='account-list-view'>
          <div className='account-list-intro'><div><strong>{users.length} workspace {users.length === 1 ? 'user' : 'users'}</strong><span>Assign a role and password, then give the user both. They sign in through Team member access.</span></div><button className='btn-primary' onClick={() => openForm()}><UsersRound size={16} />Add user</button></div>
          <div className='user-role-list'>{users.map(user => <article className='user-role-row' key={user.id}>
            <span className='workboard-user'>{roleInitials[user.role]}</span>
            <span><strong>{user.fullName}</strong><small>{user.username} - {userRoleLabels[user.role]}</small></span>
            <span className={`schedule-status ${user.isActive ? 'active' : 'inactive'}`}>{user.isActive ? 'active' : 'inactive'}</span>
            <button className='btn-outline' onClick={() => openForm(user)}><Pencil size={14} />Edit</button>
            <button className='btn-danger ghost-danger' onClick={() => deactivate(user)} disabled={loading || user.id === currentUser.id || !user.isActive}><Trash2 size={14} /></button>
          </article>)}</div>
        </div>}
      </div>
    </div>
  </div>;
}

function ActivityLogModal({ activityLogs, onClose }: {
  activityLogs: ActivityLog[];
  onClose: () => void;
}) {
  return <div className='modal-overlay' onClick={onClose}>
    <div className='modal-panel account-manager-modal activity-log-modal' onClick={event => event.stopPropagation()}>
      <div className='modal-head'><span>Operations activity</span><button onClick={onClose}><X size={22} /></button></div>
      <div className='modal-body'>
        <div className='account-list-view'>
          <div className='account-list-intro'><div><strong>{activityLogs.length} recent events</strong><span>Audit trail for uploads, schedules, users, accounts, and automation.</span></div></div>
          <div className='activity-log-list'>{activityLogs.length === 0 ? <div className='account-list-empty'><ListFilter size={27} /><strong>No activity yet</strong><span>New actions will appear here after users start working.</span></div> : activityLogs.map(item => <article className='activity-log-row' key={item.id}>
            <span className='activity-dot' />
            <span><strong>{item.summary}</strong><small>{item.actorName ?? item.actorUsername ?? 'System'} - {item.action}</small></span>
            <time>{formatEventTime(item.createdAt)}</time>
          </article>)}</div>
        </div>
      </div>
    </div>
  </div>;
}

function uploadPostFormat(upload: PlatformUpload): PostFormat {
  if (upload.postFormat) return upload.postFormat;
  if (upload.mimeType.startsWith('image/')) return 'image';
  if (upload.mimeType.startsWith('video/')) return 'video';
  return 'text';
}

function useSecurePublishingMedia(fileName: string, enabled: boolean) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!enabled || !fileName) { setUrl(''); return; }
    let active = true;
    let objectUrl = '';
    api.media(fileName).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => active && setUrl(''));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [enabled, fileName]);
  return url;
}

function PostMediaPreview({ upload, compact = false, networkPreview = false }: { upload: PlatformUpload; compact?: boolean; networkPreview?: boolean }) {
  const postFormat = uploadPostFormat(upload);
  const mediaUrl = useSecurePublishingMedia(upload.fileName, postFormat !== 'text');
  if (postFormat === 'text') {
    return compact ? <div className='post-preview-text'><FileText size={22} /><span>Text</span></div> : null;
  }
  if (!mediaUrl) return <div className='post-preview-file'><Loader2 className='spin' size={22} /><span>Loading media</span></div>;
  if (upload.mimeType.startsWith('image/')) return <img src={mediaUrl} alt='' />;
  if (upload.mimeType.startsWith('video/')) return <video src={mediaUrl} controls={!compact && !networkPreview} muted playsInline autoPlay={compact} loop={compact} />;
  return <div className='post-preview-file'><FileText size={28} /><span>{upload.originalName}</span></div>;
}

function SubmissionMediaPreview({ submission }: { submission: ContentSubmission }) {
  const mediaUrl = useSecurePublishingMedia(submission.fileName, submission.postFormat !== 'text');
  if (submission.postFormat === 'text') return <FileText size={24} />;
  if (!mediaUrl) return <Loader2 className='spin' size={22} />;
  return submission.mimeType.startsWith('image/')
    ? <img src={mediaUrl} alt='' />
    : <video src={mediaUrl} muted controls playsInline />;
}

function PlatformPostPreview({
  upload,
  title,
  caption,
}: {
  upload: PlatformUpload;
  title: string;
  caption: string;
}) {
  const displayTitle = title.trim() || upload.originalName;
  const postFormat = uploadPostFormat(upload);
  const isYouTubeCommunity = upload.platform === 'youtube' && postFormat !== 'video';
  const handle = upload.platform === 'youtube' ? 'AgenticThat' : '@agenticthat';
  const networkLabel = upload.platform === 'x' ? 'Post' : isYouTubeCommunity ? 'Community post preview' : upload.platform === 'youtube' ? 'Video preview' : 'Post preview';

  return (
    <section className={`platform-post-preview preview-${upload.platform}`} aria-label={`${platformLabels[upload.platform]} post preview`}>
      <header><span>Platform preview</span><CustomIcon platform={upload.platform} size={19} /></header>
      <article className='preview-post-card'>
        <div className='preview-post-account'><CustomIcon platform={upload.platform} size={28} /><div><strong>{handle}</strong><small>{networkLabel}</small></div><span>•••</span></div>
        {(upload.platform !== 'youtube' || isYouTubeCommunity) && <p className='preview-post-caption'>{caption || 'Write a caption to see it here.'}</p>}
        {postFormat !== 'text' && <div className='preview-post-media'><PostMediaPreview upload={upload} /></div>}
        {upload.platform === 'youtube' && !isYouTubeCommunity && <div className='preview-youtube-copy'><strong>{displayTitle}</strong><span>{caption || 'Write a description to see it here.'}</span></div>}
        {(upload.platform !== 'youtube' || isYouTubeCommunity) && <div className='preview-post-actions'><span>{upload.platform === 'x' ? 'Reply  Repost  Like' : upload.platform === 'linkedin' ? 'Like  Comment  Repost' : 'Like  Comment  Share'}</span><small>Preview only</small></div>}
      </article>
      <p className='preview-note'>This is a layout preview. Final platform formatting may vary slightly after publishing.</p>
    </section>
  );
}

function NetworkPostPreview({
  upload,
  account,
  title,
  caption,
}: {
  upload: PlatformUpload;
  account?: PlatformAccount;
  title: string;
  caption: string;
}) {
  const displayTitle = title.trim() || upload.originalName;
  const postFormat = uploadPostFormat(upload);
  const isYouTubeCommunity = upload.platform === 'youtube' && postFormat !== 'video';
  const postText = caption.trim() || (upload.platform === 'youtube' ? 'Write a description to see it here.' : 'Write a caption to see it here.');
  const previewNames: Record<Platform, string> = { instagram: 'AgenticThat', x: 'AgenticThat', linkedin: 'AgenticThat', facebook: 'AgenticThat', youtube: 'AgenticThat' };
  const previewHandles: Record<Platform, string> = { instagram: '@agenticthat', x: '@agenticthat', linkedin: 'AgenticThat', facebook: 'AgenticThat', youtube: '@agenticthat' };
  const accountName = account?.displayName ?? previewNames[upload.platform];
  const accountHandle = account?.handle ?? previewHandles[upload.platform];
  const avatarLetter = (accountName.trim()[0] || 't').toLowerCase();
  const profile = (name: string, detail: string) => <div className='network-profile'><span className={`network-avatar ${upload.platform === 'youtube' ? 'yt-letter' : ''}`}>{upload.platform === 'youtube' ? avatarLetter : ''}</span><span><strong>{name}</strong><small>{detail}</small></span><MoreHorizontal size={18} /></div>;
  const media = postFormat === 'text' ? null : <div className={`network-media ${postFormat === 'video' ? 'network-video' : ''}`}><PostMediaPreview upload={upload} networkPreview /></div>;

  return (
    <section className={`platform-post-preview network-preview preview-${upload.platform}`} aria-label={`${platformLabels[upload.platform]} post preview`}>
      <header><span>Live {platformLabels[upload.platform]} preview</span><small>Updates as you edit</small></header>

      {upload.platform === 'instagram' && <article className='network-post instagram-post'>
        {profile(accountHandle, accountName)}
        {media}
        <div className='instagram-actions'><span><Heart size={19} /><MessageCircle size={19} /><Send size={18} /></span><Bookmark size={18} /></div>
        <span className='network-meta'>Preview engagement</span>
        <p className='instagram-caption'><strong>{accountHandle}</strong> {postText}</p>
      </article>}

      {upload.platform === 'x' && <article className='network-post x-post'>
        <div className='x-account'><span className='network-avatar' /><div><strong>{accountName}</strong><span>{accountHandle} · 29m</span></div><MoreHorizontal size={18} /></div>
        <p className='x-copy'>{postText}</p>
        {media}
        <div className='x-actions'><MessageCircle size={15} /><Repeat2 size={16} /><Heart size={16} /><Eye size={16} /><Share2 size={15} /></div>
      </article>}

      {upload.platform === 'linkedin' && <article className='network-post linkedin-post'>
        {profile(accountName, `${accountHandle} · now`)}
        <p className='linkedin-copy'>{postText}</p>
        {media}
        <div className='linkedin-summary'><span><ThumbsUp size={13} /> <i /> <i /></span><small>Like · Comment</small></div>
        <div className='linkedin-actions'><span><ThumbsUp size={16} /> Like</span><span><MessageCircle size={16} /> Comment</span><span><Repeat2 size={16} /> Repost</span><span><Send size={16} /> Send</span></div>
      </article>}

      {upload.platform === 'facebook' && <article className='network-post facebook-post'>
        {profile(accountName, '13m · Public')}
        <p className='facebook-copy'>{postText}</p>
        {media}
        <div className='facebook-summary'><span><ThumbsUp size={13} /> <Heart size={13} /></span><small>Preview reactions</small></div>
        <div className='facebook-actions'><span><ThumbsUp size={16} /> Like</span><span><MessageCircle size={16} /> Comment</span><span><Share2 size={16} /> Share</span></div>
      </article>}

      {upload.platform === 'youtube' && !isYouTubeCommunity && <article className='network-post youtube-post'>
        <div className='youtube-media'>{media}<span>0:00</span></div>
        <div className='youtube-copy'><strong>{displayTitle}</strong><span>{accountName} · {accountHandle}</span><p>{postText}</p></div>
      </article>}

      {upload.platform === 'youtube' && isYouTubeCommunity && <article className='network-post youtube-community-post'>
        {profile(accountName, `${accountHandle} · Community`)}
        <p className='youtube-community-copy'>{postText}</p>
        {media}
        <div className='facebook-actions'><span><ThumbsUp size={16} /> Like</span><span><MessageCircle size={16} /> Comment</span><span><Share2 size={16} /> Share</span></div>
      </article>}

      <p className='preview-note'>Content placement and media crop match the target network. The platform applies final fonts and metadata at publish time.</p>
    </section>
  );
}

function EditPostModal({
  upload,
  accounts,
  schedules,
  permissions,
  onClose,
  onSuccess,
}: {
  upload: PlatformUpload;
  accounts: PlatformAccount[];
  schedules: PublishingSchedule[];
  permissions: RolePermissions;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [title, setTitle] = useState(upload.title ?? upload.caption ?? "");
  const [caption, setCaption] = useState(upload.caption ?? "");
  const [accountId, setAccountId] = useState(upload.accountId);
  const [scheduleMode, setScheduleMode] = useState<'none' | 'exact' | 'template'>(upload.scheduleId ? 'template' : upload.scheduledAt ? 'exact' : 'none');
  const [scheduleId, setScheduleId] = useState<number | ''>(upload.scheduleId ?? '');
  const [schedule, setSchedule] = useState(
    upload.scheduledAt ? toLocalDateTimeInputValue(new Date(upload.scheduledAt)) : "",
  );
  const [minimumSchedule] = useState(() => toLocalDateTimeInputValue(new Date(Date.now() + 60_000)));
  const [loading, setLoading] = useState(false);
  const isYouTube = upload.platform === "youtube";
  const postFormat = uploadPostFormat(upload);
  const isYouTubeVideo = isYouTube && postFormat === "video";
  const canEditContent = permissions.canEditContent;
  const canEditSchedule = permissions.canSchedulePosts;

  const save = async () => {
    if (canEditContent && !caption.trim()) return alert(postFormat === "text" ? "Post text is required" : "Caption is required");
    if (canEditContent && isYouTubeVideo && !title.trim()) return alert("Video title is required");

    const scheduledDate = scheduleMode === 'exact' && schedule ? new Date(schedule) : null;
    if (canEditSchedule && scheduleMode === 'exact' && !scheduledDate) return alert("Choose a scheduled date and time.");
    if (canEditSchedule && scheduleMode === 'template' && !scheduleId) return alert("Choose a schedule template.");
    if (scheduledDate && (!Number.isFinite(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now())) {
      return alert("Choose a scheduled date and time in the future");
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {};
      if (canEditContent) {
        payload.title = isYouTubeVideo ? title.trim() : undefined;
        payload.caption = caption.trim();
        payload.accountId = accountId;
      }
      if (canEditSchedule) {
        payload.scheduledAt = scheduleMode === 'exact' ? scheduledDate?.toISOString() ?? null : null;
        payload.scheduleId = scheduleMode === 'template' ? Number(scheduleId) : null;
      }
      if (canEditSchedule && scheduleMode !== 'none') {
        const destinations: UnifiedPostDestinationInput[] = [{
          accountId,
          ...(scheduleMode === 'exact'
            ? { scheduledAt: scheduledDate!.toISOString() }
            : { scheduleId: Number(scheduleId) }),
        }];
        await api.assessPublishingSafety(postFormat, destinations);

if (permissions.canRunAutomation) {
  await api.authorizePublishing();
}
      }
      await api.updateUploadDetails(upload.id, payload as any);
      onSuccess();
      onClose();
    } catch (error) {
      alert((error instanceof PublishingSafetyApiError ? "Safety warning: " : "Error: ") + (error instanceof Error ? error.message : "Could not save post"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel preview-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-head"><span>{canEditContent && canEditSchedule ? 'Edit post' : canEditSchedule ? 'Schedule post' : 'Edit content'}</span><button onClick={onClose}><X size={22} /></button></div>
        <div className="modal-body">
          <div className="post-editor-workspace">
            <div className="post-editor-form">
              {upload.status === 'failed' && upload.failureReason && <div className='workspace-error' role='alert'><CircleAlert size={18} /><span><strong>Publishing needs attention</strong><small>{upload.failureReason}</small></span></div>}
              <div className="edit-source-row">
                <CustomIcon platform={upload.platform} size={28} />
                <div><strong>{upload.originalName}</strong><span>{platformLabels[upload.platform]}</span></div>
              </div>
              <div className='field'><label>Publish through account</label><select value={accountId} onChange={event => setAccountId(event.target.value)} disabled={!canEditContent}>{accounts.map(account => <option key={account.id} value={account.id}>{account.displayName} ({account.handle}) - {publishingEngineLabels[accountPublishingEngine(account)]}{account.enabled ? '' : ' - paused'}</option>)}</select></div>
              {isYouTubeVideo && (
                <div className="field"><label>Video title</label><input type="text" value={title} onChange={event => setTitle(event.target.value)} disabled={!canEditContent} /></div>
              )}
              <div className="field">
                <label>{postFormat === "text" ? "Post text" : isYouTube ? "Description" : "Caption"}</label>
                <textarea rows={5} value={caption} onChange={event => setCaption(event.target.value)} disabled={!canEditContent} />
              </div>
              <div className="field">
                <label>Schedule option</label>
                <select value={scheduleMode} onChange={event => setScheduleMode(event.target.value as 'none' | 'exact' | 'template')} disabled={!canEditSchedule}>
                  <option value='none'>No schedule yet</option>
                  <option value='exact'>Exact date and time</option>
                  <option value='template'>Use schedule template</option>
                </select>
              </div>
              {scheduleMode === 'exact' && <div className="field">
                <label>Scheduled date and time</label>
                <input type="datetime-local" min={minimumSchedule} value={schedule} onChange={event => setSchedule(event.target.value)} disabled={!canEditSchedule} />
              </div>}
              {scheduleMode === 'template' && <div className="field">
                <label>Schedule template</label>
                <select value={scheduleId} onChange={event => setScheduleId(event.target.value ? Number(event.target.value) : '')} disabled={!canEditSchedule}>
                  <option value=''>Choose schedule</option>
                  {schedules.map(scheduleItem => <option key={scheduleItem.id} value={scheduleItem.id}>#{scheduleItem.id} {scheduleItem.name} - {scheduleFrequencyLabels[scheduleItem.frequency]} at {scheduleItem.time}{scheduleItem.status === 'inactive' ? ' (inactive)' : ''}</option>)}
                </select>
                <small className='field-help'>This applies only to this post.</small>
              </div>}
            </div>
            <NetworkPostPreview upload={upload} account={accounts.find(account => account.id === accountId)} title={title} caption={caption} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={loading}>
            {loading ? <Loader2 className="spin" size={17} /> : <Pencil size={17} />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
