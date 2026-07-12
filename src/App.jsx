import React, { useEffect, useState } from "react";
import Video from "./public/Hero_video.mp4";
import InstagramLogo from "./public/instagram-logo.svg";
import TelegramLogo from "./public/telegram-logo.svg";
import { integrations } from "./integrations";
import "./App.css";

const navItems = ["Marketplace", "Services", "Solutions", "Docs", "Company"];

const keepVideoSilent = (event) => {
  event.currentTarget.muted = true;
  event.currentTarget.volume = 0;
};

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
            <h2>Services</h2>
          </div>

          <div className="wide-service-stack">
            <button
              className="wide-service-card telegram-service-card"
              type="button"
              onClick={openTelegramDashboard}
            >
              <span className="service-logo-shell">
                <img src={TelegramLogo} alt="Telegram" />
              </span>
              <span className="wide-service-copy">
                <span className="service-kicker">Telegram Automation</span>
                <span className="wide-service-title">Telegram Workflow Console</span>
                <span className="wide-service-description">
                  Connect Telegram accounts, manage profiles, contacts, posts, and send messages from one workspace.
                </span>
              </span>
              <span className="wide-service-action">Open console</span>
            </button>

            <article className="wide-service-card scraper-service-card">
              <span className="service-logo-shell">
                <img src={InstagramLogo} alt="Instagram" />
              </span>
              <span className="wide-service-copy">
                <span className="service-kicker">Scraping Service</span>
                <span className="wide-service-title">Instagram Scraper</span>
                <span className="wide-service-description">
                  Instagram scraping workflow will be connected here in the next step.
                </span>
              </span>
              <span className="wide-service-status">Coming next</span>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
