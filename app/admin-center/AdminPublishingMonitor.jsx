"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  CalendarClock,
  CheckCircle2,
  Eye,
  FileImage,
  Heart,
  Loader2,
  MessageCircle,
  MonitorUp,
  MoreHorizontal,
  Play,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  Share2,
  ThumbsUp,
  UsersRound,
  Video,
} from "lucide-react";
import { FaFacebook, FaInstagram, FaLinkedin, FaXTwitter, FaYoutube } from "react-icons/fa6";

const PLATFORM_LABELS = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
};

const PLATFORM_ORDER = ["instagram", "facebook", "x", "linkedin", "youtube"];

function PlatformIcon({ platform, size = 20 }) {
  const props = { size, style: { display: "block" }, "aria-hidden": true };
  if (platform === "instagram") return <FaInstagram {...props} color="#e4405f" />;
  if (platform === "facebook") return <FaFacebook {...props} color="#1877f2" />;
  if (platform === "x") return <FaXTwitter {...props} color="#0f1419" />;
  if (platform === "linkedin") return <FaLinkedin {...props} color="#0a66c2" />;
  if (platform === "youtube") return <FaYoutube {...props} color="#ff0000" />;
  return <MonitorUp size={size} aria-hidden="true" />;
}

function formatMoment(value) {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time not recorded";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "Media";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function postTimestamp(post) {
  return post.postedAt || post.updatedAt || post.uploadedAt || post.scheduledAt || null;
}

function monitorState(post) {
  if (post.status === "failed" || ["failed", "uncertain", "reconnect_required"].includes(post.statusDetail)) return "attention";
  if (post.status === "posted" || post.statusDetail === "published") return "published";
  if (post.status === "processing" || ["claimed", "running", "opening_platform", "uploading", "publishing"].includes(post.statusDetail)) return "active";
  return "scheduled";
}

const STATE_LABELS = {
  published: "Published",
  active: "Publishing",
  scheduled: "Scheduled",
  attention: "Needs attention",
};

function StatusBadge({ post, compact = false }) {
  const state = monitorState(post);
  const Icon = state === "published" ? CheckCircle2 : state === "attention" ? AlertTriangle : state === "active" ? MonitorUp : CalendarClock;
  return <span className={`monitor-status status-${state}${compact ? " compact" : ""}`}><Icon size={compact ? 12 : 13} />{STATE_LABELS[state]}</span>;
}

function AccountAvatar({ post }) {
  const label = post.linkedinTarget?.name || post.account?.displayName || PLATFORM_LABELS[post.platform] || "A";
  return <span className={`monitor-network-avatar avatar-${post.platform}`}>{String(label).trim().charAt(0).toUpperCase()}</span>;
}

function accountName(post) {
  return post.linkedinTarget?.name || post.account?.displayName || PLATFORM_LABELS[post.platform] || "Social account";
}

function accountHandle(post) {
  const handle = post.account?.handle || "";
  if (!handle) return accountName(post);
  if (["instagram", "x", "youtube"].includes(post.platform) && !handle.startsWith("@")) return `@${handle}`;
  return handle;
}

