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
import Link from "next/link";
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

function siteExperience(site, profile) {
  return {
    signature: site.brand?.tagline,
    highlights: [profile.businessType, site.brand?.tagline, profile.location || profile.audience || profile.goal].filter(Boolean).slice(0, 3),
    galleryEyebrow: site.about?.eyebrow,
    galleryTitle: `Inside ${profile.businessName}`,
    galleryCopy: `A closer look at the environment, craft and customer experience behind ${profile.businessType.toLowerCase()}.`,
    processEyebrow: site.servicesIntro?.eyebrow,
    processTitle: `How ${profile.businessName} moves work forward`,
    processCopy: "Explore the options, share what you need and use the available contact path to discuss a suitable next step.",
    faqEyebrow: site.contact?.eyebrow,
    faqTitle: `Questions about ${profile.businessType}`,
    faqCopy: "Find practical information about the services, experience and ways to contact the business.",
    valuesEyebrow: site.about?.eyebrow,
    servicesProcessTitle: "What happens after you choose a service",
    aboutProcessTitle: "How the customer experience comes together",
    contactFaqTitle: "What to know before you get in touch",
    ...(site.experience || {}),
  };
}

function BrandMark({ name, style = "monogram" }) {
  return <span className={`waas-brand-mark style-${style}`} aria-hidden="true">
    <svg viewBox="0 0 48 48" focusable="false">
      <rect className="mark-frame" x="6" y="6" width="36" height="36" rx="10" />
      <circle className="mark-orbit" cx="24" cy="24" r="16" />
      <path className="mark-stroke" d="M11 34 35 10M28 12h9v9M12 27v10h10" />
    </svg>
    <b>{initials(name)}</b>
  </span>;
}

function Brand({ profile, site, base }) {
  return <Link className="waas-logo" href={base} aria-label={`${profile.businessName} home`}>
    <BrandMark name={profile.businessName} style={site.brand?.logoStyle || "monogram"} />
    <span className="waas-brand-copy"><strong>{profile.businessName}</strong><small>{site.brand?.tagline}</small></span>
  </Link>;
}

function Photo({ photo, fallbackLabel, className = "", eager = false }) {
  if (!photo?.src) return <div className={`waas-photo-fallback ${className}`} aria-label={fallbackLabel}>
    <span className="waas-photo-orbit one" /><span className="waas-photo-orbit two" />
    <strong>{initials(fallbackLabel)}</strong><small><Sparkles size={14} /> Crafted for {fallbackLabel}</small>
  </div>;
  return <figure className={`waas-photo ${className}`}>
    <img src={photo.src} alt={photo.alt || fallbackLabel} loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"} referrerPolicy="no-referrer" />
  </figure>;
}

function Header({ project, theme, previewToken, active }) {
  const { businessProfile: profile, siteSpec: site } = project;
  const base = siteBase(project, theme, previewToken);
  const links = [["home", "Home", ""], ["services", "Services", "services"], ["about", "About", "about"], ["contact", "Contact", "contact"]];
  return <header className="waas-nav">
    <Brand profile={profile} site={site} base={base} />
    <nav aria-label="Primary navigation">{links.map(([key, label, path]) => <Link className={active === key ? "active" : ""} href={pageHref(base, path)} key={key}>{label}</Link>)}</nav>
    <a className="waas-nav-cta" href={contactHref(profile)}>{profile.bookingUrl ? <CalendarDays size={16} /> : <Phone size={16} />}{site.hero?.primaryCta || "Get in touch"}<ArrowUpRight size={15} /></a>
    <details className="waas-mobile-menu"><summary aria-label="Open navigation"><Menu size={21} /></summary><div>{links.map(([key, label, path]) => <Link className={active === key ? "active" : ""} href={pageHref(base, path)} key={key}>{label}<ArrowRight size={15} /></Link>)}<a href={contactHref(profile)}>Call or enquire<Phone size={15} /></a></div></details>
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
    <div className="waas-service-card-copy"><span className="waas-card-index">{String(index + 1).padStart(2, "0")}</span><small>{service.idealFor || "A focused solution for your next step"}</small><h3><Link href={pageHref(base, `services/${slug}`)}>{service.name}</Link></h3><p>{service.summary}</p><Link className="waas-text-link" href={pageHref(base, `services/${slug}`)}>{service.ctaLabel || "Explore service"}<ArrowUpRight size={16} /></Link></div>
  </article>;
}

