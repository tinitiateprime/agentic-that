import React, { useEffect, useState } from "react";
import { Send } from "lucide-react";
import Video from "./public/Hero_video.mp4";
import FacebookLogo from "./public/facebook-logo.svg";
import GoogleLogo from "./public/google-logo.svg";
import GoogleMapsLogo from "./public/google-maps-logo.svg";
import InstagramLogo from "./public/instagram-logo.svg";
import LinkedInLogo from "./public/linkedin-logo.png";
import ScrapeGlobeDevicePoster from "./public/scrape-globe-device-poster.png";
import ScrapeGlobeDeviceVideo from "./public/scrape-globe-device.mp4";
import { integrations } from "./integrations";
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

function App() {

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
    if (!integrations.telegram.dashboardUrl) {
      window.alert(
        "Telegram console is not configured. Set VITE_TELEGRAM_DASHBOARD_URL or use the same-origin /console route."
      );
      return;
    }

    window.location.href = integrations.telegram.dashboardUrl;
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
          <button
            className="telegram-nav-button"
            type="button"
            onClick={openTelegramDashboard}
            aria-label="Open Telegram dashboard"
            title="Open Telegram dashboard"
          >
            <Send size={17} aria-hidden="true" />
          </button>
          <button className="ghost-button" type="button">
            Contact
          </button>
          <button className="solid-button" type="button" onClick={openTelegramDashboard}>
            Console
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
        </div>
      </section>
    </main>
  );
}

export default App;
