"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  BarChart3,
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
  Image as ImageIcon,
  Link2,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Play,
  Search,
  Send,
  ShieldCheck,
  Smile,
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
    account: "@northstar.studio",
    heroTitle: "Plan Instagram posts without the last-minute rush.",
    heroDescription: "Keep the visual, caption, destination account, and publish time together from the first draft to delivery.",
    headline: "Make every launch feel considered.",
    body: "A first look at our summer collection. Designed for slower days and brighter plans.",
    mediaLabel: "Summer collection",
    mediaClass: styles.instagramMedia,
    audience: [
      ["Brands and businesses", "Keep campaign posts consistent across every connected account."],
      ["Content teams", "Draft, review, and schedule visual content without switching tools."],
      ["Social media managers", "See upcoming posts and delivery results in one clear queue."],
    ],
  },
  youtube: {
    account: "Northstar Studio",
    heroTitle: "Give every YouTube release a clear path to publish.",
    heroDescription: "Prepare the video, audience-facing details, destination channel, and release time in one reviewable workflow.",
    headline: "How we designed a calmer workspace",
    body: "Go behind the scenes of our latest workspace redesign—from first sketch to final launch.",
    mediaLabel: "Studio story · 08:42",
    mediaClass: styles.youtubeMedia,
    audience: [
      ["Creators and studios", "Prepare the video, title, description, and release time together."],
      ["Channel teams", "Coordinate releases without losing track of the destination channel."],
      ["Marketing teams", "Plan video and community updates alongside the wider campaign."],
    ],
  },
  facebook: {
    account: "Northstar Home",
    heroTitle: "Keep every Facebook page update polished and on schedule.",
    heroDescription: "Bring the final message, media, destination page, and campaign timing into one controlled publishing view.",
    headline: "A new space for better everyday work",
    body: "Our redesigned studio is now open. Visit this weekend and explore the full collection.",
    mediaLabel: "Studio opening",
    mediaClass: styles.facebookMedia,
    audience: [
      ["Local businesses", "Schedule page updates, announcements, and campaign posts."],
      ["Community teams", "Keep useful updates visible and publish them at the right time."],
      ["Marketing teams", "Manage page-specific copy and media from one publishing flow."],
    ],
  },
  x: {
    account: "@northstar",
    heroTitle: "Move from a sharp idea to a timely X post.",
    heroDescription: "Check the copy, media, sending identity, and schedule before a post enters the delivery queue.",
    headline: "Our new workspace is live.",
    body: "One place to prepare, review, and schedule the updates your audience needs—without losing the details.",
    mediaLabel: "Product update",
    mediaClass: styles.xMedia,
    audience: [
      ["Product teams", "Prepare launches and updates while keeping every post concise."],
      ["Editorial teams", "Schedule timely posts and confirm exactly what went live."],
      ["Multi-account teams", "Choose the correct identity before an update enters the queue."],
    ],
  },
  linkedin: {
    account: "Northstar Studio",
    heroTitle: "Publish LinkedIn updates with the right context intact.",
    heroDescription: "Review the message and media, confirm the correct account, and protect the approval context through delivery.",
    headline: "A better way to run content operations",
    body: "Today we are sharing the system behind our new publishing workspace—and what our team learned while building it.",
    mediaLabel: "Company update",
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

function PublishingDemo({ service }) {
  const profile = publishingProfiles[service.slug];
  const tabs = ["Compose", "Preview", "Schedule"];
  const [active, setActive] = useAutoIndex(tabs.length, 7800);
  return (
    <div className={`${styles.productDemo} ${styles.publishingDemo}`} aria-label={`${service.platformName} publishing preview`}>
      <div className={styles.demoTopbar}>
        <span className={styles.demoProduct}><img src={service.logo} alt="" /><strong>{service.platformName}</strong><i />Connected</span>
        <span className={styles.demoAccount}>{profile.account}</span>
      </div>
      <div className={styles.publishTabs}>{tabs.map((tab, index) => <button type="button" key={tab} className={active === index ? styles.publishTabActive : ""} onClick={() => setActive(index)}>{index === 0 ? <FileText size={15} /> : index === 1 ? <Eye size={15} /> : <CalendarDays size={15} />}{tab}</button>)}</div>
      <div className={styles.publishTransition} key={tabs[active]}>
        {active === 0 && <PublishComposer service={service} profile={profile} />}
        {active === 1 && <PublishPreview service={service} profile={profile} />}
        {active === 2 && <PublishSchedule service={service} profile={profile} />}
      </div>
    </div>
  );
}

function MediaArtwork({ profile, service, compact = false }) {
  return <div className={`${styles.mediaArtwork} ${profile.mediaClass} ${compact ? styles.mediaCompact : ""}`}><span><img src={service.logo} alt="" />{profile.mediaLabel}</span>{service.slug === "youtube" ? <Play size={compact ? 22 : 30} fill="currentColor" /> : <span className={styles.mediaMonogram}>AT</span>}</div>;
}

function PublishComposer({ service, profile }) {
  return (
    <div className={styles.publishComposer}>
      <MediaArtwork profile={profile} service={service} />
      <section>
        <label><span>Publishing to</span><strong><img src={service.logo} alt="" />{profile.account}<ChevronRight size={14} /></strong></label>
        <label><span>{service.slug === "youtube" ? "Video title" : "Post copy"}</span><strong>{profile.headline}</strong></label>
        <div className={styles.captionField}>{profile.body}<small>{profile.body.length} characters</small></div>
        <footer><button type="button"><ImageIcon size={15} />Media ready</button><button type="button">Save draft</button><button className={styles.accentButton} type="button">Continue<ArrowRight size={15} /></button></footer>
      </section>
    </div>
  );
}

function PublishPreview({ service, profile }) {
  return (
    <div className={styles.previewView}>
      <aside><span>Post preview</span><h3>See the complete post before your audience does.</h3><p>Confirm the destination, copy, media, and format in one final view.</p><div><CheckCircle2 size={16} />Platform checks passed</div></aside>
      <article className={styles.socialPreview}>
        <header><img src={service.logo} alt="" /><span><strong>{profile.account}</strong><small>Sponsored preview · Just now</small></span><MoreHorizontal size={17} /></header>
        <p><strong>{profile.headline}</strong> {profile.body}</p>
        <MediaArtwork profile={profile} service={service} compact />
        <footer><span>♡ Like</span><span>◯ Comment</span><span>↗ Share</span></footer>
      </article>
    </div>
  );
}

function PublishSchedule({ service, profile }) {
  return (
    <div className={styles.scheduleView}>
      <section><span className={styles.scheduleDay}>24<small>SEP</small></span><div><small>Scheduled publication</small><strong>Wednesday at 4:00 PM</strong><span>Local workspace time · Asia/Kolkata</span></div></section>
      <div className={styles.queueLine}><i /><span><small>Draft complete</small><strong>{profile.headline}</strong></span><CheckCircle2 size={18} /><i /><span><small>Destination</small><strong>{profile.account}</strong></span><CheckCircle2 size={18} /><i /><span><small>Next</small><strong>Publish to {service.platformName}</strong></span><Clock3 size={18} /></div>
      <footer><span><ShieldCheck size={16} />Final checks run before delivery</span><button type="button">Edit schedule</button><button className={styles.accentButton} type="button">Schedule post</button></footer>
    </div>
  );
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
    <section className={styles.proofSection}>
      <div className={styles.proofCopy}><span>VISIBLE FROM START TO FINISH</span><h2>Know exactly where every {service.platformName} post stands.</h2><p>Drafting, review, scheduling, delivery, and any problem stay visible in one understandable publishing history.</p></div>
      <div className={styles.deliveryPath}>
        <article><span><PiPencilSimpleBold /></span><div><small>Draft</small><strong>{profile.headline}</strong></div><CheckCircle2 size={18} /></article>
        <i />
        <article><span><PiCalendarDotsBold /></span><div><small>Scheduled</small><strong>Wednesday · 4:00 PM</strong></div><CheckCircle2 size={18} /></article>
        <i />
        <article><span><img src={service.logo} alt="" /></span><div><small>Destination</small><strong>{profile.account}</strong></div><Clock3 size={18} /></article>
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
  const heroTitle = profile ? profile.heroTitle : baseContent.heroTitle;
  const heroDescription = profile ? profile.heroDescription : baseContent.heroDescription;

  return (
    <ProductShell user={user} active="apps">
      <main className={`${styles.serviceMain} ${service.category === "messaging" ? styles.telegramPage : ""}`} style={{ "--accent": service.accent, "--tint": service.tint }}>
        <div className={styles.topline}>
          <nav aria-label="Breadcrumb"><Link href="/apps">Store</Link><ChevronRight size={14} /><Link href={`/apps#${category.id}`}>{category.label}</Link><ChevronRight size={14} /><span>{service.platformName}</span></nav>
          <Link href="/apps"><ArrowLeft size={16} />Back to store</Link>
        </div>

        <section className={`${styles.heroSection} ${service.category === "messaging" ? styles.telegramHero : ""}`}>
          <div className={styles.heroCopy}>
            <div className={styles.serviceIdentity}><span><img src={service.logo} alt="" /></span><div><strong>{service.name}</strong><small>{category.eyebrow}</small></div></div>
            <h1>{heroTitle}</h1>
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
          <span><PiShieldCheckBold /></span>
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
