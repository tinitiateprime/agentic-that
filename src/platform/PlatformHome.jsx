"use client";

import React, { useEffect, useRef, useState } from "react";
import { animate, stagger } from "animejs";
import {
  Activity,
  CalendarClock,
  Bookmark,
  CheckCheck,
  CircleDashed,
  Cloud,
  Compass,
  Copy,
  Database,
  Download,
  Eye,
  FileText,
  Heart,
  Image,
  Link2,
  LockKeyhole,
  Menu,
  MessageCircle,
  MessageSquareReply,
  Mic,
  Monitor,
  MoreVertical,
  MousePointerClick,
  Paperclip,
  Phone,
  Play,
  Plus,
  Repeat2,
  Search,
  Send,
  ShieldCheck,
  Smile,
  User,
  Users,
  Video,
} from "lucide-react";
import { serviceEndpoints } from "./service-catalog";
import AuthModal from "./AuthModal";

const FacebookLogo = "/facebook-logo.svg";
const GoogleLogo = "/google-logo.svg";
const GoogleMapsLogo = "/google-maps-logo.svg";
const InstagramLogo = "/instagram-logo.svg";
const LinkedInLogo = "/linkedin-logo.png";
const ScrapeGlobeDevicePoster = "/scrape-globe-device-poster.png";
const ScrapeGlobeDeviceVideo = "/scrape-globe-device.mp4";
const TelegramLogo = "/telegram-logo.svg";
const WhatsAppLogo = "/whatsapp-logo.svg";
const XLogo = "/x-logo.svg";
const YouTubeLogo = "/youtube-logo.svg";

const WHATSAPP_DEMO_MESSAGE = "Hi Maya — your appointment is confirmed tomorrow at 10:00 AM.";
const TELEGRAM_DEMO_MESSAGE = "Tomorrow's product update is ready for review.";

const scrapingShowcaseSources = [
  { name: "Instagram", logo: InstagramLogo, status: "Ready", enabled: true },
  { name: "Facebook", logo: FacebookLogo, status: "Ready", enabled: true },
  { name: "X", logo: XLogo, status: "Ready", enabled: true },
  { name: "LinkedIn", logo: LinkedInLogo, status: "Ready", enabled: true },
  { name: "Google Maps", logo: GoogleMapsLogo, status: "Ready", enabled: true },
];

const scrapingShowcaseFeatures = [
  "Public profiles, Pages, posts, and reels",
  "Captions, comments, and public account details",
  "Views, likes, comments, and follower signals",
  "Clean JSON and CSV export files",
];

const scrapingShowcaseJson = [
  { structural: "{" },
  { key: "username", value: "wildframe" },
  { key: "post_url", value: "/reel/AlpineDawn/" },
  { key: "caption", value: "Morning light above the alpine lake." },
  { key: "likes", value: 18426 },
  { key: "comments_count", value: 318 },
  { key: "views", value: 96420 },
  { structural: "}" },
];

const scrapingShowcaseCsv = [
  ["username", "post_url", "likes", "comments_count", "views"],
  ["wildframe", "/reel/AlpineDawn/", "18,426", "318", "96,420"],
  ["trailnotes.daily", "/p/ForestLight/", "12,704", "186", "71,230"],
  ["northbound", "/reel/LakeMist/", "9,851", "144", "58,310"],
  ["earthtones.co", "/p/PineValley/", "7,432", "91", "42,018"],
];

const publishingShowcasePlatforms = [
  { name: "Instagram", logo: InstagramLogo, position: "instagram" },
  { name: "Facebook", logo: FacebookLogo, position: "facebook" },
  { name: "X (Twitter)", shortName: "X", logo: XLogo, position: "x" },
  { name: "LinkedIn", logo: LinkedInLogo, position: "linkedin" },
  { name: "YouTube", logo: YouTubeLogo, position: "youtube" },
];

const PUBLISHING_SHOWCASE_CAPTION = "Morning light over the alpine lake. A quiet trail, clear water, and one unforgettable sunrise.";

const ENGAGEMENT_SHOWCASE_COMMENT = "This hidden cove is incredible — saving it for later.";

const engagementShowcaseTargets = [
  { name: "Instagram", logo: InstagramLogo, url: "instagram.com/p/emerald-cove/" },
  { name: "YouTube", logo: YouTubeLogo, url: "youtube.com/watch?v=alpine" },
  { name: "X", logo: XLogo, url: "x.com/wildframe/status/1842" },
  { name: "Facebook", logo: FacebookLogo, url: "facebook.com/reel/48291" },
  { name: "LinkedIn", logo: LinkedInLogo, url: "linkedin.com/posts/wildframe" },
];

const engagementShowcaseFeatures = [
  { label: "Upload platform-specific post URLs", Icon: Link2 },
  { label: "Route every URL to the correct app", Icon: Compass },
  { label: "Run likes, comments, reposts, and follows", Icon: MessageCircle },
  { label: "Verify each action inside the live session", Icon: ShieldCheck },
];

const publishingCalendarDays = [
  ["26", true], ["27", true], ["28", true], ["29", true], ["30", true], ["31", true], ["1", false],
  ["2", false], ["3", false], ["4", false], ["5", false], ["6", false], ["7", false], ["8", false],
  ["9", false], ["10", false], ["11", false], ["12", false], ["13", false], ["14", false], ["15", false],
  ["16", false], ["17", false], ["18", false], ["19", false], ["20", false], ["21", false], ["22", false],
  ["23", false], ["24", false], ["25", false], ["26", false], ["27", false], ["28", false], ["29", false],
  ["30", false], ["31", false], ["1", true], ["2", true], ["3", true], ["4", true], ["5", true],
];

const navItems = [
  { label: "Store", href: "/apps" },
  { label: "Messaging", href: "#messaging" },
  { label: "Publishing", href: "#publishing" },
  { label: "Scraping", href: "#scraping" },
];

const services = [
  {
    name: "Content Manager",
    description: "View connected accounts by service and app, with content counts for publishing destinations.",
    meta: "Account inventory",
    action: "Open manager",
    destination: "/content-manager",
  },
  {
    name: "Auto Scrape Intelligence",
    description: "Scrape public Instagram and Facebook profiles, Pages, reels, posts, comments, views and engagement signals into clean JSON/CSV files.",
    meta: "Data pipeline",
    featured: true,
    destination: "/apps",
  },
  {
    name: "Publish Queue Runner",
    description: "Create and schedule content across Instagram, X, LinkedIn, Facebook, and YouTube.",
    meta: "Content operations",
    destination: "/publishing",
  },
  {
    name: "Post Engagement Agent",
    description: "Run monitored browser sessions with queued actions and verification handling.",
    meta: "Execution agent",
  },
];

const automationPlatforms = [
  { name: "Telegram", logo: TelegramLogo, action: "Console", enabled: true },
  { name: "WhatsApp", logo: WhatsAppLogo, action: "Console", enabled: true },
];

const scraperPlatforms = [
  { name: "Instagram", logo: InstagramLogo, action: "Console", enabled: true },
  { name: "Facebook", logo: FacebookLogo, action: "Console", enabled: true },
  { name: "X", logo: XLogo },
  { name: "Google", logo: GoogleLogo },
  { name: "Google Maps", logo: GoogleMapsLogo },
  { name: "LinkedIn", logo: LinkedInLogo },
];

const publishingPlatforms = [
  { name: "Instagram", logo: InstagramLogo, action: "Open runner", enabled: true },
  { name: "Facebook", logo: FacebookLogo, action: "Open runner", enabled: true },
  { name: "X", logo: XLogo, action: "Open runner", enabled: true },
  { name: "YouTube", logo: YouTubeLogo, action: "Open runner", enabled: true },
  { name: "LinkedIn", logo: LinkedInLogo, action: "Open runner", enabled: true },
];

const socialEngagementPlatforms = [
  { name: "Instagram", logo: InstagramLogo },
  { name: "Facebook", logo: FacebookLogo },
  { name: "X", logo: XLogo },
  { name: "YouTube", logo: YouTubeLogo },
  { name: "LinkedIn", logo: LinkedInLogo },
];

const automationSlides = [
  {
    id: "messaging",
    tab: "Messaging",
    variant: "spotlight",
    kicker: "Messaging Automation",
    title: "Chat Workflow Automation",
    description:
      "Automate account workflows, contacts, campaigns, templates, inbox replies, and outbound messages across Telegram and WhatsApp.",
    platforms: automationPlatforms,
    stats: [
      { value: "2", label: "Channels live" },
      { value: "24/7", label: "Agent uptime" },
      { value: "∞", label: "Templates" },
    ],
  },
  {
    id: "scraping",
    tab: "Scraping",
    variant: "mosaic",
    kicker: "Scraping Service",
    title: "Social and Search Scrapers",
    description:
      "Run Instagram and Facebook scraping now, with placeholders ready for search results, maps listings, and professional profiles.",
    platforms: scraperPlatforms,
  },
  {
    id: "publishing",
    tab: "Publishing",
    variant: "rail",
    kicker: "Publishing Service",
    title: "Publish Queue Runner",
    description:
      "Create, queue, schedule, and track browser-based publishing workflows across all connected social channels.",
    platforms: publishingPlatforms,
  },
  {
    id: "engagement",
    tab: "Engagement",
    variant: "orbit",
    kicker: "Engagement Service",
    title: "Post Engagement Agent",
    description:
      "Prepare monitored engagement workflows for posts, replies, interactions, and verification-driven actions across social channels.",
    platforms: socialEngagementPlatforms,
  },
];

const keepVideoSilent = (event) => {
  event.currentTarget.muted = true;
  event.currentTarget.volume = 0;
};

const systemInputs = [
  { label: "Public URL", detail: "example.com/post/123", tone: "blue", Icon: Link2 },
  { label: "Incoming message", detail: "Message received", tone: "green", Icon: MessageCircle },
  { label: "Content brief", detail: "Launch campaign brief", tone: "violet", Icon: FileText },
];

const systemOutputs = [
  { label: "Structured dataset", detail: "Clean and ready", tone: "blue", Icon: Database },
  { label: "Scheduled queue", detail: "Queued to publish", tone: "gold", Icon: CalendarClock },
  { label: "Ready reply", detail: "Context-aware", tone: "green", Icon: MessageSquareReply },
  { label: "Monitored action", detail: "Like · comment · repost", tone: "coral", Icon: ShieldCheck },
];

function SystemEndpoint({ item, side }) {
  const { Icon } = item;
  return (
    <div className={`system-endpoint system-endpoint-${side} signal-${item.tone}`}>
      <span className="system-endpoint-icon"><Icon /></span>
      <span className="system-endpoint-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
      <i className="system-endpoint-port" />
    </div>
  );
}

