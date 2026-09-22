import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  Mail,
  MapPin,
  Menu,
  Phone,
  Sparkles,
} from "lucide-react";
import WebsiteSelectionBar from "./WebsiteSelectionBar";
import "./generated-website.css";

const routePath = (route) => (Array.isArray(route) ? route.filter(Boolean) : []);

function contactHref(profile) {
  if (profile.bookingUrl) return profile.bookingUrl;
  if (profile.phone) return `tel:${profile.phone.replace(/[^+\d]/g, "")}`;
  if (profile.email) return `mailto:${profile.email}`;
  return "#contact";
}

function siteBase(project, theme, previewToken) {
  return previewToken
    ? `/site-preview/${encodeURIComponent(previewToken)}/${encodeURIComponent(theme)}`
    : `/sites/${encodeURIComponent(project.publicSlug)}`;
}

function pageHref(base, path = "") {
  return path ? `${base}/${path.replace(/^\/+/, "")}` : base;
}

function serviceSlug(service, index = 0) {
  if (service.slug) return service.slug;
  return String(service.name || `service-${index + 1}`)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function initials(name) {
  return String(name || "Business").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function Brand({ profile, site, base }) {
  return <a className="waas-logo" href={base} aria-label={`${profile.businessName} home`}>
    <span className={`waas-brand-mark style-${site.brand?.logoStyle || "monogram"}`} aria-hidden="true"><i />{initials(profile.businessName)}</span>
    <span className="waas-brand-copy"><strong>{profile.businessName}</strong><small>{site.brand?.tagline}</small></span>
  </a>;
}

function Photo({ photo, fallbackLabel, className = "", eager = false }) {
  if (!photo?.src) return <div className={`waas-photo-fallback ${className}`} aria-label={fallbackLabel}>
    <span className="waas-photo-orbit one" /><span className="waas-photo-orbit two" />
    <strong>{initials(fallbackLabel)}</strong><small><Sparkles size={14} /> Crafted for {fallbackLabel}</small>
  </div>;
  return <figure className={`waas-photo ${className}`}>
    <img src={photo.src} alt={photo.alt || fallbackLabel} loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"} referrerPolicy="no-referrer" />
    {photo.provider === "pexels" && <figcaption>Photo {photo.photographer && <>by {photo.photographer} </>}{photo.sourceUrl ? <a href={photo.sourceUrl} target="_blank" rel="noreferrer">on Pexels</a> : "via Pexels"}</figcaption>}
  </figure>;
}

function Header({ project, theme, previewToken, active }) {
  const { businessProfile: profile, siteSpec: site } = project;
  const base = siteBase(project, theme, previewToken);
  const links = [["home", "Home", ""], ["services", "Services", "services"], ["about", "About", "about"], ["contact", "Contact", "contact"]];
  return <header className="waas-nav">
    <Brand profile={profile} site={site} base={base} />
    <nav aria-label="Primary navigation">{links.map(([key, label, path]) => <a className={active === key ? "active" : ""} href={pageHref(base, path)} key={key}>{label}</a>)}</nav>
    <a className="waas-nav-cta" href={contactHref(profile)}>{profile.bookingUrl ? <CalendarDays size={16} /> : <Phone size={16} />}{site.hero?.primaryCta || "Get in touch"}<ArrowUpRight size={15} /></a>
    <details className="waas-mobile-menu"><summary aria-label="Open navigation"><Menu size={21} /></summary><div>{links.map(([key, label, path]) => <a className={active === key ? "active" : ""} href={pageHref(base, path)} key={key}>{label}<ArrowRight size={15} /></a>)}<a href={contactHref(profile)}>Call or enquire<Phone size={15} /></a></div></details>
  </header>;
}

function ContactDetails({ profile }) {
  const rows = [
    profile.location && { icon: MapPin, kind: "Location", label: profile.location },
    profile.phone && { icon: Phone, kind: "Call", label: profile.phone, href: `tel:${profile.phone.replace(/[^+\d]/g, "")}` },
    profile.email && { icon: Mail, kind: "Email", label: profile.email, href: `mailto:${profile.email}` },
    profile.hours && { icon: Clock3, kind: "Hours", label: profile.hours },
  ].filter(Boolean);
  return <div className="waas-contact-details">{rows.map((item) => {
    const Icon = item.icon;
    const content = <><span><Icon size={17} /></span><div><small>{item.kind}</small><strong>{item.label}</strong></div></>;
    return item.href ? <a href={item.href} key={item.label}>{content}</a> : <span key={item.label}>{content}</span>;
  })}</div>;
}

function FaqList({ items }) {
  return <div className="waas-faq-list">{(items || []).map((item, index) => <details key={item.question} open={index === 0}><summary><span>{String(index + 1).padStart(2, "0")}</span>{item.question}<i>+</i></summary><p>{item.answer}</p></details>)}</div>;
}

function ServiceCard({ service, index, base, photo }) {
  const slug = serviceSlug(service, index);
  return <article className="waas-service-card">
    <div className="waas-service-photo-link"><Photo photo={photo} fallbackLabel={service.name} /></div>
    <div className="waas-service-card-copy"><span className="waas-card-index">{String(index + 1).padStart(2, "0")}</span><small>{service.idealFor || "A focused solution for your next step"}</small><h3><a href={pageHref(base, `services/${slug}`)}>{service.name}</a></h3><p>{service.summary}</p><a className="waas-text-link" href={pageHref(base, `services/${slug}`)}>{service.ctaLabel || "Explore service"}<ArrowUpRight size={16} /></a></div>
  </article>;
}

function ContactCta({ profile, site }) {
  return <section className="waas-contact" id="contact"><div><p className="waas-eyebrow">{site.contact?.eyebrow || "Start a conversation"}</p><h2>{site.contact?.title}</h2><p>{site.contact?.copy}</p></div><div className="waas-contact-action"><a href={contactHref(profile)}>{site.contact?.ctaLabel || "Get in touch"}<ArrowRight size={18} /></a><ContactDetails profile={profile} /></div></section>;
}

function Gallery({ site, profile }) {
  const gallery = site.media?.gallery || [];
  if (!gallery.length) return null;
  return <section className="waas-gallery-section"><div className="waas-section-heading compact"><p className="waas-eyebrow">Inside the experience</p><h2>Work that feels considered from every angle.</h2><p>Photography selected around the real environment, craft and customer experience behind {profile.businessType.toLowerCase()}.</p></div><div className="waas-gallery">{gallery.map((photo, index) => <Photo key={photo.id || photo.src} photo={photo} fallbackLabel={`${profile.businessName} ${index + 1}`} className={`item-${index + 1}`} />)}</div></section>;
}

function HomePage({ project, theme, previewToken }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const base = siteBase(project, theme, previewToken);
  const services = site.services || [];
  return <>
    <Header project={project} theme={theme} previewToken={previewToken} active="home" />
    <main>
      <section className="waas-hero"><div className="waas-hero-copy"><p className="waas-eyebrow"><Sparkles size={14} />{site.hero.eyebrow}</p><h1>{site.hero.headline}</h1><p className="waas-lead">{site.hero.subheadline}</p><div className="waas-actions"><a className="primary" href={contactHref(profile)}>{site.hero.primaryCta}<ArrowRight size={18} /></a><a className="secondary" href={pageHref(base, "services")}>{site.hero.secondaryCta}<ArrowDownRight size={17} /></a></div><div className="waas-hero-proof"><span><strong>{services.length}</strong><small>Focused services</small></span>{profile.location && <span><MapPin size={18} /><small>Serving<br /><strong>{profile.location}</strong></small></span>}<span><BadgeCheck size={18} /><small>Clear, useful<br /><strong>next steps</strong></small></span></div></div><div className="waas-hero-media"><Photo photo={site.media?.hero} fallbackLabel={profile.businessType} eager /><div className="waas-hero-note"><span>Designed around</span><strong>{site.brand.tagline}</strong></div></div></section>
      <section className="waas-marquee" aria-label="Business highlights"><span>{profile.businessType}</span><i /><span>{site.brand.tagline}</span><i /><span>{profile.location || "Thoughtful service"}</span><i /><span>Built around real needs</span></section>
      <section className="waas-section waas-services"><div className="waas-section-heading"><p className="waas-eyebrow">{site.servicesIntro.eyebrow}</p><h2>{site.servicesIntro.title}</h2><p>{site.servicesIntro.copy}</p></div><div className="waas-service-grid">{services.slice(0, 6).map((service, index) => <ServiceCard key={service.name} service={service} index={index} base={base} photo={site.media?.services?.[serviceSlug(service, index)]} />)}</div>{services.length > 6 && <a className="waas-all-services" href={pageHref(base, "services")}>Explore all {services.length} services<ArrowRight size={18} /></a>}</section>
      <section className="waas-section waas-story"><div className="waas-story-media"><Photo photo={site.media?.story || site.media?.gallery?.[0]} fallbackLabel={profile.businessType} /><span>{site.brand.logoConcept || "A brand built around clarity and confident service."}</span></div><div className="waas-story-copy"><p className="waas-eyebrow">{site.about.eyebrow}</p><h2>{site.about.title}</h2><p>{site.about.body}</p><div className="waas-benefit-grid">{site.benefits.map((item) => <article key={item.title}><BadgeCheck size={20} /><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div><a className="waas-text-link" href={pageHref(base, "about")}>Discover our approach<ArrowRight size={16} /></a></div></section>
      <Gallery site={site} profile={profile} />
      <section className="waas-section waas-process"><div className="waas-section-heading"><p className="waas-eyebrow">A clear path forward</p><h2>From first question to the right next step.</h2><p>A straightforward experience shaped around what customers need to understand, decide and do next.</p></div><div className="waas-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div></section>
      <section className="waas-section waas-faq"><div className="waas-section-heading"><p className="waas-eyebrow">Useful answers</p><h2>Clarity before you begin.</h2><p>Helpful answers to the questions people naturally ask before taking the next step.</p></div><FaqList items={site.faq} /></section>
      <ContactCta profile={profile} site={site} />
    </main>
  </>;
}

function PageHero({ eyebrow, title, copy, photo, profile }) {
  return <section className="waas-page-hero"><div><p className="waas-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div><Photo photo={photo} fallbackLabel={profile.businessType} eager /></section>;
}

function ServicesPage({ project, theme, previewToken }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const base = siteBase(project, theme, previewToken);
  return <><Header project={project} theme={theme} previewToken={previewToken} active="services" /><main><PageHero eyebrow={site.servicesIntro.eyebrow} title={site.servicesIntro.title} copy={site.servicesIntro.copy} photo={site.media?.hero} profile={profile} /><section className="waas-section waas-services-page"><div className="waas-service-grid">{site.services.map((service, index) => <ServiceCard key={service.name} service={service} index={index} base={base} photo={site.media?.services?.[serviceSlug(service, index)]} />)}</div></section><section className="waas-section waas-process"><div className="waas-section-heading"><p className="waas-eyebrow">How it works</p><h2>A clear experience, whatever you need.</h2><p>{site.brand.positioning}</p></div><div className="waas-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div></section><ContactCta profile={profile} site={site} /></main></>;
}

function ServicePage({ project, theme, previewToken, service, serviceIndex }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const base = siteBase(project, theme, previewToken);
  const photo = site.media?.services?.[serviceSlug(service, serviceIndex)] || site.media?.hero;
  const related = site.services.filter((item) => item.name !== service.name).slice(0, 3);
  const pageSections = service.pageSections?.length ? service.pageSections : [
    { title: `About ${service.name}`, copy: service.summary },
    { title: "What to consider", copy: (service.details || []).join(". ") },
  ];
  return <><Header project={project} theme={theme} previewToken={previewToken} active="services" /><main><section className="waas-service-hero"><div className="waas-service-hero-copy"><a href={pageHref(base, "services")}><ArrowLeft size={15} /> All services</a><p className="waas-eyebrow">{profile.businessType}</p><h1>{service.pageHeadline || service.name}</h1><p>{service.pageIntro || service.summary}</p><div className="waas-actions"><a className="primary" href={contactHref(profile)}>{service.ctaLabel || site.hero.primaryCta}<ArrowRight size={17} /></a>{profile.phone && <a className="secondary" href={`tel:${profile.phone.replace(/[^+\d]/g, "")}`}><Phone size={16} /> Call {profile.businessName}</a>}</div></div><Photo photo={photo} fallbackLabel={service.name} eager /></section><section className="waas-service-band"><span>Designed for</span><strong>{service.idealFor || `People exploring ${service.name}`}</strong></section><section className="waas-section waas-service-detail"><div className="waas-service-aside"><p className="waas-eyebrow">At a glance</p><h2>{service.name}</h2><ul>{service.details.map((detail) => <li key={detail}><Check size={16} />{detail}</li>)}</ul></div><div className="waas-service-sections">{pageSections.map((section, index) => <article key={section.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h2>{section.title}</h2><p>{section.copy}</p></div></article>)}</div></section>{related.length > 0 && <section className="waas-section waas-related"><div className="waas-section-heading compact"><p className="waas-eyebrow">Explore more</p><h2>Related ways we can help.</h2><p>Continue exploring the services that may support your next step.</p></div><div className="waas-service-grid">{related.map((item) => { const index = site.services.indexOf(item); return <ServiceCard key={item.name} service={item} index={index} base={base} photo={site.media?.services?.[serviceSlug(item, index)]} />; })}</div></section>}<ContactCta profile={profile} site={site} /></main></>;
}

function AboutPage({ project, theme, previewToken }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  return <><Header project={project} theme={theme} previewToken={previewToken} active="about" /><main><PageHero eyebrow={site.about.eyebrow} title={site.about.title} copy={site.about.body} photo={site.media?.story || site.media?.hero} profile={profile} /><section className="waas-section waas-about-page"><div><p className="waas-eyebrow">What guides the experience</p><h2>{site.brand.positioning}</h2></div><div className="waas-benefit-grid">{site.benefits.map((item) => <article key={item.title}><BadgeCheck size={21} /><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></section><Gallery site={site} profile={profile} /><section className="waas-section waas-process"><div className="waas-section-heading"><p className="waas-eyebrow">The journey</p><h2>Simple, clear and considered.</h2><p>Every stage is designed to help customers understand what happens next.</p></div><div className="waas-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div></section><ContactCta profile={profile} site={site} /></main></>;
}

function ContactPage({ project, theme, previewToken }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  return <><Header project={project} theme={theme} previewToken={previewToken} active="contact" /><main><section className="waas-contact-page"><div className="waas-contact-page-copy"><p className="waas-eyebrow">{site.contact.eyebrow}</p><h1>{site.contact.title}</h1><p>{site.contact.copy}</p><ContactDetails profile={profile} /><div className="waas-actions"><a className="primary" href={contactHref(profile)}>{site.contact.ctaLabel}<ArrowRight size={17} /></a>{profile.email && <a className="secondary" href={`mailto:${profile.email}`}><Mail size={16} /> Email us</a>}</div></div><Photo photo={site.media?.hero} fallbackLabel={profile.businessType} eager /></section><section className="waas-section waas-contact-faq"><div className="waas-section-heading"><p className="waas-eyebrow">Before you reach out</p><h2>A few helpful answers.</h2><p>Find the essentials, then contact the team when you are ready.</p></div><FaqList items={site.faq} /></section></main></>;
}

function Footer({ project, theme, previewToken }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const base = siteBase(project, theme, previewToken);
  return <footer className="waas-footer"><div className="waas-footer-brand"><Brand profile={profile} site={site} base={base} /><p>{site.brand.positioning}</p></div><div><strong>Explore</strong><a href={base}>Home</a><a href={pageHref(base, "services")}>Services</a><a href={pageHref(base, "about")}>About</a><a href={pageHref(base, "contact")}>Contact</a></div><div><strong>Services</strong>{site.services.slice(0, 4).map((service, index) => <a href={pageHref(base, `services/${serviceSlug(service, index)}`)} key={service.name}>{service.name}</a>)}</div><div><strong>Connect</strong>{profile.phone && <a href={`tel:${profile.phone.replace(/[^+\d]/g, "")}`}>{profile.phone}</a>}{profile.email && <a href={`mailto:${profile.email}`}>{profile.email}</a>}{profile.location && <span>{profile.location}</span>}</div><div className="waas-footer-bottom"><span>© {new Date().getFullYear()} {profile.businessName}</span>{site.media?.provider === "pexels" && <a href={site.media.attributionUrl || "https://www.pexels.com"} target="_blank" rel="noreferrer">Photography provided by Pexels</a>}<span>Designed for clarity, trust and action.</span></div></footer>;
}

function FloatingCall({ profile }) {
  const href = profile.phone ? `tel:${profile.phone.replace(/[^+\d]/g, "")}` : profile.email ? `mailto:${profile.email}` : "#contact";
  return <a className="waas-floating-call" href={href} aria-label={profile.phone ? `Call ${profile.businessName}` : `Contact ${profile.businessName}`} data-voice-agent-ready="true"><span>{profile.phone ? <Phone size={21} /> : <Mail size={21} />}</span><strong>{profile.phone ? "Call now" : "Enquire"}</strong></a>;
}

export function websiteRouteExists(project, route = []) {
  const path = routePath(route);
  if (!path.length || (["services", "about", "contact"].includes(path[0]) && path.length === 1)) return true;
  if (path[0] === "services" && path.length === 2) return project.siteSpec.services.some((service, index) => serviceSlug(service, index) === path[1]);
  return false;
}

export default function GeneratedWebsite({ project, theme, previewToken = null, route = [] }) {
  const path = routePath(route);
  const style = { "--site-primary": project.siteSpec.visualDirection.primaryColor, "--site-accent": project.siteSpec.visualDirection.accentColor };
  const serviceIndex = path[0] === "services" && path[1] ? project.siteSpec.services.findIndex((service, index) => serviceSlug(service, index) === path[1]) : -1;
  const content = serviceIndex >= 0
    ? <ServicePage project={project} theme={theme} previewToken={previewToken} service={project.siteSpec.services[serviceIndex]} serviceIndex={serviceIndex} />
    : path[0] === "services" ? <ServicesPage project={project} theme={theme} previewToken={previewToken} />
      : path[0] === "about" ? <AboutPage project={project} theme={theme} previewToken={previewToken} />
        : path[0] === "contact" ? <ContactPage project={project} theme={theme} previewToken={previewToken} />
          : <HomePage project={project} theme={theme} previewToken={previewToken} />;
  return <div className={previewToken ? "waas-preview-page" : ""} style={style}><div className={`waas-site waas-${theme}`}>{content}<Footer project={project} theme={theme} previewToken={previewToken} /><FloatingCall profile={project.businessProfile} /></div>{previewToken && <WebsiteSelectionBar token={previewToken} theme={theme} businessName={project.businessName} publishedTheme={project.selectedTheme} publishedUrl={project.publishedUrl} />}</div>;
}