function ContactCta({ profile, site }) {
  return <section className="waas-contact" id="contact"><div><p className="waas-eyebrow">{site.contact?.eyebrow || "Start a conversation"}</p><h2>{site.contact?.title}</h2><p>{site.contact?.copy}</p></div><div className="waas-contact-action"><a href={contactHref(profile)}>{site.contact?.ctaLabel || "Get in touch"}<ArrowRight size={18} /></a><ContactDetails profile={profile} /></div></section>;
}

function SectionHeading({ eyebrow, title, copy, compact = false }) {
  return <div className={`waas-section-heading${compact ? " compact" : ""}`}><p className="waas-eyebrow">{eyebrow}</p><h2>{title}</h2><p>{copy}</p></div>;
}

function HeroActions({ profile, site, base }) {
  return <div className="waas-actions"><a className="primary" href={contactHref(profile)}>{site.hero.primaryCta}<ArrowRight size={18} /></a><Link className="secondary" href={pageHref(base, "services")}>{site.hero.secondaryCta}<ArrowDownRight size={17} /></Link></div>;
}

function HighlightRail({ site, profile }) {
  const experience = siteExperience(site, profile);
  const highlights = experience.highlights;
  return <section className="waas-highlight-rail" aria-label="Business highlights">{highlights.map((highlight, index) => <span key={`${highlight}-${index}`}><i>{String(index + 1).padStart(2, "0")}</i><strong>{highlight}</strong></span>)}</section>;
}

function Gallery({ site, profile }) {
  const gallery = site.media?.gallery || [];
  if (!gallery.length) return null;
  const experience = siteExperience(site, profile);
  return <section className="waas-gallery-section"><SectionHeading compact eyebrow={experience.galleryEyebrow} title={experience.galleryTitle} copy={experience.galleryCopy} /><div className="waas-gallery">{gallery.map((photo, index) => <Photo key={photo.id || photo.src} photo={photo} fallbackLabel={`${profile.businessName} ${index + 1}`} className={`item-${index + 1}`} />)}</div></section>;
}