function CinematicSystemVisual() {
  return (
    <div className="cinematic-system" id="system-visual" aria-hidden="true">
      <div className="cinematic-backdrop" />
      <div className="cinematic-vignette" />

      <svg className="cinematic-flow-overlay" viewBox="0 0 1600 900" preserveAspectRatio="none">
        <defs>
          <filter id="cinematic-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="flow-blue" x1="0" x2="1"><stop stopColor="#248cff" stopOpacity="0" /><stop offset=".5" stopColor="#3da7ff" /><stop offset="1" stopColor="#91d4ff" stopOpacity="0" /></linearGradient>
          <linearGradient id="flow-green" x1="0" x2="1"><stop stopColor="#22e4a0" stopOpacity="0" /><stop offset=".52" stopColor="#40efb4" /><stop offset="1" stopColor="#a7ffd9" stopOpacity="0" /></linearGradient>
          <linearGradient id="flow-violet" x1="0" x2="1"><stop stopColor="#8b5cf6" stopOpacity="0" /><stop offset=".54" stopColor="#b89aff" /><stop offset="1" stopColor="#e7dcff" stopOpacity="0" /></linearGradient>
          <linearGradient id="flow-coral" x1="0" x2="1"><stop stopColor="#ff5d48" stopOpacity="0" /><stop offset=".55" stopColor="#ff826e" /><stop offset="1" stopColor="#ffd1c8" stopOpacity="0" /></linearGradient>
          <linearGradient id="flow-gold" x1="1" x2="0"><stop stopColor="#f59e0b" stopOpacity="0" /><stop offset=".46" stopColor="#facc15" /><stop offset="1" stopColor="#fff4bd" stopOpacity="0" /></linearGradient>
        </defs>

        <g className="signal-connections signal-connections-input">
          <path className="signal-track track-blue" d="M210 598 C430 598 610 555 824 494" />
          <path className="signal-pulse pulse-blue" pathLength="100" d="M210 598 C430 598 610 555 824 494" />
          <path className="signal-thread thread-blue" pathLength="100" d="M210 604 C435 604 620 562 827 501" />

          <path className="signal-track track-green" d="M210 681 C450 681 636 600 834 518" />
          <path className="signal-pulse pulse-green" pathLength="100" d="M210 681 C450 681 636 600 834 518" />
          <path className="signal-thread thread-green" pathLength="100" d="M210 688 C455 688 642 609 838 526" />

          <path className="signal-track track-violet" d="M210 764 C462 764 650 648 842 540" />
          <path className="signal-pulse pulse-violet" pathLength="100" d="M210 764 C462 764 650 648 842 540" />
          <path className="signal-thread thread-violet" pathLength="100" d="M210 771 C468 771 657 657 847 548" />
        </g>

        <g className="signal-connections signal-connections-output">
          <path className="signal-track track-blue" d="M1090 472 C1214 438 1290 371 1394 371" />
          <path className="signal-pulse pulse-blue" pathLength="100" d="M1090 472 C1214 438 1290 371 1394 371" />
          <path className="signal-thread thread-blue" pathLength="100" d="M1088 479 C1218 446 1294 378 1394 378" />

          <path className="signal-track track-gold" d="M1100 500 C1230 488 1300 468 1394 468" />
          <path className="signal-pulse pulse-gold" pathLength="100" d="M1100 500 C1230 488 1300 468 1394 468" />
          <path className="signal-thread thread-gold" pathLength="100" d="M1099 507 C1232 496 1303 475 1394 475" />

          <path className="signal-track track-green" d="M1097 527 C1232 544 1300 565 1394 565" />
          <path className="signal-pulse pulse-green" pathLength="100" d="M1097 527 C1232 544 1300 565 1394 565" />
          <path className="signal-thread thread-green" pathLength="100" d="M1095 534 C1235 552 1305 572 1394 572" />

          <path className="signal-track track-coral" d="M1085 552 C1218 600 1295 662 1394 662" />
          <path className="signal-pulse pulse-coral" pathLength="100" d="M1085 552 C1218 600 1295 662 1394 662" />
          <path className="signal-thread thread-coral" pathLength="100" d="M1081 559 C1215 609 1298 669 1394 669" />
        </g>

        <g className="core-ports">
          <circle cx="824" cy="494" r="5" className="port-blue" />
          <circle cx="834" cy="518" r="5" className="port-green" />
          <circle cx="842" cy="540" r="5" className="port-violet" />
          <circle cx="1090" cy="472" r="5" className="port-blue" />
          <circle cx="1100" cy="500" r="5" className="port-gold" />
          <circle cx="1097" cy="527" r="5" className="port-green" />
          <circle cx="1085" cy="552" r="5" className="port-coral" />
        </g>

        <path className="cinematic-return-path" d="M1120 445 C1110 330 1020 247 900 229 S815 220 786 211" />
        <circle className="cinematic-return-dot" r="4" filter="url(#cinematic-glow)">
          <animateMotion dur="9.6s" repeatCount="indefinite" path="M1120 445 C1110 330 1020 247 900 229 S815 220 786 211" />
        </circle>
      </svg>

      <div className="cinematic-core-light" />
      <div className="system-stage system-stage-analyze"><Activity /><span>Analyze</span></div>
      <div className="system-stage system-stage-review"><Search /><span>Review</span></div>
      <div className="system-stage system-stage-execute"><Play /><span>Execute</span></div>
      <div className="system-inputs">
        {systemInputs.map((item) => <SystemEndpoint key={item.label} item={item} side="input" />)}
      </div>
      <div className="system-outputs">
        {systemOutputs.map((item) => <SystemEndpoint key={item.label} item={item} side="output" />)}
      </div>
      <div className="cinematic-particle-field">
        {Array.from({ length: 28 }, (_, index) => <i key={index} style={{ "--particle": index }} />)}
      </div>
    </div>
  );
}

const messagingFeatures = [
  "Send and receive messages from connected accounts",
  "Manage contacts, groups, and conversation history",
  "Use approved WhatsApp templates and group broadcasts",
  "Schedule Telegram posts and enable optional bot replies",
];

const whatsappChats = [
  { initials: "MR", tone: "teal", name: "Maya Rao", preview: "Can we connect our support inbox?", time: "10:30", unread: 2 },
  { initials: "AK", tone: "amber", name: "Arjun Kumar", preview: "The template is approved.", time: "9:48" },
  { initials: "PS", tone: "violet", name: "Priya Shah", preview: "Thanks, that works perfectly.", time: "Mon" },
];

const telegramChats = [
  { initials: "MR", tone: "teal", name: "Maya Rao", preview: "Can we schedule this update?", time: "10:30", unread: 2 },
  { initials: "P", tone: "blue", name: "Product Updates", preview: "New campaign brief", time: "9:47", unread: 1 },
  { initials: "AK", tone: "amber", name: "Arjun Kumar", preview: "I shared the final copy.", time: "9:15" },
];

function InitialAvatar({ initials, tone = "teal", className = "" }) {
  return <span className={`messenger-initial-avatar avatar-${tone} ${className}`.trim()}>{initials}</span>;
}

