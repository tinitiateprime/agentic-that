"use client";

import React, { useEffect, useRef, useState } from "react";
import { animate, stagger } from "animejs";
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
        
        <a className="brand" href="/" aria-label="AgenticThat home">AgenticThat</a>

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
        <div className="ai-aurora" aria-hidden="true"><i /><i /><i /></div>
        <div className="ai-grid-overlay" aria-hidden="true" />
        <div className="hero-grid">
<div className="hero-copy">
  <div className="hero-chip-row">
    <span className="ai-chip"><i />AI agents online</span>
  </div>
  <h1 id="hero-title">
    {title}
    {showCursor && <span className="typing-cursor">|</span>}
  </h1>

  <p className="hero-description">
    Deploy intelligent agents that handle web scraping, content publishing,
    and social workflow automation with precision. Build faster, automate
    smarter, and streamline every step of your digital operations.
  </p>

  <div className="hero-cta-row mt-10 flex flex-wrap items-center gap-3">
    <a
      href="/apps"
      className="inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-br from-yellow-200 via-yellow-400 to-amber-500 px-6 text-sm font-extrabold text-neutral-950 shadow-[0_4px_22px_rgba(250,204,21,0.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(250,204,21,0.5)]"
    >
      Explore the Store
    </a>
    <a
      href="#services"
      className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 text-sm font-bold text-neutral-200 transition-all hover:-translate-y-0.5 hover:border-yellow-300/40 hover:bg-white/10 hover:text-white"
    >
      See all services
    </a>
  </div>

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

        <div className="services-section" id="services">
          <div className="section-head">
            <h2>All Services</h2>
          </div>

          <div className="service-grid">
            {services.map((service) => (
              service.featured ? (
                <ScrapeIntelligenceCard
                  service={service}
                  key={service.name}
                  onOpen={() => openProtectedService(service.destination)}
                />
              ) : (
                <StandardServiceCard
                  key={service.name}
                  service={service}
                  onOpen={service.destination ? () => openProtectedService(service.destination) : null}
                />
              )
            ))}
          </div>

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