function MonitorMedia({ post }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
    setPlaying(false);
    setPreviewFailed(false);
    setRetry(0);
  }, [post.mediaUrl, post.previewUrl]);

  if (!post.hasMedia) return null;
  if (!post.mediaPreviewAvailable || !post.mediaUrl || failed) {
    const Icon = post.postFormat === "video" ? Video : FileImage;
    return <div className="monitor-media-fallback"><Icon size={28} /><strong>Original media unavailable</strong><span>{post.originalName} · {formatBytes(post.size)}</span>{failed && <button type="button" onClick={() => { setFailed(false); setRetry((current) => current + 1); }}>Retry media</button>}</div>;
  }
  const versionedSource = (value) => retry ? `${value}${value.includes("?") ? "&" : "?"}retry=${retry}` : value;
  const originalSource = versionedSource(post.mediaUrl);
  const previewSource = post.previewUrl && !previewFailed ? versionedSource(post.previewUrl) : null;
  if (post.postFormat === "video" || String(post.mimeType).startsWith("video/")) {
    if (previewSource && !playing) {
      return <button className="monitor-video-poster" type="button" onClick={() => { setLoaded(false); setPlaying(true); }} aria-label={`Play ${post.originalName}`}><img className={loaded ? "monitor-media-ready" : "monitor-media-pending"} src={previewSource} alt={`Video preview for ${post.originalName}`} loading="eager" decoding="async" fetchPriority="high" onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); setPreviewFailed(true); }} />{!loaded && <span className="monitor-media-progress"><Loader2 className="spin" size={20} />Loading video preview…</span>}{loaded && <span className="monitor-video-play"><Play size={20} fill="currentColor" />Play original video</span>}</button>;
    }
    return <><video className={loaded ? "monitor-media-ready" : "monitor-media-pending"} src={`${originalSource}#t=0.1`} controls preload="metadata" playsInline autoPlay={playing} onLoadedData={() => setLoaded(true)} onError={() => setFailed(true)} />{!loaded && <span className="monitor-media-progress"><Loader2 className="spin" size={20} />Preparing video preview…</span>}</>;
  }
  const imageSource = previewSource || originalSource;
  return <><img className={loaded ? "monitor-media-ready" : "monitor-media-pending"} src={imageSource} alt={`Original ${PLATFORM_LABELS[post.platform] || "social"} post media`} loading="eager" decoding="async" fetchPriority="high" onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); if (previewSource) setPreviewFailed(true); else setFailed(true); }} />{!loaded && <span className="monitor-media-progress"><Loader2 className="spin" size={20} />Loading media preview…</span>}</>;
}

function PreviewProfile({ post, detail }) {
  return <div className="monitor-preview-profile"><AccountAvatar post={post} /><span><strong>{accountName(post)}</strong><small>{detail}</small></span><MoreHorizontal size={17} /></div>;
}

function InstagramPreview({ post }) {
  return <div className="monitor-native-card instagram-card">
    <PreviewProfile post={post} detail={accountHandle(post)} />
    <div className="monitor-square-media"><MonitorMedia post={post} /></div>
    <div className="monitor-instagram-actions"><span><Heart /><MessageCircle /><Send /></span><Bookmark /></div>
    <div className="monitor-native-copy instagram-copy"><strong>{accountHandle(post)}</strong><span>{post.caption}</span></div>
  </div>;
}

function FacebookPreview({ post }) {
  return <div className="monitor-native-card facebook-card">
    <PreviewProfile post={post} detail="Public post" />
    <div className="monitor-native-copy block-copy">{post.caption}</div>
    {post.hasMedia && <div className="monitor-wide-media facebook-media"><MonitorMedia post={post} /></div>}
    <div className="monitor-reaction-line"><span><ThumbsUp size={12} /><Heart size={12} /></span><small>Original content preview</small></div>
    <div className="monitor-action-line"><span><ThumbsUp />Like</span><span><MessageCircle />Comment</span><span><Share2 />Share</span></div>
  </div>;
}

function XPreview({ post }) {
  return <div className="monitor-native-card x-card">
    <AccountAvatar post={post} />
    <div className="monitor-x-body">
      <div className="monitor-x-name"><strong>{accountName(post)}</strong><span>{accountHandle(post)} · now</span><MoreHorizontal size={16} /></div>
      <div className="monitor-native-copy block-copy">{post.caption}</div>
      {post.hasMedia && <div className="monitor-wide-media x-media"><MonitorMedia post={post} /></div>}
      <div className="monitor-x-actions"><MessageCircle /><Repeat2 /><Heart /><Eye /><Share2 /></div>
    </div>
  </div>;
}

function LinkedInPreview({ post }) {
  return <div className="monitor-native-card linkedin-card">
    <PreviewProfile post={post} detail={`${accountHandle(post)} · now`} />
    <div className="monitor-native-copy block-copy">{post.caption}</div>
    {post.hasMedia && <div className="monitor-wide-media linkedin-media"><MonitorMedia post={post} /></div>}
    <div className="monitor-reaction-line"><span><ThumbsUp size={12} /> <i /><i /></span><small>Original content preview</small></div>
    <div className="monitor-action-line four"><span><ThumbsUp />Like</span><span><MessageCircle />Comment</span><span><Repeat2 />Repost</span><span><Send />Send</span></div>
  </div>;
}

