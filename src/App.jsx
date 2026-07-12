import React, { useEffect, useState } from "react";
import Video from "./public/Hero_video.mp4";
import FacebookLogo from "./public/facebook-logo.svg";
import GoogleLogo from "./public/google-logo.svg";
import GoogleMapsLogo from "./public/google-maps-logo.svg";
import InstagramLogo from "./public/instagram-logo.svg";
import LinkedInLogo from "./public/linkedin-logo.png";
import ScrapeGlobeDevicePoster from "./public/scrape-globe-device-poster.png";
import ScrapeGlobeDeviceVideo from "./public/scrape-globe-device.mp4";
import TelegramLogo from "./public/telegram-logo.svg";
import WhatsAppLogo from "./public/whatsapp-logo.svg";
import XLogo from "./public/x-logo.svg";
import YouTubeLogo from "./public/youtube-logo.svg";
import { serviceEndpoints } from "./services";
import InstagramScraper from "./InstagramScraper";
import "./App.css";

const navItems = ["Marketplace", "Services", "Solutions", "Docs", "Company"];

const services = [
  {
    name: "Auto Scrape Intelligence",
    description: "Deploy intelligent agents to scrape Instagram profiles, reels, hashtags, comments and post signals into clean JSON/CSV files.",
    meta: "Data pipeline",
    featured: true,
  },
  {
    name: "Publish Queue Runner",
    description: "Schedule content from local folders across Instagram, X, LinkedIn, Facebook, and YouTube.",
    meta: "Content operations",
  },
  {
    name: "Post Engagement Agent",
    description: "Run monitored browser sessions with queued actions and verification handling.",
    meta: "Execution agent",
  },
];

const automationPlatforms = [
  { name: "Telegram", logo: TelegramLogo, action: "Console", enabled: true },
  { name: "WhatsApp", logo: WhatsAppLogo, action: "Coming soon" },
];

const scraperPlatforms = [
  { name: "Instagram", logo: InstagramLogo, action: "Console", enabled: true },
  { name: "Facebook", logo: FacebookLogo },
  { name: "X", logo: XLogo },
  { name: "Google", logo: GoogleLogo },
  { name: "Google Maps", logo: GoogleMapsLogo },
  { name: "LinkedIn", logo: LinkedInLogo },
];

const socialPublishingPlatforms = [
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
          defaultMuted
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
    <button className="platform-tile enabled" type="button" onClick={onOpen}>
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

function App() {
  if (window.location.pathname.startsWith("/scraper/instagram")) {
    return <InstagramScraper />;
  }

  const [title, setTitle] = useState("");
  const [showCursor, setShowCursor] = useState(true);

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

  const openTelegramDashboard = () => {
    if (!serviceEndpoints.telegram.dashboardUrl) {
      window.alert(
        "Telegram console is not configured. Set VITE_TELEGRAM_DASHBOARD_URL or use the same-origin /console route."
      );
      return;
    }

    window.location.href = serviceEndpoints.telegram.dashboardUrl;
  };

  const openInstagramScraper = () => {
    window.location.href = serviceEndpoints.instagramScraper.consoleUrl;
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
          <button className="ghost-button" type="button">
            Contact
          </button>
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
    defaultMuted
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
              <article className="service-card" key={service.name}>
                <div className="service-top">
                  <h3>{service.name}</h3>
                  <span>{service.meta}</span>
                </div>
                <p className="repo">{service.repo}</p>
                <p className="service-text">{service.description}</p>
              </article>
              )
            ))}
          </div>

          <div className="integration-service-stack">
            <IntegrationServiceSection
              kicker="Messaging Automation"
              title="Chat Workflow Automation"
              description="Automate account workflows, contacts, campaigns, and outbound messages across chat channels. Telegram is live now, and WhatsApp is reserved for the next integration."
              platforms={automationPlatforms}
              onOpen={openTelegramDashboard}
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
              description="Queue, schedule, and track publishing workflows across major social channels once each platform connector is added."
              platforms={socialPublishingPlatforms}
            />

            <IntegrationServiceSection
              kicker="Engagement Service"
              title="Post Engagement Agent"
              description="Prepare monitored engagement workflows for posts, replies, interactions, and verification-driven actions across social channels."
              platforms={socialPublishingPlatforms}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