function StorySection({ site, profile, base, variant = "" }) {
  return <section className={`waas-section waas-story ${variant}`}><div className="waas-story-media"><Photo photo={site.media?.story || site.media?.gallery?.[0]} fallbackLabel={profile.businessType} /><span>{site.brand.logoConcept}</span></div><div className="waas-story-copy"><p className="waas-eyebrow">{site.about.eyebrow}</p><h2>{site.about.title}</h2><p>{site.about.body}</p><div className="waas-benefit-grid">{site.benefits.map((item) => <article key={item.title}><BadgeCheck size={20} /><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div><Link className="waas-text-link" href={pageHref(base, "about")}>About {profile.businessName}<ArrowRight size={16} /></Link></div></section>;
}

function ProcessSection({ site, profile, className = "" }) {
  const experience = siteExperience(site, profile);
  return <section className={`waas-section waas-process ${className}`}><SectionHeading eyebrow={experience.processEyebrow} title={experience.processTitle} copy={experience.processCopy} /><div className="waas-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div></section>;
}

function FaqSection({ site, profile, className = "" }) {
  const experience = siteExperience(site, profile);
  return <section className={`waas-section waas-faq ${className}`}><SectionHeading eyebrow={experience.faqEyebrow} title={experience.faqTitle} copy={experience.faqCopy} /><FaqList items={site.faq} /></section>;
}

function EditorialServices({ site, base }) {
  return <section className="waas-section waas-services waas-editorial-services"><SectionHeading eyebrow={site.servicesIntro.eyebrow} title={site.servicesIntro.title} copy={site.servicesIntro.copy} /><div className="waas-editorial-service-list">{site.services.slice(0, 6).map((service, index) => {
    const slug = serviceSlug(service, index);
    return <article key={service.name}><Photo photo={site.media?.services?.[slug]} fallbackLabel={service.name} /><div><span>{String(index + 1).padStart(2, "0")}</span><small>{service.idealFor}</small><h3><Link href={pageHref(base, `services/${slug}`)}>{service.name}</Link></h3><p>{service.summary}</p><Link className="waas-text-link" href={pageHref(base, `services/${slug}`)}>{service.ctaLabel}<ArrowUpRight size={16} /></Link></div></article>;
  })}</div>{site.services.length > 6 && <Link className="waas-all-services" href={pageHref(base, "services")}>Explore all {site.services.length} services<ArrowRight size={18} /></Link>}</section>;
}

function AuraServices({ site, base }) {
  return <section className="waas-section waas-services waas-aura-services"><SectionHeading eyebrow={site.servicesIntro.eyebrow} title={site.servicesIntro.title} copy={site.servicesIntro.copy} /><div className="waas-aura-service-list">{site.services.slice(0, 5).map((service, index) => {
    const slug = serviceSlug(service, index);
    return <article key={service.name}><div><span>{String(index + 1).padStart(2, "0")}</span><h3>{service.name}</h3><p>{service.summary}</p><Link className="waas-text-link" href={pageHref(base, `services/${slug}`)}>{service.ctaLabel}<ArrowRight size={16} /></Link></div><Photo photo={site.media?.services?.[slug]} fallbackLabel={service.name} /></article>;
  })}</div>{site.services.length > 5 && <Link className="waas-all-services" href={pageHref(base, "services")}>See every service<ArrowRight size={18} /></Link>}</section>;
}

function EditorialHome({ project, base }) {
  const { businessProfile: profile, siteSpec: site } = project;
  const experience = siteExperience(site, profile);
  return <main className="waas-home waas-home-editorial"><section className="waas-hero waas-editorial-hero"><div className="waas-hero-copy"><p className="waas-eyebrow"><Sparkles size={14} />{site.hero.eyebrow}</p><h1>{site.hero.headline}</h1><p className="waas-lead">{site.hero.subheadline}</p><HeroActions profile={profile} site={site} base={base} /></div><div className="waas-hero-media"><Photo photo={site.media?.hero} fallbackLabel={profile.businessType} eager /><div className="waas-hero-note"><span>{experience.signature || profile.businessType}</span><strong>{site.brand.tagline}</strong></div></div></section><HighlightRail site={site} profile={profile} /><EditorialServices site={site} base={base} /><StorySection site={site} profile={profile} base={base} variant="waas-story-editorial" /><Gallery site={site} profile={profile} /><ProcessSection site={site} profile={profile} /><FaqSection site={site} profile={profile} /><ContactCta profile={profile} site={site} /></main>;
}

function MomentumHome({ project, base }) {
  const { businessProfile: profile, siteSpec: site } = project;
  const experience = siteExperience(site, profile);
  return <main className="waas-home waas-home-momentum"><section className="waas-momentum-hero"><div className="waas-momentum-backdrop"><Photo photo={site.media?.hero} fallbackLabel={profile.businessType} eager /></div><div className="waas-momentum-hero-copy"><p className="waas-eyebrow"><Sparkles size={14} />{site.hero.eyebrow}</p><h1>{site.hero.headline}</h1><p className="waas-lead">{site.hero.subheadline}</p><HeroActions profile={profile} site={site} base={base} /></div><span className="waas-momentum-signature">{experience.signature}</span></section><HighlightRail site={site} profile={profile} /><ProcessSection site={site} profile={profile} className="waas-process-momentum" /><section className="waas-section waas-services waas-momentum-services"><SectionHeading eyebrow={site.servicesIntro.eyebrow} title={site.servicesIntro.title} copy={site.servicesIntro.copy} /><div className="waas-service-grid waas-bento-grid">{site.services.slice(0, 6).map((service, index) => <ServiceCard key={service.name} service={service} index={index} base={base} photo={site.media?.services?.[serviceSlug(service, index)]} />)}</div>{site.services.length > 6 && <Link className="waas-all-services" href={pageHref(base, "services")}>Explore all {site.services.length} services<ArrowRight size={18} /></Link>}</section><Gallery site={site} profile={profile} /><StorySection site={site} profile={profile} base={base} variant="waas-story-momentum" /><FaqSection site={site} profile={profile} className="waas-faq-momentum" /><ContactCta profile={profile} site={site} /></main>;
}

function AuraHome({ project, base }) {
  const { businessProfile: profile, siteSpec: site } = project;
  const experience = siteExperience(site, profile);
  return <main className="waas-home waas-home-aura"><section className="waas-hero waas-aura-hero"><div className="waas-hero-copy"><p className="waas-eyebrow"><Sparkles size={14} />{site.hero.eyebrow}</p><h1>{site.hero.headline}</h1><p className="waas-lead">{site.hero.subheadline}</p><HeroActions profile={profile} site={site} base={base} /></div><div className="waas-hero-media"><Photo photo={site.media?.hero} fallbackLabel={profile.businessType} eager /><div className="waas-aura-float one">{experience.highlights[0]}</div><div className="waas-aura-float two">{experience.highlights[1] || site.brand.tagline}</div></div></section><section className="waas-aura-benefits">{site.benefits.slice(0, 3).map((item) => <article key={item.title}><BadgeCheck size={19} /><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</section><AuraServices site={site} base={base} /><StorySection site={site} profile={profile} base={base} variant="waas-story-aura" /><Gallery site={site} profile={profile} /><FaqSection site={site} profile={profile} className="waas-faq-aura" /><ProcessSection site={site} profile={profile} className="waas-process-aura" /><ContactCta profile={profile} site={site} /></main>;
}

function HomePage({ project, theme, previewToken }) {
  const base = siteBase(project, theme, previewToken);
  const Home = theme === "momentum" ? MomentumHome : theme === "aura" ? AuraHome : EditorialHome;
  return <><Header project={project} theme={theme} previewToken={previewToken} active="home" /><Home project={project} base={base} /></>;
}

function PageHero({ eyebrow, title, copy, photo, profile }) {
  return <section className="waas-page-hero"><div><p className="waas-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div><Photo photo={photo} fallbackLabel={profile.businessType} eager /></section>;
}

function ServicesPage({ project, theme, previewToken }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const base = siteBase(project, theme, previewToken);
  const experience = siteExperience(site, profile);
  return <><Header project={project} theme={theme} previewToken={previewToken} active="services" /><main><PageHero eyebrow={site.servicesIntro.eyebrow} title={site.servicesIntro.title} copy={site.servicesIntro.copy} photo={site.media?.hero} profile={profile} /><section className="waas-section waas-services-page"><div className="waas-service-grid">{site.services.map((service, index) => <ServiceCard key={service.name} service={service} index={index} base={base} photo={site.media?.services?.[serviceSlug(service, index)]} />)}</div></section><section className="waas-section waas-process"><SectionHeading eyebrow={experience.processEyebrow} title={experience.servicesProcessTitle} copy={experience.processCopy} /><div className="waas-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div></section><ContactCta profile={profile} site={site} /></main></>;
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
  return <><Header project={project} theme={theme} previewToken={previewToken} active="services" /><main><section className="waas-service-hero"><div className="waas-service-hero-copy"><Link href={pageHref(base, "services")}><ArrowLeft size={15} /> All services</Link><p className="waas-eyebrow">{profile.businessType}</p><h1>{service.pageHeadline || service.name}</h1><p>{service.pageIntro || service.summary}</p><div className="waas-actions"><a className="primary" href={contactHref(profile)}>{service.ctaLabel || site.hero.primaryCta}<ArrowRight size={17} /></a>{profile.phone && <a className="secondary" href={`tel:${profile.phone.replace(/[^+\d]/g, "")}`}><Phone size={16} /> Call {profile.businessName}</a>}</div></div><Photo photo={photo} fallbackLabel={service.name} eager /></section><section className="waas-service-band"><span>Designed for</span><strong>{service.idealFor || `People exploring ${service.name}`}</strong></section><section className="waas-section waas-service-detail"><div className="waas-service-aside"><p className="waas-eyebrow">At a glance</p><h2>{service.name}</h2><ul>{service.details.map((detail) => <li key={detail}><Check size={16} />{detail}</li>)}</ul></div><div className="waas-service-sections">{pageSections.map((section, index) => <article key={section.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h2>{section.title}</h2><p>{section.copy}</p></div></article>)}</div></section>{related.length > 0 && <section className="waas-section waas-related"><div className="waas-section-heading compact"><p className="waas-eyebrow">Explore more</p><h2>Related ways we can help.</h2><p>Continue exploring the services that may support your next step.</p></div><div className="waas-service-grid">{related.map((item) => { const index = site.services.indexOf(item); return <ServiceCard key={item.name} service={item} index={index} base={base} photo={site.media?.services?.[serviceSlug(item, index)]} />; })}</div></section>}<ContactCta profile={profile} site={site} /></main></>;
}

function AboutPage({ project, theme, previewToken }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const experience = siteExperience(site, profile);
  return <><Header project={project} theme={theme} previewToken={previewToken} active="about" /><main><PageHero eyebrow={site.about.eyebrow} title={site.about.title} copy={site.about.body} photo={site.media?.story || site.media?.hero} profile={profile} /><section className="waas-section waas-about-page"><div><p className="waas-eyebrow">{experience.valuesEyebrow}</p><h2>{site.brand.positioning}</h2></div><div className="waas-benefit-grid">{site.benefits.map((item) => <article key={item.title}><BadgeCheck size={21} /><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></section><Gallery site={site} profile={profile} /><section className="waas-section waas-process"><SectionHeading eyebrow={experience.processEyebrow} title={experience.aboutProcessTitle} copy={experience.processCopy} /><div className="waas-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div></section><ContactCta profile={profile} site={site} /></main></>;
}

function ContactPage({ project, theme, previewToken }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const experience = siteExperience(site, profile);
  return <><Header project={project} theme={theme} previewToken={previewToken} active="contact" /><main><section className="waas-contact-page"><div className="waas-contact-page-copy"><p className="waas-eyebrow">{site.contact.eyebrow}</p><h1>{site.contact.title}</h1><p>{site.contact.copy}</p><ContactDetails profile={profile} /><div className="waas-actions"><a className="primary" href={contactHref(profile)}>{site.contact.ctaLabel}<ArrowRight size={17} /></a>{profile.email && <a className="secondary" href={`mailto:${profile.email}`}><Mail size={16} /> Email us</a>}</div></div><Photo photo={site.media?.hero} fallbackLabel={profile.businessType} eager /></section><section className="waas-section waas-contact-faq"><SectionHeading eyebrow={experience.faqEyebrow} title={experience.contactFaqTitle} copy={experience.faqCopy} /><FaqList items={site.faq} /></section></main></>;
}

function photoCredits(site) {
  const media = site.media || {};
  const photos = [media.hero, media.story, ...(media.gallery || []), ...Object.values(media.services || {})].filter((photo) => photo?.provider === "pexels");
  const seen = new Set();
  return photos.filter((photo) => {
    const key = photo.sourceUrl || `${photo.photographer}-${photo.src}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function Footer({ project, theme, previewToken }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const base = siteBase(project, theme, previewToken);
  const credits = photoCredits(site);
  const experience = siteExperience(site, profile);
  return <footer className="waas-footer"><div className="waas-footer-brand"><Brand profile={profile} site={site} base={base} /><p>{site.brand.positioning}</p></div><div><strong>Explore</strong><Link href={base}>Home</Link><Link href={pageHref(base, "services")}>Services</Link><Link href={pageHref(base, "about")}>About</Link><Link href={pageHref(base, "contact")}>Contact</Link></div><div><strong>Services</strong>{site.services.slice(0, 4).map((service, index) => <Link href={pageHref(base, `services/${serviceSlug(service, index)}`)} key={service.name}>{service.name}</Link>)}</div><div><strong>Connect</strong>{profile.phone && <a href={`tel:${profile.phone.replace(/[^+\d]/g, "")}`}>{profile.phone}</a>}{profile.email && <a href={`mailto:${profile.email}`}>{profile.email}</a>}{profile.location && <span>{profile.location}</span>}</div><div className="waas-footer-bottom"><span>© {new Date().getFullYear()} {profile.businessName}</span>{credits.length > 0 && <details className="waas-photo-credits"><summary>Photography credits</summary><div>{credits.map((photo) => photo.sourceUrl ? <a href={photo.sourceUrl} target="_blank" rel="noreferrer" key={photo.sourceUrl}>{photo.photographer || "Photo"} / Pexels</a> : <span key={photo.src}>{photo.photographer || "Photo"} / Pexels</span>)}</div></details>}<span>{experience.signature}</span></div></footer>;
}

export function websiteRouteExists(project, route = []) {
  const path = routePath(route);
  if (!path.length || (["services", "about", "contact"].includes(path[0]) && path.length === 1)) return true;
  if (path[0] === "services" && path.length === 2) return project.siteSpec.services.some((service, index) => serviceSlug(service, index) === path[1]);
  return false;
}

function readableTextColor(hex, light = "#ffffff", dark = "#111815") {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return light;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return ((red * 299) + (green * 587) + (blue * 114)) / 1000 >= 150 ? dark : light;
}

export default function GeneratedWebsite({ project, theme, previewToken = null, route = [] }) {
  const path = routePath(route);
  const primary = project.siteSpec.visualDirection.primaryColor;
  const accent = project.siteSpec.visualDirection.accentColor;
  const style = { "--site-primary": primary, "--site-accent": accent, "--site-on-primary": readableTextColor(primary), "--site-on-accent": readableTextColor(accent) };
  const serviceIndex = path[0] === "services" && path[1] ? project.siteSpec.services.findIndex((service, index) => serviceSlug(service, index) === path[1]) : -1;
  const content = serviceIndex >= 0
    ? <ServicePage project={project} theme={theme} previewToken={previewToken} service={project.siteSpec.services[serviceIndex]} serviceIndex={serviceIndex} />
    : path[0] === "services" ? <ServicesPage project={project} theme={theme} previewToken={previewToken} />
      : path[0] === "about" ? <AboutPage project={project} theme={theme} previewToken={previewToken} />
        : path[0] === "contact" ? <ContactPage project={project} theme={theme} previewToken={previewToken} />
          : <HomePage project={project} theme={theme} previewToken={previewToken} />;
  return <div className={previewToken ? "waas-preview-page" : ""} style={style}><div className={`waas-site waas-${theme}`}>{content}<Footer project={project} theme={theme} previewToken={previewToken} /></div>{previewToken && <WebsiteSelectionBar token={previewToken} theme={theme} businessName={project.businessName} publishedTheme={project.selectedTheme} publishedUrl={project.publishedUrl} />}</div>;
}