function YouTubePreview({ post }) {
  const communityPost = post.postFormat !== "video";
  if (communityPost) return <div className="monitor-native-card youtube-community-card">
    <PreviewProfile post={post} detail={`${accountHandle(post)} · Community`} />
    <div className="monitor-native-copy block-copy">{post.caption}</div>
    {post.hasMedia && <div className="monitor-wide-media youtube-community-media"><MonitorMedia post={post} /></div>}
    <div className="monitor-action-line"><span><ThumbsUp />Like</span><span><MessageCircle />Comment</span><span><Share2 />Share</span></div>
  </div>;

  const visibility = post.platformOptions?.youtube?.visibility;
  return <div className="monitor-native-card youtube-card">
    <div className="monitor-youtube-media"><MonitorMedia post={post} /><span className="monitor-video-label"><Play size={12} fill="currentColor" /> Original video</span></div>
    <div className="monitor-youtube-title"><strong>{post.title || post.originalName}</strong><MoreHorizontal size={18} /></div>
    <div className="monitor-youtube-channel"><AccountAvatar post={post} /><span><strong>{accountName(post)}</strong><small>{accountHandle(post)}{visibility ? ` · ${visibility}` : ""}</small></span></div>
    <div className="monitor-youtube-description">{post.caption}</div>
  </div>;
}

function PlatformPreview({ post }) {
  return <article className={`monitor-platform-preview platform-${post.platform}`}>
    <div className="monitor-platform-bar"><span><PlatformIcon platform={post.platform} /><strong>{PLATFORM_LABELS[post.platform] || post.platform}</strong></span><StatusBadge post={post} compact /></div>
    {post.platform === "instagram" && <InstagramPreview post={post} />}
    {post.platform === "facebook" && <FacebookPreview post={post} />}
    {post.platform === "x" && <XPreview post={post} />}
    {post.platform === "linkedin" && <LinkedInPreview post={post} />}
    {post.platform === "youtube" && <YouTubePreview post={post} />}
    <div className="monitor-post-meta">
      <span><strong>{post.linkedinTarget?.name || accountName(post)}</strong><small>{post.linkedinTarget ? `Managed Page · ${accountName(post)}` : accountHandle(post)} · {post.originalName} · {formatBytes(post.size)}</small></span>
      <span className="monitor-post-meta-actions"><time>{formatMoment(post.postedAt || post.scheduledAt || post.updatedAt)}</time>{post.mediaUrl && <a href={post.mediaUrl} target="_blank" rel="noreferrer">Open original</a>}</span>
    </div>
    {post.failureReason && <div className="monitor-failure"><AlertTriangle size={13} /><span>{post.failureReason}</span></div>}
  </article>;
}

function SummaryMetric({ icon: Icon, label, value, tone }) {
  return <article className={`monitor-metric tone-${tone}`}><span><Icon size={18} /></span><div><strong>{Number(value || 0).toLocaleString()}</strong><small>{label}</small></div></article>;
}

