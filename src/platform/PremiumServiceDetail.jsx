"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  BarChart3,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  FileText,
  Globe2,
  Hash,
  Heart,
  Image as ImageIcon,
  Link2,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Play,
  Repeat2,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Smile,
  Sparkles,
  ThumbsUp,
  UploadCloud,
  Users,
} from "lucide-react";
import {
  PiBriefcaseBold,
  PiBroadcastBold,
  PiCalendarDotsBold,
  PiChartLineUpBold,
  PiChatsCircleBold,
  PiCheckCircleBold,
  PiClockCountdownBold,
  PiDeviceMobileBold,
  PiDownloadSimpleBold,
  PiEyeBold,
  PiFileTextBold,
  PiFunnelBold,
  PiFingerprintBold,
  PiHeadsetBold,
  PiImageBold,
  PiLinkSimpleBold,
  PiLockKeyBold,
  PiMagnifyingGlassBold,
  PiPaperPlaneTiltBold,
  PiPencilSimpleBold,
  PiRocketLaunchBold,
  PiShieldCheckBold,
  PiTableBold,
  PiUploadSimpleBold,
  PiUsersThreeBold,
} from "react-icons/pi";
import { useEffect, useState } from "react";
import ProductShell from "./ProductShell";
import { serviceDetailHref } from "./product-catalog";
import { useProductStatus } from "./use-product-status";
import styles from "./premium-service-detail.module.css";

const publishingProfiles = {
  instagram: {
    account: "@agenticthat",
    heroTitle: "Instagram Publishing",
    heroDescription: "Create the post, see exactly how it will look, and choose the right publish time—all in one clear workflow.",
    headline: "Make every launch feel considered.",
    body: "A first look at our summer collection. Designed for slower days and brighter plans.",
    mediaLabel: "Summer collection",
    postType: "Instagram feed post · 4:5",
    scheduleTime: "4:00 PM",
    mediaClass: styles.instagramMedia,
    audience: [
      ["Brands and businesses", "Keep campaign posts consistent across every connected account."],
      ["Content teams", "Draft, review, and schedule visual content without switching tools."],
      ["Social media managers", "See upcoming posts and delivery results in one clear queue."],
    ],
  },
  youtube: {
    account: "AgenticThat",
    heroTitle: "YouTube Publishing",
    heroDescription: "Prepare the video, title, description, channel, and release time in one clear publishing workflow.",
    headline: "How AgenticThat turns one campaign into a clear publishing plan",
    body: "A practical walkthrough of composing, reviewing, scheduling, and tracking every channel from one workspace.",
    mediaLabel: "Publishing workflow, explained",
    postType: "Public video · 16:9",
    scheduleTime: "6:30 PM",
    mediaClass: styles.youtubeMedia,
    audience: [
      ["Creators and studios", "Prepare the video, title, description, and release time together."],
      ["Channel teams", "Coordinate releases without losing track of the destination channel."],
      ["Marketing teams", "Plan video and community updates alongside the wider campaign."],
    ],
  },
  facebook: {
    account: "AgenticThat",
    heroTitle: "Facebook Publishing",
    heroDescription: "Create page-ready updates, confirm the right account, preview the post, and schedule it with confidence.",
    headline: "A faster way to keep customers informed",
    body: "Your next update is ready: clear copy, approved media, and the right publish time—all organised in one shared workspace.",
    mediaLabel: "Customer update",
    postType: "Facebook Page post",
    scheduleTime: "11:30 AM",
    mediaClass: styles.facebookMedia,
    audience: [
      ["Local businesses", "Schedule page updates, announcements, and campaign posts."],
      ["Community teams", "Keep useful updates visible and publish them at the right time."],
      ["Marketing teams", "Manage page-specific copy and media from one publishing flow."],
    ],
  },
  x: {
    account: "@AgenticThat",
    heroTitle: "X Publishing",
    heroDescription: "Write concise updates, verify the publishing account, preview every detail, and send at the right moment.",
    headline: "A faster publishing workflow just shipped.",
    body: "Compose, preview, schedule, and track every channel from one AgenticThat workspace. Less switching. More clarity.",
    mediaLabel: "Product release",
    postType: "X post · Within 280 characters",
    scheduleTime: "2:15 PM",
    mediaClass: styles.xMedia,
    audience: [
      ["Product teams", "Prepare launches and updates while keeping every post concise."],
      ["Editorial teams", "Schedule timely posts and confirm exactly what went live."],
      ["Multi-account teams", "Choose the correct identity before an update enters the queue."],
    ],
  },
  linkedin: {
    account: "AgenticThat",
    heroTitle: "LinkedIn Publishing",
    heroDescription: "Prepare professional updates, preserve review context, and schedule every company post from one workspace.",
    headline: "Why content operations need one source of truth",
    body: "Strong publishing depends on clear ownership, review context, and delivery visibility. Here is the operating model our team uses.",
    mediaLabel: "Content operations playbook",
    postType: "Company Page update",
    scheduleTime: "9:30 AM",
    mediaClass: styles.linkedinMedia,
    audience: [
      ["Company teams", "Prepare polished updates for the right company or personal account."],
      ["B2B marketers", "Coordinate thought leadership, launches, and campaign schedules."],
      ["People teams", "Plan hiring and culture updates with a clear review history."],
    ],
  },
};