function AnimatedComposerInput({ text, placeholder, isTyping, label }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = "auto";
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 56)}px`;
    inputRef.current.scrollTop = 0;
  }, [text, isTyping]);

  return (
    <>
      <textarea
        ref={inputRef}
        className="messenger-typed-copy"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        readOnly
        tabIndex={-1}
        rows={1}
      />
      {isTyping && <i className="messenger-type-caret" aria-hidden="true" />}
    </>
  );
}

function WhatsAppSendIcon() {
  return (
    <svg className="wa-send-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.25 3.35 22.1 12 2.25 20.65l.02-6.72L16.45 12 2.27 10.07l-.02-6.72Z" />
    </svg>
  );
}

function MessengerActivation({ platform, logo, isVisible, isArrived, isRevealed }) {
  return (
    <div className={`messenger-activation${isVisible ? " is-visible" : ""}${isArrived ? " is-arrived" : ""}${isRevealed ? " is-revealed" : ""}`} aria-hidden="true">
      <div className="messenger-activation-chip">
        <img src={logo} alt="" />
        <span><strong>{platform}</strong><small><i />Opening workspace</small></span>
      </div>
    </div>
  );
}

function WhatsAppWorkspaceLauncher({ isPressed, isOpen, onOpen }) {
  return (
    <button
      className={`wa-workspace-launcher${isPressed ? " is-pressed" : ""}${isOpen ? " is-open" : ""}`}
      type="button"
      aria-label="Open WhatsApp workspace"
      onClick={onOpen}
    >
      <img src={WhatsAppLogo} alt="" />
      <strong>WhatsApp</strong>
    </button>
  );
}

function TelegramWorkspaceLauncher({ isPressed, isOpen, onOpen }) {
  return (
    <button
      className={`tg-workspace-launcher${isPressed ? " is-pressed" : ""}${isOpen ? " is-open" : ""}`}
      type="button"
      aria-label="Open Telegram workspace"
      onClick={onOpen}
    >
      <img src={TelegramLogo} alt="" />
      <strong>Telegram</strong>
    </button>
  );
}

function EmptyConversation({ logo, platform }) {
  return (
    <div className="messenger-empty-conversation" aria-hidden="true">
      <img src={logo} alt="" />
      <strong>Select a conversation</strong>
      <span>Choose a customer to continue</span>
    </div>
  );
}

function WhatsAppPreview({ typedText, isTyping, isSending, isSent, isSelected, isSelecting, isLaunchPressed, isWorkspaceOpen }) {
  return (
    <article className={`wa-desktop${isWorkspaceOpen ? " is-workspace-open" : " is-workspace-closed"}`} aria-label="WhatsApp Web dark interface preview">
      <nav className="wa-rail" aria-label="WhatsApp navigation">
        <button className="is-active" type="button" aria-label="Chats"><MessageCircle /></button>
        <button type="button" aria-label="Calls"><Phone /></button>
        <button type="button" aria-label="Status"><CircleDashed /></button>
        <button type="button" aria-label="Communities"><Users /></button>
        <span />
        <button type="button" aria-label="Media"><Image /></button>
        <InitialAvatar initials="AT" tone="gold" className="wa-rail-avatar" />
      </nav>

      <aside className="wa-sidebar">
        <header className="wa-sidebar-header">
          <div className={`wa-sidebar-brand${isLaunchPressed ? " is-pressed" : ""}`}><img src={WhatsAppLogo} alt="" /><strong>WhatsApp</strong></div>
          <div><button type="button" aria-label="New chat"><MessageSquareReply /></button><button type="button" aria-label="Menu"><MoreVertical /></button></div>
        </header>
        <label className="wa-search"><Search /><span>Search or start a new chat</span></label>
        <div className="wa-filters"><button className="is-active" type="button">All</button><button type="button">Unread</button><button type="button">Groups</button><button type="button" aria-label="More filters"><Plus /></button></div>
        <div className="wa-chat-list">
          {whatsappChats.map((chat, index) => (
            <div className={`wa-chat-row${index === 0 && isSelected ? " is-active" : ""}${index === 0 && isSelecting ? " is-selecting" : ""}`} key={chat.name}>
              <InitialAvatar initials={chat.initials} tone={chat.tone} />
              <div className="wa-chat-copy"><strong>{chat.name}</strong><span>{index === 1 && <CheckCheck />}{chat.preview}</span></div>
              <div className="wa-chat-meta"><time>{chat.time}</time>{chat.unread && <i>{chat.unread}</i>}</div>
            </div>
          ))}
        </div>
      </aside>

      <main className={`wa-conversation${isTyping || isSending ? " is-composing" : ""}${isSelected ? " is-chat-open" : " is-chat-closed"}`}>
        {!isSelected && <EmptyConversation logo={WhatsAppLogo} platform="WhatsApp" />}
        <header className="wa-conversation-header">
          <InitialAvatar initials="MR" tone="teal" />
          <div><strong>Maya Rao</strong></div>
          <nav><button type="button" aria-label="Video call"><Video /></button><button type="button" aria-label="Voice call"><Phone /></button><button type="button" aria-label="Search conversation"><Search /></button><button type="button" aria-label="Menu"><MoreVertical /></button></nav>
        </header>
        <section className="wa-thread">
          <span className="wa-day">Today</span>
          <p className="wa-security">Messages are secured for this connected account.</p>
          <div className="wa-message wa-incoming"><p>Can you send my appointment confirmation?</p><span><time>10:30 AM</time></span></div>
          {isSent && <div className="wa-message wa-outgoing messenger-demo-message"><p>{WHATSAPP_DEMO_MESSAGE}</p><span><time>10:31 AM</time><CheckCheck /></span></div>}
        </section>
        <footer className={`wa-composer${isTyping ? " is-active" : ""}${isSending ? " is-sending" : ""}`}>
          <button type="button" aria-label="Emoji"><Smile /></button>
          <button type="button" aria-label="Attach"><Paperclip /></button>
          <div><AnimatedComposerInput text={typedText} placeholder="Type a message" isTyping={isTyping} label="WhatsApp message being typed" /><Mic aria-label="Voice message" /></div>
          <button className={`wa-send${isSending ? " is-pressed" : ""}`} type="button" aria-label="Send"><WhatsAppSendIcon /></button>
        </footer>
      </main>
    </article>
  );
}

function TelegramPreview({ typedText, isTyping, isSending, isSent, isSelected, isSelecting, isLaunchPressed, isWorkspaceOpen }) {
  return (
    <article className={`tg-desktop${isWorkspaceOpen ? " is-workspace-open" : " is-workspace-closed"}`} aria-label="Telegram Desktop dark interface preview">
      <aside className="tg-sidebar">
        <header className="tg-sidebar-header">
          <div className={`tg-sidebar-brand${isLaunchPressed ? " is-pressed" : ""}`}><img src={TelegramLogo} alt="" /><strong>Telegram</strong></div>
          <button type="button" aria-label="Menu"><Menu /></button>
        </header>
        <label className="tg-search"><Search /><span>Search</span></label>
        <nav className="tg-folders"><button className="is-active" type="button">All <i>4</i></button><button type="button">Unread</button><button type="button">Groups</button></nav>
        <div className="tg-chat-list">
          {telegramChats.map((chat, index) => (
            <div className={`tg-chat-row${index === 0 && isSelected ? " is-active" : ""}${index === 0 && isSelecting ? " is-selecting" : ""}`} key={chat.name}>
              <InitialAvatar initials={chat.initials} tone={chat.tone} />
              <div className="tg-chat-copy"><strong>{chat.name}</strong><span>{chat.preview}</span></div>
              <div className="tg-chat-meta"><time>{chat.time}</time>{chat.unread && <i>{chat.unread}</i>}</div>
            </div>
          ))}
        </div>
        <button className="tg-compose" type="button" aria-label="New message"><MessageSquareReply /></button>
      </aside>

      <main className={`tg-conversation${isTyping || isSending ? " is-composing" : ""}${isSelected ? " is-chat-open" : " is-chat-closed"}`}>
        {!isSelected && <EmptyConversation logo={TelegramLogo} platform="Telegram" />}
        <header className="tg-conversation-header">
          <InitialAvatar initials="MR" tone="teal" />
          <div><strong>Maya Rao</strong><span>last seen recently</span></div>
          <nav><button type="button" aria-label="Search conversation"><Search /></button><button type="button" aria-label="Voice call"><Phone /></button><button type="button" aria-label="Menu"><MoreVertical /></button></nav>
        </header>
        <section className="tg-thread">
          <span className="tg-day">Today</span>
          <div className="tg-message tg-incoming"><p>Is tomorrow's product update ready?</p><span><time>10:32</time></span></div>
          {isSent && <div className="tg-message tg-outgoing messenger-demo-message"><p>{TELEGRAM_DEMO_MESSAGE}</p><span><time>10:33</time><CheckCheck /></span></div>}
        </section>
        <footer className={`tg-composer${isTyping ? " is-active" : ""}${isSending ? " is-sending" : ""}`}>
          <button type="button" aria-label="Attach"><Paperclip /></button>
          <div><AnimatedComposerInput text={typedText} placeholder="Write a message..." isTyping={isTyping} label="Telegram message being typed" /><button type="button" aria-label="Emoji"><Smile /></button></div>
          <button className={`tg-send${isSending ? " is-pressed" : ""}`} type="button" aria-label="Send"><Send /></button>
        </footer>
      </main>
    </article>
  );
}

function MessagingAutomationShowcase() {
  const sectionRef = useRef(null);
  const demoHasRun = useRef(false);
  const [demo, setDemo] = useState({
    activeChannel: "idle",
    activationVisible: false,
    activationArrived: false,
    interfacesRevealed: false,
    whatsappLaunchPressed: false,
    whatsappSelecting: false,
    whatsappSelected: false,
    whatsappText: "",
    whatsappTyping: false,
    whatsappSending: false,
    whatsappSent: false,
    telegramLaunchPressed: false,
    telegramSelecting: false,
    telegramSelected: false,
    telegramText: "",
    telegramTyping: false,
    telegramSending: false,
    telegramSent: false,
  });

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;

    const timers = new Set();
    let observer;
    let disposed = false;

    const schedule = (callback, delay) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (!disposed) callback();
      }, delay);
      timers.add(timer);
    };

    const typeMessage = (channel, message, onComplete) => {
      let character = 0;
      const textKey = `${channel}Text`;
      const typingKey = `${channel}Typing`;

      setDemo((current) => ({ ...current, [typingKey]: true }));

      const typeNextCharacter = () => {
        character += 1;
        setDemo((current) => ({ ...current, [textKey]: message.slice(0, character) }));

        if (character < message.length) {
          const typedCharacter = message.charAt(character - 1);
          const isWhatsApp = channel === "whatsapp";
          const pause = /[,.!?—]/.test(typedCharacter)
            ? (isWhatsApp ? 112 : 150)
            : typedCharacter === " "
              ? (isWhatsApp ? 40 : 52)
              : (isWhatsApp ? 48 : 62);
          schedule(typeNextCharacter, pause);
        } else {
          setDemo((current) => ({ ...current, [typingKey]: false }));
          schedule(onComplete, 620);
        }
      };

      typeNextCharacter();
    };

    const sendMessage = (channel, onComplete) => {
      const sendingKey = `${channel}Sending`;
      const sentKey = `${channel}Sent`;
      const textKey = `${channel}Text`;

      setDemo((current) => ({ ...current, [sendingKey]: true }));
      schedule(() => {
        setDemo((current) => ({
          ...current,
          [sendingKey]: false,
          [sentKey]: true,
          [textKey]: "",
        }));
        if (onComplete) schedule(onComplete, channel === "whatsapp" ? 1080 : 650);
      }, 240);
    };

    const runDemo = () => {
      if (demoHasRun.current) return;
      demoHasRun.current = true;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setDemo((current) => ({
          ...current,
          activeChannel: "complete",
          activationVisible: false,
          activationArrived: true,
          interfacesRevealed: true,
          whatsappSelected: true,
          whatsappSent: true,
          telegramSelected: true,
          telegramSent: true,
        }));
        return;
      }

      schedule(() => {
        setDemo((current) => ({
          ...current,
          activeChannel: "opening",
          activationVisible: true,
          activationArrived: false,
          interfacesRevealed: false,
          whatsappLaunchPressed: true,
          telegramLaunchPressed: true,
        }));
        schedule(() => {
          setDemo((current) => ({
            ...current,
            activationArrived: true,
            whatsappLaunchPressed: false,
            telegramLaunchPressed: false,
          }));
          schedule(() => {
            setDemo((current) => ({
              ...current,
              activeChannel: "whatsapp",
              interfacesRevealed: true,
              telegramLaunchPressed: false,
            }));
            schedule(() => {
              setDemo((current) => ({ ...current, whatsappSelecting: true }));
              schedule(() => {
                setDemo((current) => ({ ...current, whatsappSelecting: false, whatsappSelected: true }));
                schedule(() => {
                  typeMessage("whatsapp", WHATSAPP_DEMO_MESSAGE, () => {
                    sendMessage("whatsapp", () => {
                      setDemo((current) => ({ ...current, activeChannel: "telegram", telegramSelecting: true }));
                      schedule(() => {
                        setDemo((current) => ({ ...current, telegramSelecting: false, telegramSelected: true }));
                        schedule(() => {
                          typeMessage("telegram", TELEGRAM_DEMO_MESSAGE, () => {
                            sendMessage("telegram", () => setDemo((current) => ({ ...current, activeChannel: "complete" })));
                          });
                        }, 420);
                      }, 460);
                    });
                  });
                }, 320);
              }, 340);
            }, 860);
          }, 240);
        }, 180);
      }, 360);
    };

    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.35)) {
        observer.disconnect();
        runDemo();
      }
    }, { threshold: [0.35] });

    observer.observe(section);

    return () => {
      disposed = true;
      observer?.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <section ref={sectionRef} className="messaging-showcase" id="messaging" aria-labelledby="messaging-showcase-title">
      <div className="messaging-showcase-content">
        <div className="messaging-showcase-copy">
          <p className="messaging-showcase-kicker"><i />Messaging automation</p>
          <div className="messaging-title-row">
            <span className="messaging-service-mark" aria-hidden="true">
              <MessageCircle />
              <span className="messaging-service-dots">
                <i />
                <i />
                <i />
              </span>
            </span>
            <h2 id="messaging-showcase-title">Chat Workflow Automation</h2>
          </div>
        </div>

        <div className="messaging-showcase-details">
          <p className="messaging-showcase-intro">
            Manage conversations, contacts, outbound messages, and reusable replies across WhatsApp and Telegram.
          </p>

          <ul className="messaging-feature-list">
            {messagingFeatures.map((feature) => (
              <li key={feature}><span><MessageCircle /></span>{feature}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="messaging-preview-grid">
        <div className={`messenger-product-preview messenger-product-whatsapp${demo.interfacesRevealed ? " is-revealed" : " is-awaiting-reveal"}${demo.activeChannel === "whatsapp" ? " is-demo-active" : ""}${demo.activeChannel === "telegram" ? " is-demo-inactive" : ""}`}>
          <WhatsAppPreview typedText={demo.whatsappText} isTyping={demo.whatsappTyping} isSending={demo.whatsappSending} isSent={demo.whatsappSent} isSelected={demo.whatsappSelected} isSelecting={demo.whatsappSelecting} isLaunchPressed={demo.whatsappLaunchPressed} isWorkspaceOpen={demo.interfacesRevealed} />
          <WhatsAppWorkspaceLauncher
            isPressed={demo.whatsappLaunchPressed}
            isOpen={demo.interfacesRevealed}
            onOpen={() => setDemo((current) => ({ ...current, interfacesRevealed: true, whatsappLaunchPressed: false, activeChannel: "whatsapp" }))}
          />
        </div>
        <div className={`messenger-product-preview messenger-product-telegram${demo.interfacesRevealed ? " is-revealed" : " is-awaiting-reveal"}${demo.activeChannel === "telegram" ? " is-demo-active" : ""}${demo.activeChannel === "whatsapp" ? " is-demo-inactive" : ""}`}>
          <TelegramPreview typedText={demo.telegramText} isTyping={demo.telegramTyping} isSending={demo.telegramSending} isSent={demo.telegramSent} isSelected={demo.telegramSelected} isSelecting={demo.telegramSelecting} isLaunchPressed={demo.telegramLaunchPressed} isWorkspaceOpen={demo.interfacesRevealed} />
          <TelegramWorkspaceLauncher
            isPressed={demo.telegramLaunchPressed}
            isOpen={demo.interfacesRevealed}
            onOpen={() => setDemo((current) => ({ ...current, interfacesRevealed: true, telegramLaunchPressed: false }))}
          />
        </div>
      </div>
    </section>
  );
}

function ScrapingIntelligenceShowcase() {
  const sectionRef = useRef(null);
  const hasRun = useRef(false);
  const [demo, setDemo] = useState({
    phase: "idle",
    sourcePressed: false,
    postVisible: false,
    outputVisible: false,
    format: "json",
    jsonLines: 0,
    csvLines: 0,
  });

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;

    const timers = [];
    const schedule = (callback, delay) => timers.push(window.setTimeout(callback, delay));

    const runDemo = () => {
      if (hasRun.current) return;
      hasRun.current = true;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setDemo({
          phase: "complete",
          sourcePressed: false,
          postVisible: true,
          outputVisible: true,
          format: "csv",
          jsonLines: scrapingShowcaseJson.length,
          csvLines: scrapingShowcaseCsv.length,
        });
        return;
      }

      schedule(() => setDemo((current) => ({ ...current, phase: "selecting", sourcePressed: true })), 420);
      schedule(() => setDemo((current) => ({ ...current, phase: "opening", sourcePressed: false, postVisible: true })), 820);
      schedule(() => setDemo((current) => ({ ...current, phase: "scanning" })), 1450);
      schedule(() => setDemo((current) => ({ ...current, phase: "json", outputVisible: true, format: "json" })), 2920);
      scrapingShowcaseJson.forEach((_, index) => {
        schedule(() => setDemo((current) => ({ ...current, jsonLines: index + 1 })), 3060 + index * 205);
      });
      schedule(() => setDemo((current) => ({ ...current, phase: "csv", format: "csv" })), 5500);
      scrapingShowcaseCsv.forEach((_, index) => {
        schedule(() => setDemo((current) => ({ ...current, csvLines: index + 1 })), 5680 + index * 280);
      });
      schedule(() => setDemo((current) => ({ ...current, phase: "complete" })), 7300);
    };

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.32)) {
        observer.disconnect();
        runDemo();
      }
    }, { threshold: [0.32] });

    observer.observe(section);
    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <section ref={sectionRef} className={`scraping-showcase is-${demo.phase}`} id="scraping" aria-labelledby="scraping-showcase-title">
      <div className="scraping-showcase-copy">
        <p className="scraping-showcase-kicker"><i />Scraping intelligence</p>
        <div className="scraping-title-row">
          <span className="scraping-service-mark" aria-hidden="true">
            <Search />
          </span>
          <h2 id="scraping-showcase-title">Turn Social Activity into Structured Data</h2>
        </div>
        <p className="scraping-showcase-intro">
          Extract public profiles, posts, reels, comments, views, and engagement signals into clean, usable datasets.
        </p>

        <ul className="scraping-feature-list">
          {scrapingShowcaseFeatures.map((feature) => (
            <li key={feature}><span><Search /></span>{feature}</li>
          ))}
        </ul>
      </div>

      <div
        className={`scraping-workspace${demo.postVisible ? " has-post" : ""}${demo.outputVisible ? " has-output" : ""}`}
        aria-label="Animated social data extraction preview"
      >
        <div className="scraping-workspace-body">
          <aside className="scraping-sources">
            <p>Sources</p>
            <div className="scraping-source-list">
              {scrapingShowcaseSources.map((source, index) => (
                <div className={`scraping-source${index === 0 && (demo.sourcePressed || demo.postVisible) ? " is-selected" : ""}${index === 0 && demo.sourcePressed ? " is-pressed" : ""} is-enabled`} key={source.name}>
                  <img src={source.logo} alt="" />
                  <span><strong>{source.name}</strong><small>{source.status}</small></span>
                  <i />
                </div>
              ))}
            </div>
          </aside>

          <div className="scraping-post-stage">
            <div className={`scraping-post-placeholder${demo.postVisible ? " is-hidden" : ""}`}>
              <span><Search /></span><strong>Select a source</strong><small>Public content will open here</small>
            </div>
            <article className={`scraping-instagram-post${demo.postVisible ? " is-visible" : ""}`}>
              <div className="scraping-instagram-media">
                <img src="/scraping-nature-post.png" alt="Emerald alpine lake beneath sunlit mountains" />
              </div>
              <div className="scraping-instagram-details">
                <header>
                  <span className="scraping-post-avatar">W</span>
                  <p><strong>wildframe</strong><small>Alpine Lakes</small></p>
                  <button type="button">Follow</button>
                  <MoreVertical />
                </header>
                <div className="scraping-instagram-caption">
                  <p><strong>wildframe</strong> Morning light over the alpine lake—clear water, quiet trails, and an unforgettable sunrise.</p>
                  <span>#nature #mountains #travel</span>
                  <time>2 days ago</time>
                </div>
                <div className="scraping-instagram-comments">
                  <p><span className="scraping-comment-avatar is-one">A</span><span><strong>aarav.travels</strong>That reflection is incredible.</span><Heart /></p>
                  <p><span className="scraping-comment-avatar is-two">N</span><span><strong>nora.frames</strong>Adding this trail to my list.</span><Heart /></p>
                </div>
                <footer>
                  <div className="scraping-instagram-actions"><Heart /><MessageCircle /><Send /><Bookmark /></div>
                  <strong>18,426 likes</strong>
                  <time>2 DAYS AGO</time>
                  <p><Smile /><span>Add a comment...</span></p>
                </footer>
              </div>
              <span className="scraping-scan-line" />
              <span className="scraping-scan-label"><Search />Scanning complete post</span>
            </article>
          </div>

          <section className={`scraping-output-panel${demo.outputVisible ? " is-visible" : ""}`}>
            <header>
              <div>
                <button className={demo.format === "json" ? "is-active" : ""} type="button" onClick={() => setDemo((current) => ({ ...current, format: "json", outputVisible: true, jsonLines: scrapingShowcaseJson.length }))}>JSON</button>
                <button className={demo.format === "csv" ? "is-active" : ""} type="button" onClick={() => setDemo((current) => ({ ...current, format: "csv", outputVisible: true, csvLines: scrapingShowcaseCsv.length }))}>CSV</button>
              </div>
              <span className={`is-${demo.phase}`}><i />{demo.phase === "complete" ? "Export ready" : demo.outputVisible ? "Structuring" : "Awaiting scan"}</span>
            </header>
            {demo.format === "json" ? (
              <ol className="scraping-json-output" aria-label="JSON extraction preview">
                {scrapingShowcaseJson.map((line, index) => (
                  <li className={index < demo.jsonLines ? "is-visible" : ""} key={`${line.key || line.structural}-${index}`}>
                    <span>{index + 1}</span>
                    <code>
                      {line.structural || (
                        <><b>"{line.key}"</b><em>: </em><mark>{typeof line.value === "number" ? line.value : `"${line.value}"`}</mark>{index < scrapingShowcaseJson.length - 2 ? "," : ""}</>
                      )}
                    </code>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="scraping-csv-sheet" aria-label="CSV spreadsheet preview">
                <header><FileText /><strong>extracted-posts.csv</strong><span>4 rows</span></header>
                <div className="scraping-csv-grid">
                  <span className="scraping-csv-corner" />
                  {scrapingShowcaseCsv[0].map((_, index) => <span className="scraping-csv-column" key={`column-${index}`}>{String.fromCharCode(65 + index)}</span>)}
                  {scrapingShowcaseCsv.map((row, rowIndex) => (
                    <React.Fragment key={`row-${rowIndex}`}>
                      <span className={`scraping-csv-row-number${rowIndex < demo.csvLines ? " is-visible" : ""}`}>{rowIndex + 1}</span>
                      {row.map((cell, cellIndex) => (
                        <span className={`scraping-csv-cell${rowIndex === 0 ? " is-header" : ""}${rowIndex < demo.csvLines ? " is-visible" : ""}`} title={cell} key={`${rowIndex}-${cellIndex}`}>{cell}</span>
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
            <footer>
              <span>{demo.phase === "complete" ? demo.format === "csv" ? "4 rows · CSV ready" : "6 fields · JSON ready" : "Structuring result..."}</span>
              <div><button type="button" aria-label={`Copy ${demo.format.toUpperCase()}`}><Copy /></button><button type="button"><Download />Export</button></div>
            </footer>
          </section>
        </div>
      </div>
    </section>
  );
}

function ExecutionModelSection() {
  const cloudRoute = "M126 82 H166 M244 82 H388 M462 82 H520 C575 82 558 170 628 170";
  const localRoute = "M126 272 H166 M244 272 H388 M462 272 H520 C575 272 558 190 628 190";

  return (
    <section className="execution-model" id="execution-model" aria-labelledby="execution-model-title">
      <div className="execution-model-copy">
        <p className="execution-model-kicker"><i />Run it your way</p>
        <h2 id="execution-model-title">
          Cloud speed when possible.
          <span>Local control when needed.</span>
        </h2>
        <p className="execution-model-intro">
          Run supported workflows on managed servers, or use the Local Companion when browser sessions and account context need to stay on your machine.
        </p>
        <div className="execution-security-note">
          <LockKeyhole aria-hidden="true" />
          <p><strong>Your credentials stay local.</strong><span>Social passwords remain on the machine running the Companion.</span></p>
        </div>
      </div>

      <figure className="execution-map" aria-label="Server and Local Companion workflows converge into the AgenticThat workspace">
        <svg className="execution-map-routes" viewBox="0 0 760 360" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="execution-cloud-line" x1="0" x2="1">
              <stop stopColor="#5aa8ff" stopOpacity="0.35" />
              <stop offset="0.74" stopColor="#69b7ff" stopOpacity="0.82" />
              <stop offset="1" stopColor="#5adbb1" stopOpacity="0.72" />
            </linearGradient>
            <linearGradient id="execution-local-line" x1="0" x2="1">
              <stop stopColor="#36d6a0" stopOpacity="0.35" />
              <stop offset="0.74" stopColor="#4be2b2" stopOpacity="0.86" />
              <stop offset="1" stopColor="#5adbb1" stopOpacity="0.72" />
            </linearGradient>
            <filter id="execution-dot-glow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path className="execution-route is-cloud" d={cloudRoute} />
          <path className="execution-route is-local" d={localRoute} />
          <path className="execution-route is-merge" d="M628 170 C642 170 642 180 656 180 M628 190 C642 190 642 180 656 180" />
          <circle className="execution-traveller is-cloud" r="3.8" filter="url(#execution-dot-glow)">
            <animateMotion dur="4.1s" repeatCount="indefinite" path="M126 82 H520 C575 82 558 170 656 180" />
          </circle>
          <circle className="execution-traveller is-local" r="3.8" filter="url(#execution-dot-glow)">
            <animateMotion dur="4.1s" begin="-2.05s" repeatCount="indefinite" path="M126 272 H520 C575 272 558 190 656 180" />
          </circle>
        </svg>

        <div className="execution-lane-label is-server"><i /><strong>Server</strong><small>Managed execution</small></div>
        <div className="execution-lane-label is-local"><i /><strong>Local Companion</strong><small>On your machine</small></div>

        <div className="execution-map-node is-cloud-runner">
          <span><Cloud /></span><strong>Cloud runner</strong><small>Supported workflows</small>
        </div>
        <div className="execution-map-node is-output">
          <span><Database /></span><strong>Structured output</strong><small>Ready for your workflow</small>
        </div>
        <div className="execution-map-node is-browser">
          <span><Monitor /></span><strong>Browser session</strong><small>Runs on your machine</small>
        </div>
        <div className="execution-map-node is-secure">
          <span><ShieldCheck /></span><strong>Secure execution</strong><small>Account context stays local</small>
        </div>

        <div className="execution-workspace-core">
          <span>AT</span>
          <strong>AgenticThat</strong>
          <small>workspace</small>
        </div>
        <figcaption>Cloud and local workflows connect continuously to one AgenticThat workspace.</figcaption>
      </figure>
    </section>
  );
}

function PublishingAutomationShowcase() {
  const sectionRef = useRef(null);
  const hasRun = useRef(false);
  const [demo, setDemo] = useState({
    phase: "idle",
    uploadProgress: 0,
    captionLength: 0,
    selectedChannels: 0,
    deliveredChannels: 0,
  });

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;

    const timers = [];
    const schedule = (callback, delay) => timers.push(window.setTimeout(callback, delay));

    const runDemo = () => {
      if (hasRun.current) return;
      hasRun.current = true;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setDemo({
          phase: "complete",
          uploadProgress: 100,
          captionLength: PUBLISHING_SHOWCASE_CAPTION.length,
          selectedChannels: publishingShowcasePlatforms.length,
          deliveredChannels: publishingShowcasePlatforms.length,
        });
        return;
      }

      schedule(() => setDemo((current) => ({ ...current, phase: "uploading" })), 320);
      [18, 39, 64, 86, 100].forEach((progress, index) => {
        schedule(() => setDemo((current) => ({ ...current, uploadProgress: progress })), 440 + index * 135);
      });
      schedule(() => setDemo((current) => ({ ...current, phase: "caption" })), 1160);
      const captionFrames = Math.ceil(PUBLISHING_SHOWCASE_CAPTION.length / 3);
      Array.from({ length: captionFrames }).forEach((_, index) => {
        schedule(() => setDemo((current) => ({
          ...current,
          captionLength: Math.min((index + 1) * 3, PUBLISHING_SHOWCASE_CAPTION.length),
        })), 1260 + index * 34);
      });
      schedule(() => setDemo((current) => ({ ...current, phase: "channels" })), 2460);
      publishingShowcasePlatforms.forEach((_, index) => {
        schedule(() => setDemo((current) => ({ ...current, selectedChannels: index + 1 })), 2580 + index * 175);
      });
      schedule(() => setDemo((current) => ({ ...current, phase: "date" })), 3560);
      schedule(() => setDemo((current) => ({ ...current, phase: "time" })), 4210);
      schedule(() => setDemo((current) => ({ ...current, phase: "handoff" })), 4920);
      schedule(() => setDemo((current) => ({ ...current, phase: "publishing" })), 5650);
      publishingShowcasePlatforms.forEach((_, index) => {
        schedule(() => setDemo((current) => ({ ...current, deliveredChannels: index + 1 })), 6250 + index * 520);
      });
      schedule(() => setDemo((current) => ({ ...current, phase: "success" })), 8900);
      schedule(() => setDemo((current) => ({ ...current, phase: "complete" })), 9600);
    };

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.32)) {
        observer.disconnect();
        runDemo();
      }
    }, { threshold: [0.32] });

    observer.observe(section);
    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const isAtLeast = (phase) => {
    const order = ["idle", "uploading", "caption", "channels", "date", "time", "handoff", "publishing", "success", "complete"];
    return order.indexOf(demo.phase) >= order.indexOf(phase);
  };

  const postReady = demo.captionLength === PUBLISHING_SHOWCASE_CAPTION.length;
  const currentPublishingStage = isAtLeast("publishing") ? 3 : isAtLeast("channels") ? 2 : 1;
  const deliveryPaths = [
    "M180 102 L180 29",
    "M180 102 C222 88 253 70 297 61",
    "M180 102 C225 112 258 132 300 148",
    "M180 102 C142 120 111 139 67 151",
    "M180 102 C137 91 105 73 62 66",
  ];

  return (
    <section ref={sectionRef} className={`publishing-showcase is-${demo.phase}`} id="publishing" aria-labelledby="publishing-showcase-title">
      <header className="publishing-showcase-header">
        <p className="publishing-showcase-kicker"><i />Publishing automation</p>
        <div className="publishing-title-row">
          <span className="publishing-service-mark" aria-hidden="true">
            <span className="publishing-flight-mark">
              <svg className="publishing-flight-ribbon" viewBox="0 0 74 74" fill="none">
                <path className="publishing-flight-track" d="M12 53c-5-7-2-13 5-13 7 0 10 7 5 12-4 5-11 0-7-6 5-7 16-5 24-11 5-4 8-8 11-12" />
              </svg>
              <span className="publishing-paper-plane"><Send /></span>
            </span>
          </span>
          <h2 id="publishing-showcase-title">Create. Schedule. Publish. Track.</h2>
        </div>
        <p className="publishing-showcase-intro">
          Plan content once and let AgenticThat publish it everywhere at the perfect time, then track every result.
        </p>
        <ul className="publishing-feature-list">
          <li><span><Send /></span>Upload once and prepare one campaign</li>
          <li><span><Send /></span>Select every connected destination</li>
          <li><span><Send /></span>Choose the exact publishing time</li>
          <li><span><Send /></span>Track live delivery across channels</li>
        </ul>
      </header>

      <div className={`publishing-visual-shell${isAtLeast("channels") ? " has-schedule" : ""}${isAtLeast("handoff") ? " has-delivery" : ""}`}>
        <div className="publishing-workflow" aria-label="Animated multi-channel publishing workflow preview">
        <article className={`publishing-stage publishing-create-stage${currentPublishingStage === 1 ? " is-current" : " is-stage-complete"}`}>
          <div className={`publishing-upload-preview${isAtLeast("uploading") ? " is-uploaded" : ""}${demo.uploadProgress === 100 ? " is-complete" : ""}`}>
            <img src="/publishing-nature-cove.webp" alt="Emerald tropical cove bordered by dense coastal rainforest" />
            <div className="publishing-upload-state">
              <Image />
              <strong>{demo.uploadProgress < 100 ? "Uploading nature post" : "Upload complete"}</strong>
              <small>{demo.uploadProgress}%</small>
              <i><b style={{ width: `${demo.uploadProgress}%` }} /></i>
            </div>
            <button type="button" aria-label="Remove uploaded post">&times;</button>
            <div className="publishing-media-tools" aria-hidden="true"><Image /><Link2 /><Smile /><span>#</span></div>
          </div>

          <div className={`publishing-caption-editor${isAtLeast("caption") ? " is-active" : ""}`}>
            <label>Caption</label>
            <p>
              {PUBLISHING_SHOWCASE_CAPTION.slice(0, demo.captionLength)}
              {demo.phase === "caption" && !postReady ? <i /> : null}
            </p>
            <small>{demo.captionLength}/2200</small>
          </div>

          <div className={`publishing-hashtag-editor${postReady ? " is-visible" : ""}`}>
            <label>Hashtags</label>
            <p>#nature&nbsp;&nbsp; #mountains&nbsp;&nbsp; #travel</p>
          </div>

          <div className={`publishing-post-ready${postReady ? " is-visible" : ""}`}>
            <CheckCheck /><span>Post ready</span>
          </div>
        </article>

        <div className={`publishing-stage-connector${isAtLeast("channels") ? " is-active" : ""}${demo.phase === "channels" ? " is-transferring" : ""}`} aria-hidden="true"><i /><span>&rsaquo;</span><b><img src="/publishing-nature-cove.webp" alt="" /></b></div>

        <article className={`publishing-stage publishing-schedule-stage${currentPublishingStage === 2 ? " is-current" : currentPublishingStage > 2 ? " is-stage-complete" : ""}`}>
          <div className="publishing-channel-picker">
            {publishingShowcasePlatforms.map((platform, index) => (
              <div className={index < demo.selectedChannels ? "is-selected" : ""} key={platform.name}>
                <img src={platform.logo} alt="" />
                <span>{platform.name}</span>
                <i><CheckCheck /></i>
              </div>
            ))}
          </div>

          <div className={`publishing-calendar${isAtLeast("date") ? " is-selected" : ""}`}>
            <header><button type="button" aria-label="Previous month">&lsaquo;</button><strong>August 2026</strong><button type="button" aria-label="Next month">&rsaquo;</button></header>
            <div className="publishing-calendar-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="publishing-calendar-days">
              {publishingCalendarDays.map(([day, muted], index) => (
                <span className={`${muted ? "is-muted" : ""}${day === "18" && index === 23 && isAtLeast("date") ? " is-date-selected" : ""}`} key={`${day}-${index}`}>{day}</span>
              ))}
            </div>
            <div className={`publishing-time-select${isAtLeast("time") ? " is-selected" : ""}`}><CalendarClock /><span>11:00 AM</span><b aria-hidden="true" /></div>
          </div>

          <div className={`publishing-schedule-confirmation${isAtLeast("time") ? " is-visible" : ""}`}>
            <CalendarClock /><span>Scheduled for Aug 18, 2026 at 11:00 AM</span>
          </div>
        </article>

        <div className={`publishing-stage-connector${isAtLeast("handoff") ? " is-active" : ""}${demo.phase === "handoff" ? " is-transferring" : ""}`} aria-hidden="true"><i /><span>&rsaquo;</span><b><img src="/publishing-nature-cove.webp" alt="" /></b></div>

        <article className={`publishing-stage publishing-delivery-stage${currentPublishingStage === 3 ? " is-current" : ""}${isAtLeast("success") ? " is-stage-complete" : ""}`}>
          <div className="publishing-delivery-visual">
            <svg className="publishing-delivery-lines" viewBox="0 0 360 185" aria-hidden="true">
              {deliveryPaths.map((path, index) => (
                <path className={`${index < demo.deliveredChannels ? "is-delivered" : ""}${demo.phase === "publishing" && index === demo.deliveredChannels ? " is-active" : ""}`} d={path} key={path} />
              ))}
            </svg>

            {publishingShowcasePlatforms.map((platform, index) => (
              <div className={`publishing-destination-node is-${platform.position}${index < demo.deliveredChannels ? " is-delivered" : ""}${demo.phase === "publishing" && index === demo.deliveredChannels ? " is-active" : ""}`} key={platform.name}>
                <img src={platform.logo} alt={platform.shortName || platform.name} />
                <CheckCheck />
              </div>
            ))}

            <div className={`publishing-post-payload${isAtLeast("publishing") ? " is-ready" : ""}${demo.phase === "publishing" ? " is-sending" : ""}${isAtLeast("success") ? " is-complete" : ""}`}>
              <i />
              <img src="/publishing-nature-cove.webp" alt="Tropical cove post being published" />
            </div>

            {publishingShowcasePlatforms.map((platform, index) => (
              <span className={`publishing-post-flight is-${platform.position}${demo.phase === "publishing" && index === demo.deliveredChannels ? " is-active" : ""}${index < demo.deliveredChannels ? " is-delivered" : ""}`} aria-hidden="true" key={`flight-${platform.name}`}>
                <img src="/publishing-nature-cove.webp" alt="" />
              </span>
            ))}
            <small className="publishing-delivery-status">
              {demo.phase === "publishing" ? `Publishing ${Math.min(demo.deliveredChannels + 1, 5)} of 5` : isAtLeast("success") ? "Delivery complete" : "Waiting for schedule"}
            </small>
          </div>

          <div className={`publishing-success-receipt${isAtLeast("success") ? " is-visible" : ""}`}>
            <header><span><CheckCheck /></span><p><strong>Published successfully!</strong><small>Delivered to 5 channels</small></p><b>Completed</b></header>
            <div><span><Send />All channels published</span><strong>5 / 5 <CheckCheck /></strong></div>
            <div><span><FileText />Posts delivered</span><strong>5 / 5 <CheckCheck /></strong></div>
            <div><span><Activity />Status</span><strong>Live everywhere</strong></div>
          </div>

          <div className={`publishing-recent-activity${demo.phase === "complete" ? " is-visible" : ""}`}>
            <header><strong>Recent Activity</strong><small>View all</small></header>
            <div><img src="/publishing-nature-cove.webp" alt="Published tropical cove post" /><img src={InstagramLogo} alt="" /><p><strong>Instagram</strong><small>Aug 18, 2026 at 11:00 AM</small></p><span>Published</span></div>
          </div>
        </article>
      </div>
      </div>

      <span className="publishing-live-announcement" aria-live="polite">{demo.phase === "complete" ? "Post published successfully to five channels." : ""}</span>
    </section>
  );
}

function PostEngagementShowcase() {
  const sectionRef = useRef(null);
  const hasRun = useRef(false);
  const [demo, setDemo] = useState({
    phase: "idle",
    visibleTargets: 0,
    visiblePlatforms: 0,
    commentLength: 0,
    completedActions: 0,
  });

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;

    const timers = new Set();
    let observer;
    let disposed = false;

    const schedule = (callback, delay) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (!disposed) callback();
      }, delay);
      timers.add(timer);
    };

    const runDemo = () => {
      if (hasRun.current) return;
      hasRun.current = true;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setDemo({
          phase: "complete",
          visibleTargets: engagementShowcaseTargets.length,
          visiblePlatforms: engagementShowcaseTargets.length,
          commentLength: ENGAGEMENT_SHOWCASE_COMMENT.length,
          completedActions: 4,
        });
        return;
      }

      schedule(() => setDemo((current) => ({ ...current, phase: "loading" })), 280);
      engagementShowcaseTargets.forEach((_, index) => {
        schedule(() => setDemo((current) => ({ ...current, visibleTargets: index + 1 })), 430 + index * 255);
      });

      schedule(() => setDemo((current) => ({ ...current, phase: "platforms" })), 1600);
      engagementShowcaseTargets.forEach((_, index) => {
        schedule(() => setDemo((current) => ({ ...current, visiblePlatforms: index + 1 })), 1700 + index * 220);
      });

      schedule(() => setDemo((current) => ({ ...current, phase: "routing" })), 2940);
      schedule(() => setDemo((current) => ({ ...current, phase: "assigned" })), 3820);
      schedule(() => setDemo((current) => ({ ...current, phase: "opening" })), 4300);
      schedule(() => setDemo((current) => ({ ...current, phase: "liking" })), 4900);
      schedule(() => setDemo((current) => ({ ...current, phase: "commenting", completedActions: 1 })), 6200);

      Array.from({ length: ENGAGEMENT_SHOWCASE_COMMENT.length }).forEach((_, index) => {
        schedule(() => setDemo((current) => ({ ...current, commentLength: index + 1 })), 6360 + index * 38);
      });

      const commentFinishedAt = 6360 + ENGAGEMENT_SHOWCASE_COMMENT.length * 38;
      schedule(() => setDemo((current) => ({ ...current, completedActions: 2 })), commentFinishedAt + 260);
      schedule(() => setDemo((current) => ({ ...current, phase: "reposting" })), commentFinishedAt + 760);
      schedule(() => setDemo((current) => ({ ...current, phase: "following", completedActions: 3 })), commentFinishedAt + 1330);
      schedule(() => setDemo((current) => ({ ...current, phase: "complete", completedActions: 4 })), commentFinishedAt + 2050);
    };

    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.3)) {
        observer.disconnect();
        runDemo();
      }
    }, { threshold: [0.3] });

    observer.observe(section);
    return () => {
      disposed = true;
      observer?.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const phaseOrder = ["idle", "loading", "platforms", "routing", "assigned", "opening", "liking", "commenting", "reposting", "following", "complete"];
  const isAtLeast = (phase) => phaseOrder.indexOf(demo.phase) >= phaseOrder.indexOf(phase);
  const sessionIsLive = isAtLeast("opening");
  const commentText = ENGAGEMENT_SHOWCASE_COMMENT.slice(0, demo.commentLength);

  return (
    <section ref={sectionRef} className={`engagement-showcase is-${demo.phase}`} id="post-engagement" aria-labelledby="engagement-showcase-title">
      <header className="engagement-showcase-copy">
        <p className="engagement-showcase-kicker"><i />Post engagement agent</p>
        <div className="engagement-title-row">
          <span className="engagement-service-mark" aria-hidden="true">
            <MousePointerClick className="engagement-service-pointer" />
          </span>
          <h2 id="engagement-showcase-title">Engage With Every Post, Precisely.</h2>
        </div>
        <p className="engagement-showcase-intro">
          Upload a post URL, route it to the correct platform, and run monitored actions directly inside the live app.
        </p>
        <ul className="engagement-feature-list">
          {engagementShowcaseFeatures.map(({ label }) => (
            <li key={label}><span><MousePointerClick /></span>{label}</li>
          ))}
        </ul>
      </header>

      <div className={`engagement-workspace is-${demo.phase}`}>
        <div className="engagement-workspace-body">
          <section className="engagement-url-column" aria-label="Uploaded post URL targets">
            <div className={`engagement-url-input${demo.phase === "loading" ? " is-active" : ""}`}><Link2 /><span>Paste post URL here...</span><button type="button">Add target</button></div>
            <p className="engagement-column-label"><span>URL queue</span><b>{demo.visibleTargets} / {engagementShowcaseTargets.length}</b></p>
            <div className="engagement-target-list">
              {engagementShowcaseTargets.map((target, index) => (
                <div className={`engagement-target-row${index < demo.visibleTargets ? " is-visible" : ""}${index === 0 && isAtLeast("routing") ? " is-selected" : ""}${index === 0 && isAtLeast("assigned") ? " is-routed" : ""}`} key={target.name}>
                  <span>{index + 1}</span>
                  <div><strong>{target.url}</strong><small>{index === 0 && isAtLeast("assigned") ? "Assigned to Instagram" : "Target ready"}</small></div>
                  <i><Link2 /></i>
                </div>
              ))}
            </div>
          </section>

          <section className="engagement-router-column" aria-label="Platform assignment router">
            <div className={`engagement-domain-detection is-visible${isAtLeast("assigned") ? " is-connected" : ""}`}>
              <i />
              <span>
                <small>instagram.com · {isAtLeast("assigned") ? "connected" : "not connected"}</small>
                <strong>Instagram</strong>
              </span>
            </div>
            <div className="engagement-platform-list">
              {engagementShowcaseTargets.map((target, index) => (
                <div className={`engagement-platform-row${index < demo.visiblePlatforms ? " is-visible" : ""}${index === 0 && demo.phase === "routing" ? " is-detecting" : ""}${index === 0 && isAtLeast("assigned") ? " is-assigned" : ""}`} key={target.name}>
                  <img src={target.logo} alt="" />
                  <span>{target.name}</span>
                  <b className={index === 0 && isAtLeast("assigned") ? "is-connected" : ""}>
                    {index === 0 && isAtLeast("assigned") ? "Connected" : "Not connected"}
                  </b>
                </div>
              ))}
            </div>
          </section>

          <section className={`engagement-live-column${sessionIsLive ? " is-live" : ""}`} aria-label="Live Instagram engagement session">
            <article className={`engagement-instagram-app${sessionIsLive ? " is-open" : " is-locked"}${demo.phase === "liking" ? " is-liking" : ""}${demo.phase === "commenting" ? " is-commenting" : ""}${demo.phase === "reposting" ? " is-reposting" : ""}${demo.phase === "following" ? " is-following" : ""}`}>
              <div className="engagement-app-waiting">
                <img src={InstagramLogo} alt="" />
                <strong>{isAtLeast("assigned") ? "Opening assigned post" : "Waiting for assigned URL"}</strong>
                <small>{isAtLeast("assigned") ? "instagram.com/p/emerald-cove/" : "The post activates after routing"}</small>
              </div>

              <div className="engagement-ig-layout">
                <main className="engagement-ig-post">
                  <div className="engagement-ig-media-pane">
                    <img className="engagement-ig-media" src="/engagement-rainforest-cove-post.png" alt="Turquoise sea cove surrounded by dense tropical rainforest" />
                    <span className="engagement-ig-carousel-dots"><i /><i className="is-active" /><i /></span>
                  </div>

                  <section className="engagement-ig-comments-panel">
                    <header>
                      <img src="/engagement-rainforest-cove-post.png" alt="" />
                      <p><strong>coastline.journal</strong><small>Emerald Cove</small></p>
                      <button className={`engagement-follow-button${demo.phase === "following" ? " is-performing" : ""}${demo.completedActions >= 4 ? " is-complete" : ""}`} type="button">
                        {demo.phase === "following" ? "Following…" : demo.completedActions >= 4 ? "Following" : "Follow"}
                      </button>
                      <button type="button" aria-label="More options"><MoreVertical /></button>
                    </header>

                    <div className="engagement-ig-comment-thread">
                      <div className="engagement-ig-comment is-caption">
                        <img src="/engagement-rainforest-cove-post.png" alt="" />
                        <p><span><strong>coastline.journal</strong> Where the rainforest meets the sea. Clear water, a quiet shoreline, and one hidden tropical cove.</span><small>2d&nbsp;&nbsp; Reply</small></p>
                      </div>
                      <div className="engagement-ig-comment">
                        <span className="engagement-comment-avatar is-neutral"><User /></span>
                        <p><span><strong>aarav.travels</strong> That water looks unreal.</span><small>1d&nbsp;&nbsp; 184 likes&nbsp;&nbsp; Reply</small></p>
                        <Heart />
                      </div>
                      <div className="engagement-ig-comment">
                        <span className="engagement-comment-avatar is-neutral"><User /></span>
                        <p><span><strong>nora.frames</strong> Adding this cove to my list.</span><small>1d&nbsp;&nbsp; 92 likes&nbsp;&nbsp; Reply</small></p>
                        <Heart />
                      </div>
                      {demo.completedActions >= 2 ? (
                        <div className="engagement-ig-comment is-automated">
                          <span className="engagement-comment-avatar is-neutral"><User /></span>
                          <p><span><strong>agentic.that</strong> {ENGAGEMENT_SHOWCASE_COMMENT}</span><small>Now&nbsp;&nbsp; Posted</small></p>
                          <Heart aria-label="Like comment" />
                        </div>
                      ) : null}
                    </div>

                    <div className="engagement-ig-actions">
                      <button className={`engagement-action-like${demo.phase === "liking" ? " is-performing" : ""}${demo.completedActions >= 1 ? " is-complete" : ""}`} type="button" aria-label="Like post"><Heart /></button>
                      <button className={`engagement-action-comment${demo.phase === "commenting" ? " is-performing" : ""}${demo.completedActions >= 2 ? " is-complete" : ""}`} type="button" aria-label="Comment on post"><MessageCircle /></button>
                      <button className={`engagement-action-repost${demo.phase === "reposting" ? " is-performing" : ""}${demo.completedActions >= 3 ? " is-complete" : ""}`} type="button" aria-label="Repost"><Repeat2 /></button>
                      <button type="button" aria-label="Share post"><Send /></button>
                      <button type="button" aria-label="Save post"><Bookmark /></button>
                    </div>

                    <div className="engagement-ig-post-meta"><strong>24,813 likes</strong><small>2 days ago</small></div>

                    <div className={`engagement-comment-composer${demo.phase === "commenting" ? " is-active" : ""}${demo.completedActions >= 2 ? " is-posted" : ""}`}>
                      <Smile />
                      <span>{commentText || "Add a comment..."}{demo.phase === "commenting" && demo.commentLength < ENGAGEMENT_SHOWCASE_COMMENT.length ? <i /> : null}</span>
                      <button type="button">{demo.completedActions >= 2 ? "Posted" : "Post"}</button>
                    </div>

                  </section>
                </main>
              </div>
            </article>
          </section>

          {demo.phase === "routing" ? (
            <div className="engagement-routing-token" aria-hidden="true"><img src={InstagramLogo} alt="" /><span>instagram.com/p/emerald-cove/</span><CheckCheck /></div>
          ) : null}
        </div>
      </div>

      <span className="engagement-live-announcement" aria-live="polite">
        {demo.phase === "complete" ? "Instagram target completed with four verified engagement actions." : ""}
      </span>
    </section>
  );
}

function ScrapeIntelligenceCard({ service, onOpen }) {
  return (
    <article className="service-card scrape-intelligence-card">
      <div className="scrape-card-head">
        <h3>{service.name}</h3>
      </div>

      <div className="scrape-card-body">
        <div className="scrape-card-copy">
          <p>{service.description}</p>

          <div className="brand-icon-row" aria-label="Supported platforms">
            <img className="brand-icon" src={InstagramLogo} alt="Instagram" />
            <img className="brand-icon" src={FacebookLogo} alt="Facebook" />
          </div>

          <button className="scrape-card-open" type="button" onClick={onOpen}>
            Open scraping apps
          </button>
        </div>

        <video
          className="scrape-device-art"
          aria-hidden="true"
          autoPlay
          muted
          loop
          poster={ScrapeGlobeDevicePoster}
          playsInline
          preload="auto"
          tabIndex="-1"
          onLoadedMetadata={keepVideoSilent}
          onCanPlay={keepVideoSilent}
          onPlay={keepVideoSilent}
          onVolumeChange={keepVideoSilent}
        >
          <source src={ScrapeGlobeDeviceVideo} type="video/mp4" />
        </video>
      </div>
    </article>
  );
}

function StandardServiceCard({ service, onOpen }) {
  const content = (
    <>
      <div className="service-top">
        <h3>{service.name}</h3>
        <span>{onOpen ? service.action || "Open runner" : service.meta}</span>
      </div>
      <p className="repo">{service.repo}</p>
      <p className="service-text">{service.description}</p>
    </>
  );

  return onOpen ? (
    <button className="service-card service-card-button" type="button" onClick={onOpen}>
      {content}
    </button>
  ) : (
    <article className="service-card">{content}</article>
  );
}

function PlatformTile({ platform, onOpen }) {
  const isEnabled = Boolean(platform.enabled);
  const content = (
    <>
      <span className="platform-icon-shell">
        <img src={platform.logo} alt={platform.name} />
      </span>
      <span className="platform-name">{platform.name}</span>
      <span className={isEnabled ? "platform-action" : "platform-status"}>
        {platform.action || "Coming soon"}
      </span>
    </>
  );

  return isEnabled ? (
    <button className="platform-tile enabled" type="button" onClick={() => onOpen?.(platform)}>
      {content}
    </button>
  ) : (
    <article className="platform-tile">
      {content}
    </article>
  );
}

function SlideCopy({ kicker, title, description, align = "left" }) {
  return (
    <div className={align === "center" ? "text-center" : ""}>
      <span className="integration-kicker">{kicker}</span>
      <h3 className="mt-3 text-[clamp(24px,2.2vw,34px)] font-extrabold leading-[1.08] text-white">{title}</h3>
      <p className={`mt-3 text-[14.5px] leading-relaxed text-neutral-400 ${align === "center" ? "mx-auto max-w-2xl" : "max-w-xl"}`}>
        {description}
      </p>
    </div>
  );
}

/* Variant A — two channels get full spotlight treatment. */
function SpotlightSlide({ slide, onOpen }) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div>
        <SlideCopy {...slide} />
        <div className="mt-7 flex flex-wrap gap-6">
          {slide.stats.map((stat) => (
            <div key={stat.label}>
              <strong className="block bg-gradient-to-br from-yellow-200 to-amber-500 bg-clip-text text-3xl font-extrabold text-transparent">
                {stat.value}
              </strong>
              <small className="mt-1 block text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                {stat.label}
              </small>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {slide.platforms.map((platform) => (
          <button
            key={platform.name}
            type="button"
            onClick={() => onOpen?.(platform)}
            className="slide-card group flex flex-col items-start gap-4 p-6 text-left"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-black/50">
              <img className="h-10 w-10 object-contain" src={platform.logo} alt={platform.name} />
            </span>
            <span className="flex-1">
              <strong className="block text-lg font-extrabold text-white">{platform.name}</strong>
              <small className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                <i className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Live now
              </small>
            </span>
            <span className="platform-action w-full">{platform.action}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* Variant B — bento mosaic, first source featured large. */
function MosaicSlide({ slide, onOpen }) {
  const [featured, ...rest] = slide.platforms;

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-end">
        <SlideCopy kicker={slide.kicker} title={slide.title} />
        <p className="max-w-xl text-[14.5px] leading-relaxed text-neutral-400">{slide.description}</p>
      </div>

      {/* Featured tile holds a 2x2 block; the last small tile widens to close the grid. */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <button
          type="button"
          onClick={() => onOpen?.(featured)}
          className="slide-card slide-card-featured col-span-2 row-span-2 flex flex-col justify-between p-5 text-left"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-black/50">
            <img className="h-8 w-8 object-contain" src={featured.logo} alt={featured.name} />
          </span>
          <span className="mt-5">
            <strong className="block text-lg font-extrabold text-white">{featured.name}</strong>
            <small className="mt-1 block text-[12px] leading-snug text-neutral-400">
              Profiles, reels, hashtags and comments into clean structured data.
            </small>
            <span className="platform-action mt-3 inline-flex">{featured.action}</span>
          </span>
        </button>

        {rest.map((platform, position) => {
          const className = `slide-card flex flex-col items-center justify-center gap-2 p-3 text-center ${
            position === rest.length - 1 ? "col-span-2 md:col-span-2" : ""
          }`;
          const content = <>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/50">
              <img className="h-6 w-6 object-contain" src={platform.logo} alt={platform.name} />
            </span>
            <strong className="text-[12.5px] font-bold text-neutral-200">{platform.name}</strong>
            <span className={`${platform.enabled ? "platform-action" : "platform-status"} text-[10px]`}>
              {platform.action || "Coming soon"}
            </span>
          </>;
          return platform.enabled ? (
            <button key={platform.name} type="button" className={className} onClick={() => onOpen?.(platform)}>
              {content}
            </button>
          ) : (
            <article key={platform.name} className={className}>{content}</article>
          );
        })}
      </div>
    </div>
  );
}

/* Variant C — horizontal conveyor rail of destinations. */
function RailSlide({ slide, onOpen }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.52fr)_minmax(0,1fr)] lg:items-center">
      <SlideCopy {...slide} />

      <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {slide.platforms.map((platform, position) => (
          <button
            key={platform.name}
            type="button"
            onClick={() => onOpen?.(platform)}
            className="slide-card group flex min-w-[142px] flex-1 flex-col items-center gap-3 p-5 text-center"
          >
            <span className="text-[10px] font-extrabold tracking-[0.18em] text-neutral-600">
              {String(position + 1).padStart(2, "0")}
            </span>
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/50">
              <img className="h-9 w-9 object-contain" src={platform.logo} alt={platform.name} />
            </span>
            <strong className="text-sm font-extrabold text-white">{platform.name}</strong>
            <span className="platform-action w-full text-[11px]">{platform.action}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* Variant D — centered arc, everything still on the roadmap. */
function OrbitSlide({ slide }) {
  return (
    <div className="flex flex-col items-center">
      <SlideCopy {...slide} align="center" />

      <div className="mt-8 flex flex-wrap items-end justify-center gap-3">
        {slide.platforms.map((platform, position) => (
          <article
            key={platform.name}
            className="slide-card flex w-[112px] flex-col items-center gap-2.5 p-4 text-center"
            style={{ transform: `translateY(${Math.abs(position - (slide.platforms.length - 1) / 2) * -9}px)` }}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-black/50">
              <img className="h-7 w-7 object-contain opacity-70" src={platform.logo} alt={platform.name} />
            </span>
            <strong className="text-[12.5px] font-bold text-neutral-300">{platform.name}</strong>
          </article>
        ))}
      </div>

      <span className="platform-status mt-7 text-[11px]">Roadmap · Coming soon</span>
    </div>
  );
}

const slideVariants = {
  spotlight: SpotlightSlide,
  mosaic: MosaicSlide,
  rail: RailSlide,
  orbit: OrbitSlide,
};

function AutomationCarousel({ slides, handlers }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef(null);

  const goTo = (next) => setActive((slides.length + next) % slides.length);

  // Deep links from the nav (#messaging, #scraping, ...) select the matching slide.
  useEffect(() => {
    const syncFromHash = () => {
      const target = slides.findIndex((slide) => `#${slide.id}` === window.location.hash);
      if (target >= 0) setActive(target);
    };

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [slides]);

  useEffect(() => {
    if (paused) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    const timer = window.setInterval(() => setActive((current) => (current + 1) % slides.length), 7000);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  // Stagger the tiles of whichever slide just became active.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const tiles = trackRef.current?.querySelectorAll(`[data-slide="${active}"] .slide-card`);
    if (tiles?.length) {
      animate(tiles, {
        opacity: [0, 1],
        translateY: [18, 0],
        delay: stagger(55),
        duration: 480,
        ease: "outCubic",
      });
    }
  }, [active]);

  const currentSlide = slides[active];

  return (
    <section
      className="automation-carousel"
      aria-roledescription="carousel"
      aria-label="Automation services"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <nav className="flex flex-wrap gap-2" aria-label="Choose automation service">
          {slides.map((slide, position) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => goTo(position)}
              aria-current={position === active ? "true" : undefined}
              className={`h-9 rounded-full border px-4 text-[12px] font-bold transition-all ${
                position === active
                  ? "border-transparent bg-gradient-to-br from-yellow-200 via-yellow-400 to-amber-500 text-neutral-950 shadow-[0_3px_16px_rgba(250,204,21,0.32)]"
                  : "border-white/10 bg-white/5 text-neutral-400 hover:border-yellow-300/40 hover:text-white"
              }`}
            >
              {slide.tab}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <span className="mr-1 text-[11px] font-bold tabular-nums text-neutral-500">
            {String(active + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
          </span>
          <button type="button" onClick={() => goTo(active - 1)} aria-label="Previous service" className="carousel-arrow">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button type="button" onClick={() => goTo(active + 1)} aria-label="Next service" className="carousel-arrow">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </header>

      <div className="carousel-viewport">
        <div
          className="carousel-track"
          ref={trackRef}
          style={{ transform: `translateX(-${active * 100}%)` }}
        >
          {slides.map((slide, position) => {
            const SlideLayout = slideVariants[slide.variant];
            return (
              <article
                key={slide.id}
                id={slide.id}
                data-slide={position}
                className="carousel-slide"
                aria-hidden={position !== active}
                aria-roledescription="slide"
                aria-label={`${position + 1} of ${slides.length}: ${slide.title}`}
              >
                <SlideLayout slide={slide} onOpen={handlers[slide.id]} />
              </article>
            );
          })}
        </div>
      </div>

      <div className="carousel-progress" aria-hidden="true">
        {slides.map((slide, position) => (
          <span key={slide.id} className={position === active ? "is-active" : ""} />
        ))}
      </div>

      <p className="sr-only" aria-live="polite">{currentSlide.title}</p>
    </section>
  );
}

function PlatformHome({ initialUser = null, initialAuthMode = "", initialNextPath = "" }) {
  const [user, setUser] = useState(initialUser);
  const [authOpen, setAuthOpen] = useState(Boolean(initialAuthMode));
  const [authMode, setAuthMode] = useState(initialAuthMode === "signup" ? "signup" : "login");
  const [pendingDestination, setPendingDestination] = useState(initialNextPath);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    // Hero entrance: fade + rise the copy column and video panel with a stagger.
    const heroTargets = document.querySelectorAll(".hero-copy > *, .work-panel");
    heroTargets.forEach((el) => {
      el.style.opacity = "0";
    });
    animate(heroTargets, {
      opacity: [0, 1],
      translateY: [26, 0],
      delay: stagger(110),
      duration: 750,
      ease: "outCubic",
    });

    // Scroll reveal: cards, tiles, and integration sections rise in as they enter.
    // Only reveal the carousel shell — its slides sit off-screen horizontally and
    // would never intersect, leaving them stuck at opacity 0.
    const revealTargets = document.querySelectorAll(
      ".service-card, .section-head, .automation-carousel"
    );
    revealTargets.forEach((el) => {
      el.style.opacity = "0";
    });
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        visible.forEach((entry) => observer.unobserve(entry.target));
        if (visible.length) {
          animate(visible.map((entry) => entry.target), {
            opacity: [0, 1],
            translateY: [30, 0],
            delay: stagger(90),
            duration: 640,
            ease: "outCubic",
          });
        }
      },
      { threshold: 0.12 }
    );
    revealTargets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  const openAuth = (mode = "login", destination = "") => {
    setAuthMode(mode);
    setPendingDestination(destination);
    setAuthOpen(true);
  };

  const openProtectedService = (destination) => {
    if (!user) {
      openAuth("login", destination);
      return;
    }
    window.location.href = destination;
  };

  const openConfigManager = () => {
    openProtectedService(serviceEndpoints.configManager.consoleUrl);
  };

  const openContentManager = () => {
    openProtectedService(serviceEndpoints.contentManager.consoleUrl);
  };

  const openTelegramDashboard = () => {
    if (!serviceEndpoints.telegram.dashboardUrl) {
      window.alert(
        "Telegram console is not configured. Set VITE_TELEGRAM_DASHBOARD_URL or use the same-origin /console route."
      );
      return;
    }

    openProtectedService(serviceEndpoints.telegram.dashboardUrl);
  };

  const openInstagramScraper = () => {
    openProtectedService(serviceEndpoints.instagramScraper.consoleUrl);
  };

  const openFacebookScraper = () => {
    openProtectedService(serviceEndpoints.facebookScraper.consoleUrl);
  };

  const openScraperDashboard = (platform) => {
    if (platform?.name === "Facebook") {
      openFacebookScraper();
      return;
    }

    openInstagramScraper();
  };

  const openPublishQueue = () => {
    openProtectedService(serviceEndpoints.publishQueue.consoleUrl);
  };

  const openWhatsAppDashboard = () => {
    if (!serviceEndpoints.whatsapp.dashboardUrl) {
      window.alert(
        "WhatsApp console is not configured. Set NEXT_PUBLIC_WHATSAPP_DASHBOARD_URL to the deployed WhatsApp service URL."
      );
      return;
    }

    openProtectedService(serviceEndpoints.whatsapp.dashboardUrl);
  };

  const openMessagingDashboard = (platform) => {
    if (platform.name === "WhatsApp") {
      openWhatsAppDashboard();
      return;
    }

    openTelegramDashboard();
  };

  const handleAuthenticated = (authenticatedUser) => {
    setUser(authenticatedUser);
    setAuthOpen(false);
    window.history.replaceState({}, "", window.location.pathname);
    window.location.href = pendingDestination || "/apps";
  };

  const closeAuth = () => {
    setAuthOpen(false);
    setPendingDestination("");
    window.history.replaceState({}, "", window.location.pathname);
  };

  const signOut = async () => {
    await Promise.allSettled([
      fetch("/api/platform-auth/logout", { method: "POST" }),
      fetch("/api/telegram/auth/session", { method: "DELETE" }),
    ]);
    window.sessionStorage.removeItem("agenticthat-publish-queue-session");
    setUser(null);
  };

  return (
    <main className="site-shell">
      <nav className="nav-bar" aria-label="Main navigation">
        
        <a className="brand" href="/" aria-label="AgenticThat home">
          <span className="brand-mark">AT</span>
          <span className="brand-word">Agentic<span>That</span></span>
        </a>

        <div className="nav-links">
          {navItems.map((item) => (
            <a href={item.href} key={item.label}>{item.label}</a>
          ))}
        </div>

        <div className="nav-actions">
          {user ? (
            <div className="site-account">
              <span className="site-account-avatar">{String(user.name || user.email || "A").charAt(0).toUpperCase()}</span>
              <span className="site-account-copy"><strong>{user.name || "Workspace"}</strong><small>{user.email}</small></span>
              <button className="site-signout" type="button" onClick={signOut}>Sign out</button>
            </div>
          ) : (
            <>
              <button className="site-signin" type="button" onClick={() => openAuth("login")}>Sign in</button>
              <button className="site-create-account" type="button" onClick={() => openAuth("signup")}>Create account</button>
            </>
          )}
        </div>
      </nav>

      <section className="hero" aria-labelledby="hero-title">
        <CinematicSystemVisual />

        <div className="hero-copy">
          <p className="hero-eyebrow">AI agents for social operations</p>
          <h1 id="hero-title">
            <span>Agentic</span><span className="hero-title-that">That<i className="hero-title-particle-burst" /></span>
          </h1>

          <p className="hero-tagline">The social web, operated as one system.</p>
          <p className="hero-description">
            Collect public signals, manage conversations, publish across channels,
            and coordinate every workflow through intelligent agents.
          </p>

          <div className="hero-cta-row">
            <a href="/apps" className="hero-primary-cta">Explore the Store</a>
            <a href="#system-visual" className="hero-secondary-cta">
              <Play aria-hidden="true" /> Watch the system run
            </a>
          </div>

          <p className="hero-companion-note"><i />Server and Local Companion workflows</p>
        </div>
      </section>

      <div className="below-hero-shell">
        <MessagingAutomationShowcase />
        <ScrapingIntelligenceShowcase />
        <ExecutionModelSection />
        <PublishingAutomationShowcase />
        <PostEngagementShowcase />

        <AutomationCarousel
          slides={automationSlides}
          handlers={{
            messaging: openMessagingDashboard,
            scraping: openScraperDashboard,
            publishing: openPublishQueue,
            engagement: null,
          }}
        />
      </div>
      <AuthModal
        open={authOpen}
        initialMode={authMode}
        onClose={closeAuth}
        onAuthenticated={handleAuthenticated}
      />
    </main>
  );
}

export default PlatformHome;