export default function AdminPublishingMonitor() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [workspaceId, setWorkspaceId] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [status, setStatus] = useState("all");
  const [visibleCount, setVisibleCount] = useState(4);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin-center/publishing", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to load publishing activity.");
      setSnapshot(data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load({ silent: true }), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => setVisibleCount(4), [query, workspaceId, platform, status]);

  const posts = snapshot?.posts || [];
  const workspaces = useMemo(() => {
    const values = new Map();
    posts.forEach((post) => values.set(post.workspace.id, post.workspace));
    return [...values.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [posts]);

  const platformCounts = useMemo(() => {
    const counts = Object.fromEntries(PLATFORM_ORDER.map((item) => [item, 0]));
    posts.forEach((post) => { counts[post.platform] = (counts[post.platform] || 0) + 1; });
    return counts;
  }, [posts]);

  const filteredPosts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const mediaUrls = new Map();
    return posts.filter((post) => {
      if (workspaceId !== "all" && post.workspace.id !== workspaceId) return false;
      if (platform !== "all" && post.platform !== platform) return false;
      if (status !== "all" && monitorState(post) !== status) return false;
      if (!normalizedQuery) return true;
      return [post.caption, post.title, post.originalName, post.workspace.name, post.author.name, post.author.email, post.account?.displayName, post.account?.handle, post.linkedinTarget?.name]
        .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => Date.parse(postTimestamp(right) || 0) - Date.parse(postTimestamp(left) || 0))
      .map((post) => {
        if (!post.mediaUrl) return post;
        const submissionKey = post.sourceSubmissionId
          || [post.createdByUserId, String(post.uploadedAt || post.updatedAt || "").slice(0, 19), post.originalName].join(":");
        const mediaKey = [post.workspaceId, submissionKey, post.mimeType, post.size].join(":");
        const sharedUrls = mediaUrls.get(mediaKey) || { mediaUrl: post.mediaUrl, previewUrl: post.previewUrl };
        mediaUrls.set(mediaKey, sharedUrls);
        return { ...post, ...sharedUrls };
      });
  }, [posts, query, workspaceId, platform, status]);

  const totals = snapshot?.totals || {};

  return <div className="admin-publishing-monitor">
    <header className="monitor-hero">
      <div className="monitor-hero-copy"><span className="monitor-hero-icon"><MonitorUp size={22} /></span><div><span className="monitor-kicker">Global publishing activity</span><h1>Publishing monitor</h1><small>Every user, original asset and destination-specific post in one review surface.</small></div></div>
      <div className="monitor-live-card"><span><i />Monitoring live</span><small>{snapshot?.generatedAt ? `Updated ${formatMoment(snapshot.generatedAt)}` : "Waiting for activity"}</small><button className="monitor-refresh" type="button" onClick={() => load({ silent: true })} disabled={refreshing} aria-label="Refresh publishing activity"><RefreshCw className={refreshing ? "spin" : ""} size={16} />Refresh</button></div>
    </header>

    {loading && !snapshot && <div className="monitor-loading"><Loader2 className="spin" size={22} /><span>Loading publishing activity…</span></div>}
    {error && <div className="monitor-error"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={() => load()}>Try again</button></div>}

    {snapshot && <>
      <section className="monitor-metrics" aria-label="Publishing summary">
        <SummaryMetric icon={MonitorUp} label="Posts monitored" value={totals.posts} tone="neutral" />
        <SummaryMetric icon={CheckCircle2} label="Published" value={totals.published} tone="success" />
        <SummaryMetric icon={CalendarClock} label="Queued & scheduled" value={totals.scheduled} tone="scheduled" />
        <SummaryMetric icon={AlertTriangle} label="Needs attention" value={totals.needsAttention} tone="danger" />
        <SummaryMetric icon={UsersRound} label="Active workspaces" value={totals.workspaces} tone="workspace" />
      </section>

      <section className="monitor-controls" aria-label="Publishing filters">
        <label className="monitor-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search content, user, account…" /></label>
        <label><span>Workspace</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="all">All workspaces</option>{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select></label>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Every status</option><option value="published">Published</option><option value="active">Publishing now</option><option value="scheduled">Queued & scheduled</option><option value="attention">Needs attention</option></select></label>
        <div className="monitor-platform-filters"><button type="button" className={platform === "all" ? "active" : ""} onClick={() => setPlatform("all")}>All <small>{posts.length}</small></button>{PLATFORM_ORDER.map((item) => <button type="button" className={platform === item ? `active platform-${item}` : `platform-${item}`} onClick={() => setPlatform(item)} key={item}><PlatformIcon platform={item} size={16} /><span>{PLATFORM_LABELS[item]}</span><small>{platformCounts[item] || 0}</small></button>)}</div>
      </section>

      <div className="monitor-results-heading"><span><strong>{filteredPosts.length}</strong> destination {filteredPosts.length === 1 ? "post" : "posts"}</span><small>Two posts per row · original media and final copy</small></div>

      <section className="monitor-feed">
        {filteredPosts.length === 0 && <div className="monitor-empty"><span><Search size={23} /></span><strong>No publishing activity matches these filters</strong><small>Clear a filter or wait for users to submit a new post.</small></div>}
        {filteredPosts.slice(0, visibleCount).map((post) => {
          return <article className="monitor-event" key={post.id}>
            <header className="monitor-event-summary">
              <div className="monitor-event-person"><div className="monitor-author-avatar">{String(post.author.name || post.author.email || "U").charAt(0).toUpperCase()}</div><div className="monitor-event-identity"><small>Created by</small><strong>{post.author.name}</strong><span>{post.author.email || "Account email unavailable"}</span></div></div>
              <dl className="monitor-event-facts"><div><dt>Workspace</dt><dd>{post.workspace.name}</dd></div><div><dt>Activity time</dt><dd>{formatMoment(postTimestamp(post))}</dd></div></dl>
            </header>
            <PlatformPreview post={post} />
          </article>;
        })}
      </section>

      {visibleCount < filteredPosts.length && <button className="monitor-load-more" type="button" onClick={() => setVisibleCount((current) => current + 4)}>Show 4 more posts</button>}
    </>}
  </div>;
}