const categoryContent = {
  telegram: {
    heroTitle: "Telegram messaging, clear and connected.",
    heroDescription: "Connect accounts once, choose the right sender and recipient, and manage direct conversations from one secure workspace.",
    sectionTitle: "Everything your team needs for everyday Telegram messaging.",
    sectionIntro: "The account, recipient, message, and delivery result stay together, so the next step is always clear.",
    benefits: [
      [PiDeviceMobileBold, "Connect your account", "Complete Telegram verification once through a clear, guided setup."],
      [PiChatsCircleBold, "Find the right conversation", "Choose the connected account and recipient before you send."],
      [PiPaperPlaneTiltBold, "Send direct messages", "Write and send from a focused console with fewer moving parts."],
      [PiLockKeyBold, "Reuse secure sessions", "Return to approved accounts without entering a new code every day."],
    ],
    audience: [
      [PiBriefcaseBold, "Business teams", "Handle direct outreach and operational updates from approved accounts."],
      [PiUsersThreeBold, "Community managers", "Keep one-to-one conversations organized across multiple accounts."],
      [PiBroadcastBold, "Operations teams", "Deliver timely alerts while keeping the sending identity clear."],
    ],
  },
  publishing: {
    sectionTitle: "Everything you need to move a post from idea to published.",
    sectionIntro: "Media, copy, destination, timing, and delivery status stay in one clear flow.",
    benefits: [
      [PiPencilSimpleBold, "Prepare the post", "Write platform-ready copy and keep it beside the correct media."],
      [PiEyeBold, "Preview before publishing", "See the complete post before it reaches your audience."],
      [PiCalendarDotsBold, "Choose the right time", "Publish now or add the post to a deliberate content schedule."],
      [PiCheckCircleBold, "Know what happened", "See whether each post is queued, published, or needs attention."],
    ],
  },
  scraping: {
    heroTitle: "Turn public Instagram activity into a useful dataset.",
    heroDescription: "Start with a public profile, hashtag, keyword, post, or Reel URL. AgenticThat collects recent public results and organizes them into a table you can review or export.",
    sectionTitle: "From one public Instagram target to clean, useful results.",
    sectionIntro: "Choose what to collect, control the result window, and receive consistent fields instead of manually copying posts.",
    benefits: [
      [PiLinkSimpleBold, "Start from what you have", "Use a public profile, hashtag, keyword, post URL, or Reel URL."],
      [PiFunnelBold, "Keep results focused", "Choose how many recent items you need for the research task."],
      [PiTableBold, "Review clean records", "Compare captions, authors, dates, links, and public engagement in one table."],
      [PiDownloadSimpleBold, "Export your dataset", "Download CSV or JSON when you are ready to continue the analysis."],
    ],
    audience: [
      [PiMagnifyingGlassBold, "Researchers", "Collect recent public posts without building a manual spreadsheet."],
      [PiChartLineUpBold, "Marketing teams", "Review campaign, hashtag, creator, and competitor activity."],
      [PiFileTextBold, "Content teams", "Find themes, formats, and public signals for content planning."],
    ],
  },
};

function useAutoIndex(length, delay) {
  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % length), delay);
    return () => window.clearInterval(timer);
  }, [cycle, delay, length]);
  function selectIndex(nextIndex) {
    setIndex(nextIndex);
    setCycle((current) => current + 1);
  }
  return [index, selectIndex];
}

function actionFor(service, status) {
  if (status.state === "checking") return { label: "Checking connection", disabled: true };
  if (service.connectionKind === "none") return { label: "Open Instagram scraper", href: service.dashboardHref };
  if (status.state === "connected") return { label: `Open ${service.platformName} workspace`, href: service.dashboardHref };
  if (status.state === "continue") return { label: "Continue setup", href: service.configHref };
  return { label: `Connect ${service.platformName}`, href: service.configHref };
}

const telegramChats = [
  { id: "maya", avatar: "/avatars/maya-rao.svg", name: "Maya Rao", preview: "Can we confirm the launch?", time: "10:24", incoming: "Can we confirm the launch update for 4:00 PM?", outgoing: "Yes—everything is ready. I’ll send it at 4:00 PM." },
  { id: "arjun", avatar: "/avatars/arjun-kumar.svg", name: "Arjun Kumar", preview: "Files are ready to review.", time: "09:48", incoming: "The final files are ready. Should I share them with the team?", outgoing: "Please do. I’ve confirmed the review group and added the deadline." },
  { id: "priya", avatar: "/avatars/priya-shah.svg", name: "Priya Shah", preview: "Thanks, that works.", time: "Mon", incoming: "The customer update looks good. Can we send it this afternoon?", outgoing: "Absolutely. It’s scheduled for 3:30 PM and ready for delivery." },
];

function ProfileAvatar({ src, name, size = "regular" }) {
  return <span className={`${styles.avatar} ${size === "large" ? styles.avatarLarge : ""}`}><img src={src} alt={name} /></span>;
}

