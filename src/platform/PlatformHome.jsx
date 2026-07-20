"use client";

import React, { useEffect, useState } from "react";
import { serviceEndpoints } from "./service-catalog";
import AuthModal from "./AuthModal";

const Video = "/Hero_video.mp4";
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

const navItems = ["Marketplace", "Services", "Solutions", "Docs", "Company"];

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
    description: "Deploy intelligent agents to scrape Instagram profiles, reels, hashtags, comments and post signals into clean JSON/CSV files.",
    meta: "Data pipeline",
    featured: true,
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
  { name: "Facebook", logo: FacebookLogo },
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

const keepVideoSilent = (event) => {
  event.currentTarget.muted = true;
  event.currentTarget.volume = 0;
};

function ScrapeIntelligenceCard({ service }) {
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
            <img className="brand-icon" src={LinkedInLogo} alt="LinkedIn" />
            <img className="brand-icon" src={FacebookLogo} alt="Facebook" />
            <img className="brand-icon" src={GoogleMapsLogo} alt="Google Maps" />
            <img className="brand-icon" src={GoogleLogo} alt="Google" />
          </div>
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

function IntegrationServiceSection({ kicker, title, description, platforms, onOpen }) {
  return (
    <article className="integration-service-section">
      <div className="integration-service-copy">
        <span className="integration-kicker">{kicker}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      <div className="platform-grid">
        {platforms.map((platform) => (
          <PlatformTile
            key={platform.name}
            platform={platform}
            onOpen={onOpen}
          />
        ))}
      </div>
    </article>
  );
}

function PlatformHome({ initialUser = null, initialAuthMode = "", initialNextPath = "" }) {
  const [title, setTitle] = useState("");
  const [showCursor, setShowCursor] = useState(true);
  const [user, setUser] = useState(initialUser);
  const [authOpen, setAuthOpen] = useState(Boolean(initialAuthMode));
  const [authMode, setAuthMode] = useState(initialAuthMode === "signup" ? "signup" : "login");
  const [pendingDestination, setPendingDestination] = useState(initialNextPath);

  useEffect(() => {
    let current = "";

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const runAnimation = async () => {
      // Type "Agentic"
      for (const ch of "Agentic") {
        current += ch;
        setTitle(current);
        await sleep(110);
      }

      // Blink once
      setShowCursor(false);
      await sleep(180);
      setShowCursor(true);
      await sleep(180);

      // Type "That"
      for (const ch of "That") {
        current += ch;
        setTitle(current);
        await sleep(110);
      }

      // Blink whole title once
      setShowCursor(false);
      await sleep(180);
      setShowCursor(true);
      await sleep(180);

      // Hide cursor forever
      setShowCursor(false);
    };

    runAnimation();
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

  const openPublishQueue = () => {
    openProtectedService(serviceEndpoints.publishQueue.consoleUrl);
  };

  const openWhatsAppDashboard = () => {
    if (!serviceEndpoints.whatsapp.dashboardUrl) {
      window.alert(
        "WhatsApp console is not configured. Set VITE_WHATSAPP_DASHBOARD_URL to the deployed WhatsApp service URL."
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
    if (pendingDestination) window.location.href = pendingDestination;
  };

  const closeAuth = () => {
    setAuthOpen(false);
    setPendingDestination("");
    window.history.replaceState({}, "", window.location.pathname);
  };

  const signOut = async () => {
    await fetch("/api/platform-auth/logout", { method: "POST" });
    setUser(null);
  };

  return (
    <main className="site-shell">
      <nav className="nav-bar" aria-label="Main navigation">
        
        <div className="brand">AgenticThat</div>

        <div className="nav-links">
          {navItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>

        <div className="nav-actions">
          {user && (
            <>
              <button className="site-content-manager" type="button" onClick={openContentManager}>
                Content Manager
              </button>
              <button className="site-config-manager" type="button" onClick={openConfigManager}>
                Config Manager
              </button>
            </>
          )}
          <button className="ghost-button" type="button">
            Contact
          </button>
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
        <div className="hero-grid">
<div className="hero-copy">
  <h1 id="hero-title">
    {title}
    {showCursor && <span className="typing-cursor">|</span>}
  </h1>

  <p className="hero-description">
    Deploy intelligent agents that handle web scraping, content publishing,
    and social workflow automation with precision. Build faster, automate
    smarter, and streamline every step of your digital operations.
  </p>  
{/* 
            <div className="search-row">
              <label className="search-box" aria-label="Search services">
                <input placeholder="search for services" />
              </label>
              <button type="button">Search</button>            </div> */}
          </div>

         <div className="work-panel" aria-hidden="true">
  <video
    className="work-panel-video"
    autoPlay
    muted
    loop
    playsInline
    preload="auto"
    tabIndex="-1"
    disablePictureInPicture
    onLoadedMetadata={keepVideoSilent}
    onCanPlay={keepVideoSilent}
    onPlay={keepVideoSilent}
    onVolumeChange={keepVideoSilent}
  >
    <source src={Video} type="video/mp4" />
    Your browser does not support the video tag.
  </video>
</div>
        </div>

        <div className="services-section">
          <div className="section-head">
            <h2>All Services</h2>
          </div>

          <div className="service-grid">
            {services.map((service) => (
              service.featured ? (
                <ScrapeIntelligenceCard service={service} key={service.name} />
              ) : (
                <StandardServiceCard
                  key={service.name}
                  service={service}
                  onOpen={service.destination ? () => openProtectedService(service.destination) : null}
                />
              )
            ))}
          </div>

          <div className="integration-service-stack">
            <IntegrationServiceSection
              kicker="Messaging Automation"
              title="Chat Workflow Automation"
              description="Automate account workflows, contacts, campaigns, templates, inbox replies, and outbound messages across Telegram and WhatsApp."
              platforms={automationPlatforms}
              onOpen={openMessagingDashboard}
            />

            <IntegrationServiceSection
              kicker="Scraping Service"
              title="Social and Search Scrapers"
              description="Run Instagram scraping now, with placeholders ready for public pages, search results, maps listings, and professional profiles."
              platforms={scraperPlatforms}
              onOpen={openInstagramScraper}
            />

            <IntegrationServiceSection
              kicker="Publishing Service"
              title="Publish Queue Runner"
              description="Create, queue, schedule, and track browser-based publishing workflows across all connected social channels."
              platforms={publishingPlatforms}
              onOpen={openPublishQueue}
            />

            <IntegrationServiceSection
              kicker="Engagement Service"
              title="Post Engagement Agent"
              description="Prepare monitored engagement workflows for posts, replies, interactions, and verification-driven actions across social channels."
              platforms={socialEngagementPlatforms}
            />
          </div>
        </div>
      </section>
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