function TelegramDemo() {
  const views = [
    { id: "inbox", label: "Inbox", icon: MessageCircle },
    { id: "compose", label: "New message", icon: Send },
    { id: "accounts", label: "Accounts", icon: ShieldCheck },
  ];
  const [active, setActive] = useAutoIndex(views.length, 9200);

  return (
    <div className={`${styles.productDemo} ${styles.telegramProductDemo}`} aria-label="Telegram workspace preview">
      <div className={styles.demoTopbar}>
        <span className={styles.demoProduct}><img src="/telegram-logo.svg" alt="" /><strong>Telegram</strong><i />Ready</span>
        <span className={styles.demoAccount}>AgenticThat workspace</span>
      </div>
      <div className={styles.demoBody}>
        <nav className={styles.demoRail} aria-label="Telegram preview views">
          {views.map((view, index) => {
            const Icon = view.icon;
            return <button type="button" key={view.id} className={active === index ? styles.demoRailActive : ""} onClick={() => setActive(index)} aria-label={view.label} aria-pressed={active === index}><Icon size={19} /></button>;
          })}
        </nav>
        <div className={styles.demoStage}>
          <div className={styles.demoStageTabs}>
            {views.map((view, index) => <button type="button" key={view.id} className={active === index ? styles.demoTabActive : ""} onClick={() => setActive(index)} aria-pressed={active === index}>{view.label}</button>)}
          </div>
          <div className={styles.demoTransition}>
            <div className={`${styles.telegramScene} ${active === 0 ? styles.telegramSceneActive : ""}`} aria-hidden={active !== 0}><TelegramInbox /></div>
            <div className={`${styles.telegramScene} ${active === 1 ? styles.telegramSceneActive : ""}`} aria-hidden={active !== 1}><TelegramCompose /></div>
            <div className={`${styles.telegramScene} ${active === 2 ? styles.telegramSceneActive : ""}`} aria-hidden={active !== 2}><TelegramAccounts /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TelegramInbox() {
  const [selectedId, setSelectedId] = useState("maya");
  const selectedIndex = telegramChats.findIndex((chat) => chat.id === selectedId);
  const selected = telegramChats[selectedIndex] || telegramChats[0];

  useEffect(() => {
    const timer = window.setTimeout(() => setSelectedId(telegramChats[(selectedIndex + 1) % telegramChats.length].id), 4200);
    return () => window.clearTimeout(timer);
  }, [selectedIndex]);

  return (
    <div className={styles.telegramInbox}>
      <aside className={styles.conversationList}>
        <label><Search size={14} /><span>Search conversations</span></label>
        {telegramChats.map((chat) => <button type="button" className={selectedId === chat.id ? styles.conversationActive : ""} onClick={() => setSelectedId(chat.id)} key={chat.id}><ProfileAvatar src={chat.avatar} name={chat.name} /><span><strong>{chat.name}</strong><small>{chat.preview}</small></span><time>{chat.time}</time></button>)}
      </aside>
      <section className={styles.chatPanel}>
        <header><ProfileAvatar src={selected.avatar} name={selected.name} /><span><strong>{selected.name}</strong><small>online</small></span><MoreHorizontal size={18} /></header>
        <div className={styles.chatMessages} key={selected.id}><p>{selected.incoming}<small>10:24 AM</small></p><p>{selected.outgoing}<small>10:25 AM <Check size={11} /></small></p></div>
        <footer><Paperclip size={16} /><span>Write a message...</span><Smile size={16} /><Send size={17} /></footer>
      </section>
    </div>
  );
}

function TelegramCompose() {
  return (
    <div className={styles.composeView}>
      <section>
        <span className={styles.fieldLabel}>Send from</span>
        <div className={styles.accountChoice}><img src="/telegram-logo.svg" alt="" /><span><strong>Northstar Operations</strong><small>Connected account · +91 •••• 4821</small></span><CheckCircle2 size={18} /></div>
        <span className={styles.fieldLabel}>Recipient</span>
        <div className={styles.textField}><ProfileAvatar src="/avatars/maya-rao.svg" name="Maya Rao" /><span><strong>Maya Rao</strong><small>@maya_rao</small></span><Check size={15} /></div>
        <span className={styles.fieldLabel}>Message</span>
        <div className={styles.messageField}>Your launch update is confirmed for 4:00 PM. We’ll share the delivery result here.</div>
        <button type="button"><Send size={16} />Send message</button>
      </section>
      <aside><ProfileAvatar src="/avatars/maya-rao.svg" name="Maya Rao" size="large" /><span className={styles.readyLabel}>Ready to send</span><strong>Maya Rao</strong><p>The selected account, recipient, and final message are visible before delivery.</p><small><LockKeyhole size={14} />Encrypted account session</small></aside>
    </div>
  );
}

function TelegramAccounts() {
  return (
    <div className={styles.accountsView}>
      <header><div><span>Connected accounts</span><strong>Choose who sends each message</strong></div><button type="button">Add account</button></header>
      <article><ProfileAvatar src="/avatars/maya-rao.svg" name="Maya Rao" /><span><strong>Maya Rao · Operations</strong><small>+91 •••• 4821 · Used today</small></span><em>Ready</em></article>
      <article><ProfileAvatar src="/avatars/arjun-kumar.svg" name="Arjun Kumar" /><span><strong>Arjun Kumar · Support</strong><small>+91 •••• 9034 · Used yesterday</small></span><em>Ready</em></article>
      <footer><ShieldCheck size={18} /><span><strong>Protected sessions</strong><small>Verification codes are used once and never stored.</small></span></footer>
    </div>
  );
}

const publishingWorkflowViews = [
  { id: "compose", label: "Compose", note: "Build the post", icon: FileText },
  { id: "preview", label: "Preview", note: "See the final post", icon: Eye },
  { id: "schedule", label: "Schedule", note: "Choose the time", icon: CalendarDays },
];

function PublishingWorkspaceDemo({ service, profile }) {
  const [active, setActive] = useAutoIndex(publishingWorkflowViews.length, 9400);

  return (
    <div className={`${styles.productDemo} ${styles.instagramPublishingDemo} ${styles.publishingWorkspaceDemo}`} aria-label={`${service.platformName} publishing workspace preview`}>
      <div className={styles.demoTopbar}>
        <span className={styles.demoProduct}><img src={service.logo} alt="" /><strong>{service.platformName}</strong><i />Connected</span>
        <span className={styles.demoAccount}>{profile.account}</span>
      </div>
      <div className={styles.instagramDemoBody}>
        <nav className={styles.instagramWorkflowRail} aria-label={`${service.platformName} publishing stages`}>
          {publishingWorkflowViews.map((view, index) => {
            const Icon = view.icon;
            return (
              <button type="button" className={active === index ? styles.instagramWorkflowActive : ""} onClick={() => setActive(index)} aria-pressed={active === index} key={view.id}>
                <span><Icon size={16} /></span>
                <strong>{view.label}</strong>
                <small>{view.note}</small>
              </button>
            );
          })}
        </nav>
        <div className={styles.instagramViewport}>
          <div className={`${styles.instagramScene} ${active === 0 ? styles.instagramSceneActive : ""}`} aria-hidden={active !== 0}>{service.slug === "instagram" ? <InstagramComposeScene profile={profile} /> : <PlatformComposeScene service={service} profile={profile} />}</div>
          <div className={`${styles.instagramScene} ${active === 1 ? styles.instagramSceneActive : ""}`} aria-hidden={active !== 1}>{service.slug === "instagram" ? <InstagramPreviewScene profile={profile} /> : <PlatformPreviewScene service={service} profile={profile} />}</div>
          <div className={`${styles.instagramScene} ${active === 2 ? styles.instagramSceneActive : ""}`} aria-hidden={active !== 2}><PublishingScheduleScene service={service} profile={profile} /></div>
        </div>
      </div>
    </div>
  );
}

function CampaignImage({ className = "" }) {
  return <img className={className} src="/instagram-summer-campaign.webp" alt="Blush skincare campaign prepared for Instagram" />;
}

function publishingImageFor(service) {
  return {
    instagram: "/instagram-summer-campaign.webp",
    youtube: "/publishing-youtube-preview.webp",
    facebook: "/publishing-facebook-preview.webp",
    x: "/publishing-x-preview.webp",
    linkedin: "/publishing-linkedin-preview.webp",
  }[service.slug] || "/publish-queue-runner/operations-desk.png";
}

function platformFieldLabel(service) {
  if (service.slug === "youtube") return "Publishing channel";
  if (service.slug === "facebook") return "Publishing page";
  if (service.slug === "x") return "Posting as";
  return "Publishing as";
}

function PlatformArtwork({ service, profile, compact = false }) {
  return (
    <div className={`${styles.platformArtwork} ${styles[`platformArtwork_${service.slug}`] || ""} ${compact ? styles.platformArtworkCompact : ""}`}>
      <img src={publishingImageFor(service)} alt={`${profile.mediaLabel} prepared for ${service.platformName}`} />
      <span className={styles.platformArtworkShade} />
      <span className={styles.platformArtworkBrand}><img src={service.logo} alt="" />AgenticThat</span>
      <div className={styles.platformArtworkCopy}>
        {service.slug === "youtube" ? <span className={styles.platformPlay}><Play size={compact ? 16 : 21} fill="currentColor" /></span> : null}
        <strong>{profile.mediaLabel}</strong>
        <small>{service.slug === "x" ? "A focused launch update" : profile.headline}</small>
      </div>
      {service.slug === "youtube" ? <em>08:42</em> : null}
    </div>
  );
}

function InstagramComposeScene({ profile }) {
  return (
    <div className={styles.instagramComposeScene}>
      <section className={styles.instagramMediaPicker}>
        <div className={styles.instagramMainAsset}><CampaignImage /><span><ImageIcon size={13} />4:5 feed post</span></div>
        <div className={styles.instagramThumbnails}><button type="button" className={styles.instagramThumbnailActive}><CampaignImage /></button><button type="button"><CampaignImage /></button><button type="button"><span>+</span></button></div>
        <small><CheckCircle2 size={13} />Media ready</small>
      </section>
      <section className={styles.instagramComposerForm}>
        <label><span>Publishing to</span><strong><img src="/instagram-logo.svg" alt="" />{profile.account}<ChevronRight size={14} /></strong></label>
        <div className={styles.instagramCaption}><span>Caption</span><strong>{profile.headline}</strong><p>{profile.body}</p><small>{profile.body.length} / 2,200</small></div>
        <div className={styles.instagramAssist}><span><Sparkles size={13} />Assist</span><button type="button">Improve</button><button type="button">Shorten</button><button type="button">Hashtags</button></div>
        <footer><button type="button">Save draft</button><button type="button">Continue<ArrowRight size={14} /></button></footer>
      </section>
    </div>
  );
}

function PlatformComposeScene({ service, profile }) {
  const usedCharacters = profile.body.length + profile.headline.length + 1;
  const formatCopy = service.slug === "youtube" ? "Video · 16:9" : service.slug === "x" ? `${usedCharacters} / 280 characters` : "Image and text";
  const visibilityCopy = service.slug === "linkedin" ? "Anyone on LinkedIn" : service.slug === "facebook" ? "Public Page post" : service.slug === "youtube" ? "Public release" : "Public post";
  return (
    <div className={`${styles.instagramComposeScene} ${styles.platformComposeScene}`}>
      <section className={styles.instagramMediaPicker}>
        <PlatformArtwork service={service} profile={profile} />
        <div className={styles.instagramThumbnails}><button type="button" className={styles.instagramThumbnailActive}><img src={publishingImageFor(service)} alt="" /></button><button type="button"><img src={publishingImageFor(service)} alt="" /></button><button type="button"><span>+</span></button></div>
        <small><CheckCircle2 size={14} />{service.slug === "youtube" ? "Video checks passed" : "Media ready"}</small>
      </section>
      <section className={styles.instagramComposerForm}>
        <label><span>{platformFieldLabel(service)}</span><strong><img src={service.logo} alt="" />{profile.account}<ChevronRight size={15} /></strong></label>
        <div className={styles.instagramCaption}><span>{service.slug === "youtube" ? "Title and description" : service.slug === "x" ? "Post copy" : "Post message"}</span><strong>{profile.headline}</strong><p>{profile.body}</p><small>{profile.body.length} characters</small></div>
        <div className={styles.platformComposeOptions}><span><Eye size={14} />{visibilityCopy}</span><span><ImageIcon size={14} />{formatCopy}</span></div>
        <footer><button type="button">Save draft</button><button type="button">Continue<ArrowRight size={15} /></button></footer>
      </section>
    </div>
  );
}

function InstagramPreviewScene({ profile }) {
  return (
    <div className={styles.instagramPreviewScene}>
      <article className={styles.instagramPhonePreview}>
        <header><img src="/instagram-logo.svg" alt="" /><span><strong>agenticthat</strong><small>Sponsored preview</small></span><MoreHorizontal size={16} /></header>
        <CampaignImage />
        <div className={styles.instagramPostActions}><span><Heart size={16} /><MessageCircle size={16} /><Send size={16} /></span><Bookmark size={16} /></div>
        <p><strong>agenticthat</strong> {profile.headline}</p>
      </article>
      <aside className={styles.instagramPostDetails}>
        <span>POST DETAILS</span>
        <h3>Review the post your audience will see.</h3>
        <dl><div><dt>Publishing to</dt><dd><img src="/instagram-logo.svg" alt="" />{profile.account}</dd></div><div><dt>Post type</dt><dd>Feed post · 4:5</dd></div><div><dt>Caption</dt><dd>{profile.body}</dd></div></dl>
        <p><CheckCircle2 size={14} />Instagram checks passed</p>
        <footer><button type="button">Back</button><button type="button">Continue to schedule<ArrowRight size={13} /></button></footer>
      </aside>
    </div>
  );
}

function PlatformPostPreview({ service, profile }) {
  if (service.slug === "youtube") {
    return (
      <article className={`${styles.platformPostPreview} ${styles.youtubePostPreview}`}>
        <PlatformArtwork service={service} profile={profile} compact />
        <div className={styles.youtubePreviewMeta}>
          <span className={styles.publisherBrandAvatar}>AT</span>
          <span>
            <strong>{profile.headline}</strong>
            <small>AgenticThat · 2.1K views · Premieres 24 Sep</small>
          </span>
          <MoreHorizontal size={17} />
        </div>
      </article>
    );
  }

  if (service.slug === "facebook") {
    return (
      <article className={`${styles.platformPostPreview} ${styles.platformPostPreview_facebook}`}>
        <header>
          <span className={styles.publisherBrandAvatar}>AT</span>
          <span><strong>AgenticThat</strong><small>2 h · <Globe2 size={9} /></small></span>
          <MoreHorizontal size={17} />
        </header>
        <p><strong>{profile.headline}</strong><span>{profile.body}</span></p>
        <PlatformArtwork service={service} profile={profile} compact />
        <div className={styles.platformEngagementSummary}><span>👍 💚 284</span><span>42 comments · 18 shares</span></div>
        <footer>
          <span><ThumbsUp size={14} />Like</span>
          <span><MessageCircle size={14} />Comment</span>
          <span><Share2 size={14} />Share</span>
        </footer>
      </article>
    );
  }

  if (service.slug === "x") {
    return (
      <article className={`${styles.platformPostPreview} ${styles.platformPostPreview_x}`}>
        <header>
          <span className={styles.publisherBrandAvatar}>AT</span>
          <span><strong>AgenticThat ✓</strong><small>@AgenticThat · 2h</small></span>
          <MoreHorizontal size={17} />
        </header>
        <p><strong>{profile.headline}</strong><span>{profile.body}</span></p>
        <PlatformArtwork service={service} profile={profile} compact />
        <footer>
          <span><MessageCircle size={14} />48</span>
          <span><Repeat2 size={14} />126</span>
          <span><Heart size={14} />1.8K</span>
          <span><BarChart3 size={14} />24K</span>
          <span><Bookmark size={14} /></span>
        </footer>
      </article>
    );
  }

  return (
    <article className={`${styles.platformPostPreview} ${styles.platformPostPreview_linkedin}`}>
      <header>
        <span className={styles.publisherBrandAvatar}>AT</span>
        <span><strong>AgenticThat</strong><small>12,480 followers · 1h · <Globe2 size={9} /></small></span>
        <MoreHorizontal size={17} />
      </header>
      <p><strong>{profile.headline}</strong><span>{profile.body}</span></p>
      <PlatformArtwork service={service} profile={profile} compact />
      <div className={styles.platformEngagementSummary}><span>👍 💡 ❤️ 376</span><span>54 comments · 21 reposts</span></div>
      <footer>
        <span><ThumbsUp size={14} />Like</span>
        <span><MessageCircle size={14} />Comment</span>
        <span><Repeat2 size={14} />Repost</span>
        <span><Send size={14} />Send</span>
      </footer>
    </article>
  );
}

function PlatformPreviewScene({ service, profile }) {
  return (
    <div className={`${styles.instagramPreviewScene} ${styles.platformPreviewScene}`}>
      <PlatformPostPreview service={service} profile={profile} />
      <aside className={styles.instagramPostDetails}>
        <span>FINAL PREVIEW</span>
        <h3>Review exactly what your audience will see.</h3>
        <dl><div><dt>{platformFieldLabel(service)}</dt><dd><img src={service.logo} alt="" />{profile.account}</dd></div><div><dt>Content format</dt><dd>{profile.postType}</dd></div><div><dt>Post copy</dt><dd>{profile.body}</dd></div></dl>
        <p><CheckCircle2 size={15} />{service.platformName} checks passed</p>
        <footer><button type="button">Back</button><button type="button">Continue to schedule<ArrowRight size={14} /></button></footer>
      </aside>
    </div>
  );
}

function PublishingScheduleScene({ service, profile }) {
  const days = Array.from({ length: 30 }, (_, index) => index + 1);
  return (
    <div className={styles.instagramScheduleScene}>
      <section className={styles.instagramCalendar}>
        <header><button type="button">‹</button><strong>September 2026</strong><button type="button">›</button></header>
        <div className={styles.instagramWeek}><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
        <div className={styles.instagramDays}><i /><i />{days.map((day) => <button type="button" className={day === 24 ? styles.instagramSelectedDay : ""} key={day}>{day}</button>)}</div>
        <div className={styles.instagramTime}><span><Clock3 size={15} />{profile.scheduleTime || "4:00 PM"}</span><small>Asia/Kolkata</small></div>
      </section>
      <aside className={styles.instagramQueuePreview}>
        <span>QUEUE PREVIEW</span>
        <article><img src={publishingImageFor(service)} alt="" /><div><small>Thu, 24 Sep · {profile.scheduleTime || "4:00 PM"}</small><strong>{profile.headline}</strong><span>{profile.account}</span></div><CheckCircle2 size={17} /></article>
        <div className={styles.instagramBestTime}><Sparkles size={18} /><span><strong>A strong time to publish</strong><small>The release time is clear and the post will stay visible in your queue.</small></span></div>
        <footer><button type="button">Edit</button><button type="button">Add to queue<ArrowRight size={15} /></button></footer>
      </aside>
    </div>
  );
}

function PublishingDemo({ service }) {
  const profile = publishingProfiles[service.slug];
  return <PublishingWorkspaceDemo service={service} profile={profile} />;
}

function ScraperDemo() {
  const modes = [
    { label: "Profile", icon: AtSign, value: "instagram.com/northstar.studio" },
    { label: "Hashtag", icon: Hash, value: "#workspaceideas" },
    { label: "Post URL", icon: Link2, value: "instagram.com/p/example" },
  ];
  const [active, setActive] = useAutoIndex(modes.length, 8500);
  const mode = modes[active];
  return (
    <div className={`${styles.productDemo} ${styles.scraperDemo}`} aria-label="Instagram public data scraper preview">
      <div className={styles.demoTopbar}><span className={styles.demoProduct}><img src="/instagram-logo.svg" alt="" /><strong>Public Instagram data</strong></span><span className={styles.demoAccount}><Globe2 size={14} />No account login</span></div>
      <div className={styles.scrapeModes}>{modes.map((item, index) => { const Icon = item.icon; return <button type="button" key={item.label} className={active === index ? styles.scrapeModeActive : ""} onClick={() => setActive(index)}><Icon size={16} />{item.label}</button>; })}</div>
      <div className={styles.scrapeTransition} key={mode.label}>
        <section className={styles.scrapeInput}><label>Public {mode.label.toLowerCase()}</label><div><Search size={17} /><span>{mode.value}</span><button type="button">Collect data<ArrowRight size={14} /></button></div><p><CheckCircle2 size={15} />Ready to collect up to 100 recent public results</p></section>
        <section className={styles.scrapeResults}>
          <header><span><strong>Recent results</strong><small>24 public posts found</small></span><button type="button"><Download size={15} />Export CSV</button></header>
          <div className={styles.dataHeader}><span>Post</span><span>Published</span><span>Likes</span><span>Comments</span></div>
          <ScrapeRow tone="rose" title="A calmer way to plan the week" date="2h ago" likes="1,284" comments="46" />
          <ScrapeRow tone="blue" title="Inside our new studio workspace" date="Yesterday" likes="942" comments="31" />
          <ScrapeRow tone="gold" title="Three ideas worth saving" date="2 days" likes="817" comments="22" />
        </section>
      </div>
    </div>
  );
}

function ScrapeRow({ tone, title, date, likes, comments }) {
  return <div className={styles.dataRow}><span><i className={styles[`thumb_${tone}`]} /><strong>{title}</strong></span><span>{date}</span><span>{likes}</span><span>{comments}</span></div>;
}

function HeroDemo({ service }) {
  if (service.category === "messaging") return <TelegramDemo />;
  if (service.category === "publishing") return <PublishingDemo service={service} />;
  return <ScraperDemo />;
}

function Benefits({ content }) {
  return (
    <section className={styles.benefitsSection}>
      <header><h2>{content.sectionTitle}</h2><p>{content.sectionIntro}</p></header>
      <div className={styles.benefitGrid}>
        {content.benefits.map(([Icon, title, description]) => <article key={title}><span><Icon /></span><h3>{title}</h3><p>{description}</p></article>)}
      </div>
    </section>
  );
}

function AudienceAndSetup({ service, content }) {
  const platformProfile = service.category === "publishing" ? publishingProfiles[service.slug] : null;
  const audience = platformProfile?.audience.map(([title, description], index) => [[PiBriefcaseBold, PiUsersThreeBold, PiChartLineUpBold][index], title, description]) || content.audience;
  const stepIcons = service.category === "scraping" ? [PiLinkSimpleBold, PiFunnelBold, PiDownloadSimpleBold] : service.category === "publishing" ? [PiLockKeyBold, PiPencilSimpleBold, PiCalendarDotsBold] : [PiDeviceMobileBold, PiShieldCheckBold, PiPaperPlaneTiltBold];
  return (
    <section className={styles.guideSection}>
      <article className={styles.audiencePanel}>
        <header><span><PiUsersThreeBold /></span><div><h2>Who is this for?</h2><p>{service.category === "scraping" ? "Anyone who needs useful public Instagram research without manual copying." : `Any team that wants a simpler way to work with ${service.platformName}.`}</p></div></header>
        <div>{audience.map(([Icon, title, description]) => <section key={title}><span><Icon /></span><h3>{title}</h3><p>{description}</p></section>)}</div>
      </article>
      <article className={styles.setupPanel}>
        <header><span><PiRocketLaunchBold /></span><div><h2>How do you start?</h2><p>No coding or technical workflow knowledge is required.</p></div></header>
        <div>{service.steps.map((step, index) => { const Icon = stepIcons[index] || PiCheckCircleBold; return <section key={step.title}><span><Icon /></span><div><h3>{step.title}</h3><p>{step.description}</p></div></section>; })}</div>
      </article>
    </section>
  );
}

function TelegramProof() {
  return (
    <section className={styles.proofSection}>
      <div className={styles.proofCopy}><span>SECURE BY DESIGN</span><h2>Verify once. Return to the same approved account.</h2><p>AgenticThat guides the Telegram login, uses each verification code once, and protects the reusable account session after setup.</p></div>
      <div className={styles.connectionDiagram}><article><img src="/telegram-logo.svg" alt="" /><span><strong>Your Telegram account</strong><small>Phone number you control</small></span></article><i /><span><LockKeyhole size={18} />Encrypted session</span><i /><article><b>AT</b><span><strong>AgenticThat</strong><small>Ready for messaging</small></span></article></div>
    </section>
  );
}

function PublishingProof({ service }) {
  const profile = publishingProfiles[service.slug];
  return (
    <section className={`${styles.proofSection} ${styles.instagramProofSection}`}>
      <div className={styles.proofCopy}><h2>From draft to delivery, nothing gets lost.</h2><p>See the final creative, destination account, publish time, and delivery state together instead of checking separate tools.</p></div>
      <div className={styles.instagramDeliveryRecord}>
        <header><img src={publishingImageFor(service)} alt="" /><span><strong>{profile.headline}</strong><small>{profile.account} · {profile.postType}</small></span><em>On schedule</em></header>
        <ol>
          <li><span><PiPencilSimpleBold /></span><div><strong>Draft approved</strong><small>Copy and media are ready</small></div><CheckCircle2 size={17} /></li>
          <li><span><PiCalendarDotsBold /></span><div><strong>Scheduled for 24 September</strong><small>{profile.scheduleTime || "4:00 PM"} · Asia/Kolkata</small></div><CheckCircle2 size={17} /></li>
          <li><span><img src={service.logo} alt="" /></span><div><strong>{service.platformName} delivery</strong><small>Waiting safely in the publishing queue</small></div><Clock3 size={17} /></li>
        </ol>
      </div>
    </section>
  );
}

function ScraperProof() {
  return (
    <section className={styles.proofSection}>
      <div className={styles.proofCopy}><span>PUBLIC DATA, CLEARLY ORGANIZED</span><h2>Receive records you can understand and use immediately.</h2><p>Every result keeps the source link, public author, caption, timestamp, and available engagement signals together.</p></div>
      <div className={styles.outputFields}><span><PiLinkSimpleBold />Source URL</span><span><PiFileTextBold />Caption</span><span><PiUsersThreeBold />Public author</span><span><PiClockCountdownBold />Published time</span><span><PiChartLineUpBold />Engagement</span><span><PiDownloadSimpleBold />CSV or JSON</span></div>
    </section>
  );
}

function CategoryProof({ service }) {
  if (service.category === "messaging") return <TelegramProof />;
  if (service.category === "publishing") return <PublishingProof service={service} />;
  return <ScraperProof />;
}

function RelatedServices({ service, category, related }) {
  if (!related.length) return null;
  return (
    <section className={styles.relatedSection}>
      <header><div><span>MORE IN {category.label.toUpperCase()}</span><h2>Continue with another app</h2></div><Link href={`/apps#${category.id}`}>View all<ArrowRight size={16} /></Link></header>
      <div>{related.map((item) => <Link href={serviceDetailHref(item)} key={item.slug}><img src={item.logo} alt="" /><span><strong>{item.name}</strong><small>{item.shortDescription}</small></span><ChevronRight size={18} /></Link>)}</div>
    </section>
  );
}

export default function PremiumServiceDetail({ user, service, category, related = [] }) {
  const { statusFor } = useProductStatus();
  const status = statusFor(service);
  const action = actionFor(service, status);
  const baseContent = service.category === "messaging" ? categoryContent.telegram : categoryContent[service.category];
  const profile = service.category === "publishing" ? publishingProfiles[service.slug] : null;
  const isPublishing = service.category === "publishing";
  const heroTitle = profile ? profile.heroTitle : baseContent.heroTitle;
  const heroDescription = profile ? profile.heroDescription : baseContent.heroDescription;

  return (
    <ProductShell user={user} active="apps">
      <main className={`${styles.serviceMain} ${service.category === "messaging" ? styles.telegramPage : ""} ${isPublishing ? styles.publishingPage : ""}`} style={{ "--accent": service.accent, "--tint": service.tint }}>
        <div className={styles.topline}>
          <nav aria-label="Breadcrumb"><Link href="/apps">Store</Link><ChevronRight size={14} /><Link href={`/apps#${category.id}`}>{category.label}</Link><ChevronRight size={14} /><span>{service.platformName}</span></nav>
          <Link href="/apps"><ArrowLeft size={16} />Back to store</Link>
        </div>

        <section className={`${styles.heroSection} ${service.category === "messaging" ? styles.telegramHero : ""} ${isPublishing ? styles.publishingHero : ""}`}>
          <div className={styles.heroCopy}>
            <div className={styles.serviceIdentity}><span><img src={service.logo} alt="" /></span><div><strong>{service.name}</strong><small>{category.eyebrow}</small></div></div>
            <h1 className={isPublishing ? styles.publishingHeroTitle : ""}>{isPublishing ? <>{service.platformName} <span>Publishing</span></> : heroTitle}</h1>
            <p>{heroDescription}</p>
            <div className={styles.heroActions}>
              {action.disabled ? <button type="button" disabled>{action.label}</button> : <Link href={action.href}>{action.label}<ArrowRight size={17} /></Link>}
              <a href="#how-it-works">See how it works<ChevronRight size={17} /></a>
            </div>
            <div className={styles.heroAssurances}>
              {service.category === "scraping" ? <><span><Globe2 />Public data only</span><span><ShieldCheck />No Instagram login</span><span><Download />CSV and JSON</span></> : service.category === "publishing" ? <><span><Eye />Preview first</span><span><CalendarDays />Schedule clearly</span><span><BarChart3 />Track delivery</span></> : <><span><LockKeyhole />Encrypted sessions</span><span><Users />Multiple accounts</span><span><MessageCircle />Direct messaging</span></>}
            </div>
            <div className={styles.statusLine}><i className={styles[`status_${status.state}`]} />{status.label}{status.detail ? <small>{status.detail}</small> : null}</div>
          </div>
          <HeroDemo service={service} />
        </section>

        <div id="how-it-works"><Benefits content={baseContent} /></div>
        <AudienceAndSetup service={service} content={baseContent} />
        <CategoryProof service={service} />

        <section className={styles.trustStrip}>
          <span><PiFingerprintBold /></span>
          <div><h2>{service.category === "scraping" ? "Use public information responsibly." : "Your connection stays under your control."}</h2><p>{service.note}</p></div>
          <span className={styles.trustTag}>{service.category === "scraping" ? "Public sources" : "Secure setup"}</span>
        </section>

        <section className={styles.launchSection}>
          <div><span>READY WHEN YOU ARE</span><h2>{service.category === "scraping" ? "Start with one public Instagram target." : status.state === "connected" ? `Continue in your ${service.platformName} workspace.` : `Connect ${service.platformName} and start with a guided first step.`}</h2><p>{service.category === "scraping" ? "No account connection is required." : "You will always see what to do next."}</p></div>
          {action.disabled ? <button type="button" disabled>{action.label}</button> : <Link href={action.href}>{action.label}<ArrowRight size={18} /></Link>}
        </section>

        <RelatedServices service={service} category={category} related={related} />
      </main>
    </ProductShell>
  );
}
