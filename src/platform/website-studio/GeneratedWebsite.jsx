import {
  ArrowDownRight,
  ArrowRight,
  BadgeCheck,
  Check,
  Clock3,
  Mail,
  MapPin,
  Phone,
  Sparkles,
} from "lucide-react";
import WebsiteSelectionBar from "./WebsiteSelectionBar";
import "./generated-website.css";

function contactHref(profile) {
  if (profile.bookingUrl) return profile.bookingUrl;
  if (profile.phone) return `tel:${profile.phone.replace(/[^+\d]/g, "")}`;
  if (profile.email) return `mailto:${profile.email}`;
  return "#contact";
}

function ContactDetails({ profile }) {
  const rows = [
    profile.location && { icon: MapPin, label: profile.location },
    profile.phone && { icon: Phone, label: profile.phone, href: `tel:${profile.phone.replace(/[^+\d]/g, "")}` },
    profile.email && { icon: Mail, label: profile.email, href: `mailto:${profile.email}` },
    profile.hours && { icon: Clock3, label: profile.hours },
  ].filter(Boolean);
  return <div className="waas-contact-details">{rows.map((item) => {
    const Icon = item.icon;
    const content = <><Icon size={17} aria-hidden="true" /><span>{item.label}</span></>;
    return item.href ? <a href={item.href} key={item.label}>{content}</a> : <span key={item.label}>{content}</span>;
  })}</div>;
}

function FaqList({ items }) {
  return <div className="waas-faq-list">{items.map((item, index) => <details key={item.question} open={index === 0}>
    <summary><span>{String(index + 1).padStart(2, "0")}</span>{item.question}<i>+</i></summary>
    <p>{item.answer}</p>
  </details>)}</div>;
}

function BrandMark({ name }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <span className="waas-brand-mark">{letters || "AT"}</span>;
}

function HeroVisual({ profile, label }) {
  return <div className={`waas-hero-visual${profile.heroImage ? " has-image" : ""}`}>
    {profile.heroImage ? <img src={profile.heroImage} alt={`${profile.businessName} featured`} referrerPolicy="no-referrer" /> : <>
      <span className="waas-orbit one" />
      <span className="waas-orbit two" />
      <span className="waas-visual-monogram">{profile.businessName.charAt(0)}</span>
    </>}
    <small><Sparkles size={14} /> {label}</small>
  </div>;
}

function GalleryShowcase({ profile }) {
  if (!profile.galleryImages?.length) return null;
  return <section className="waas-gallery" aria-label={`${profile.businessName} gallery`}>
    {profile.galleryImages.map((source, index) => <figure key={source}>
      <img src={source} alt={`${profile.businessName} gallery ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" />
      <figcaption>{String(index + 1).padStart(2, "0")} · {profile.businessType}</figcaption>
    </figure>)}
  </section>;
}

function EditorialSite({ project }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const ctaHref = contactHref(profile);
  return <div className="waas-site waas-editorial">
    <header className="waas-nav"><a className="waas-logo" href="#top"><BrandMark name={profile.businessName} /><span>{profile.businessName}</span></a><nav><a href="#services">Services</a><a href="#about">About</a><a href="#process">Process</a><a href="#contact">Contact</a></nav><a className="waas-nav-cta" href={ctaHref}>{site.hero.primaryCta}<ArrowDownRight size={16} /></a></header>
    <main id="top">
      <section className="waas-hero"><div className="waas-hero-copy"><p className="waas-eyebrow">{site.hero.eyebrow}</p><h1>{site.hero.headline}</h1><p className="waas-lead">{site.hero.subheadline}</p><div className="waas-actions"><a className="primary" href={ctaHref}>{site.hero.primaryCta}<ArrowRight size={17} /></a><a className="secondary" href="#services">{site.hero.secondaryCta}</a></div></div><HeroVisual profile={profile} label={site.visualDirection.industryGroup} /><div className="waas-hero-index"><span>Independent concept</span><strong>01 / Editorial</strong></div></section>
      <section className="waas-statement"><span>{site.brand.tagline}</span><p>{site.brand.positioning}</p></section>
      <section className="waas-section waas-services" id="services"><div className="waas-section-heading"><p className="waas-eyebrow">{site.servicesIntro.eyebrow}</p><h2>{site.servicesIntro.title}</h2><p>{site.servicesIntro.copy}</p></div><div className="waas-service-list">{site.services.map((service, index) => <article key={service.name}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{service.name}</h3><p>{service.summary}</p><ul>{service.details.map((detail) => <li key={detail}>{detail}</li>)}</ul></div><a href={ctaHref} aria-label={`${service.ctaLabel}: ${service.name}`}><ArrowDownRight /></a></article>)}</div></section>
      <section className="waas-section waas-about" id="about"><div><p className="waas-eyebrow">{site.about.eyebrow}</p><h2>{site.about.title}</h2></div><div><p className="waas-about-copy">{site.about.body}</p><div className="waas-benefit-grid">{site.benefits.map((item) => <article key={item.title}><BadgeCheck size={19} /><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></div></section>
      <GalleryShowcase profile={profile} />
      <section className="waas-section waas-process" id="process"><div className="waas-section-heading"><p className="waas-eyebrow">The experience</p><h2>A clear path from interest to action.</h2></div><div className="waas-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></section>
      <section className="waas-section waas-faq"><div className="waas-section-heading"><p className="waas-eyebrow">Useful answers</p><h2>Before you get started.</h2></div><FaqList items={site.faq} /></section>
      <section className="waas-contact" id="contact"><p className="waas-eyebrow">{site.contact.eyebrow}</p><h2>{site.contact.title}</h2><p>{site.contact.copy}</p><a href={ctaHref}>{site.contact.ctaLabel}<ArrowRight size={18} /></a><ContactDetails profile={profile} /></section>
    </main>
    <footer><a className="waas-logo" href="#top"><BrandMark name={profile.businessName} /><span>{profile.businessName}</span></a><p>{site.brand.tagline}</p><span>© {new Date().getFullYear()} {profile.businessName}</span></footer>
  </div>;
}

function MomentumSite({ project }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const ctaHref = contactHref(profile);
  return <div className="waas-site waas-momentum">
    <div className="waas-ticker"><span>Built around your next move</span><i /> <span>{profile.businessType}</span><i /> <span>{profile.location || "Purposeful service"}</span></div>
    <header className="waas-nav"><a className="waas-logo" href="#top"><BrandMark name={profile.businessName} /><span>{profile.businessName}</span></a><nav><a href="#services">What we do</a><a href="#about">Why us</a><a href="#process">How it works</a></nav><a className="waas-nav-cta" href={ctaHref}>{site.hero.primaryCta}<ArrowRight size={16} /></a></header>
    <main id="top">
      <section className="waas-hero"><div className="waas-hero-copy"><p className="waas-eyebrow">{site.hero.eyebrow}</p><h1>{site.hero.headline}</h1><p className="waas-lead">{site.hero.subheadline}</p><div className="waas-actions"><a className="primary" href={ctaHref}>{site.hero.primaryCta}<ArrowRight size={18} /></a><a className="secondary" href="#services">Explore the work<ArrowDownRight size={17} /></a></div></div><HeroVisual profile={profile} label="Concept 02" /><div className="waas-side-note">{site.brand.tagline}</div></section>
      <section className="waas-impact-strip"><strong>{site.services.length}</strong><span>Focused offerings</span><p>{site.brand.positioning}</p><ArrowDownRight /></section>
      <section className="waas-section waas-services" id="services"><div className="waas-section-heading"><p className="waas-eyebrow">{site.servicesIntro.eyebrow}</p><h2>{site.servicesIntro.title}</h2><p>{site.servicesIntro.copy}</p></div><div className="waas-service-grid">{site.services.map((service, index) => <article key={service.name}><span>{String(index + 1).padStart(2, "0")}</span><ArrowDownRight className="waas-card-arrow" /><h3>{service.name}</h3><p>{service.summary}</p><ul>{service.details.map((detail) => <li key={detail}><Check size={14} />{detail}</li>)}</ul><a href={ctaHref}>{service.ctaLabel}<ArrowRight size={16} /></a></article>)}</div></section>
      <section className="waas-section waas-about" id="about"><div><p className="waas-eyebrow">{site.about.eyebrow}</p><h2>{site.about.title}</h2><p className="waas-about-copy">{site.about.body}</p></div><div className="waas-benefit-stack">{site.benefits.map((item, index) => <article key={item.title}><span>0{index + 1}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div></section>
      <GalleryShowcase profile={profile} />
      <section className="waas-section waas-process" id="process"><div className="waas-section-heading"><p className="waas-eyebrow">How it moves</p><h2>Simple steps. Clear momentum.</h2></div><div className="waas-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{index + 1}</span><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></section>
      <section className="waas-section waas-faq"><div className="waas-section-heading"><p className="waas-eyebrow">No guesswork</p><h2>Questions, answered.</h2></div><FaqList items={site.faq} /></section>
      <section className="waas-contact" id="contact"><span className="waas-contact-kicker">Ready when you are</span><h2>{site.contact.title}</h2><p>{site.contact.copy}</p><a href={ctaHref}>{site.contact.ctaLabel}<ArrowRight size={19} /></a><ContactDetails profile={profile} /></section>
    </main>
    <footer><strong>{profile.businessName}</strong><p>{site.brand.tagline}</p><span>© {new Date().getFullYear()}</span></footer>
  </div>;
}

function AuraSite({ project }) {
  const profile = project.businessProfile;
  const site = project.siteSpec;
  const ctaHref = contactHref(profile);
  return <div className="waas-site waas-aura">
    <header className="waas-nav"><a className="waas-logo" href="#top"><BrandMark name={profile.businessName} /><span>{profile.businessName}</span></a><nav><a href="#services">Services</a><a href="#about">Our approach</a><a href="#process">Journey</a><a href="#faq">FAQ</a></nav><a className="waas-nav-cta" href={ctaHref}>{site.hero.primaryCta}<ArrowRight size={15} /></a></header>
    <main id="top">
      <section className="waas-hero"><div className="waas-glow one" /><div className="waas-glow two" /><div className="waas-hero-copy"><p className="waas-eyebrow"><Sparkles size={14} />{site.hero.eyebrow}</p><h1>{site.hero.headline}</h1><p className="waas-lead">{site.hero.subheadline}</p><div className="waas-actions"><a className="primary" href={ctaHref}>{site.hero.primaryCta}<ArrowRight size={17} /></a><a className="secondary" href="#services">{site.hero.secondaryCta}</a></div></div><HeroVisual profile={profile} label={site.brand.tagline} /></section>
      <section className="waas-trust-row"><span><BadgeCheck size={18} /> Thoughtful by design</span><span><BadgeCheck size={18} /> Shaped for {profile.businessType}</span><span><BadgeCheck size={18} /> Clear next steps</span></section>
      <section className="waas-section waas-services" id="services"><div className="waas-section-heading"><p className="waas-eyebrow">{site.servicesIntro.eyebrow}</p><h2>{site.servicesIntro.title}</h2><p>{site.servicesIntro.copy}</p></div><div className="waas-service-grid">{site.services.map((service, index) => <article key={service.name}><div className="waas-service-icon"><Sparkles size={19} /></div><span>0{index + 1}</span><h3>{service.name}</h3><p>{service.summary}</p><ul>{service.details.map((detail) => <li key={detail}>{detail}</li>)}</ul><a href={ctaHref}>{service.ctaLabel}<ArrowRight size={15} /></a></article>)}</div></section>
      <section className="waas-section waas-about" id="about"><div className="waas-about-card"><p className="waas-eyebrow">{site.about.eyebrow}</p><h2>{site.about.title}</h2><p className="waas-about-copy">{site.about.body}</p></div><div className="waas-benefit-grid">{site.benefits.map((item) => <article key={item.title}><BadgeCheck size={20} /><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></section>
      <GalleryShowcase profile={profile} />
      <section className="waas-section waas-process" id="process"><div className="waas-section-heading"><p className="waas-eyebrow">Your journey</p><h2>Considered at every step.</h2></div><div className="waas-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div></section>
      <section className="waas-section waas-faq" id="faq"><div className="waas-section-heading"><p className="waas-eyebrow">Good to know</p><h2>Helpful answers, before we begin.</h2></div><FaqList items={site.faq} /></section>
      <section className="waas-contact" id="contact"><div><p className="waas-eyebrow">{site.contact.eyebrow}</p><h2>{site.contact.title}</h2><p>{site.contact.copy}</p></div><div><a href={ctaHref}>{site.contact.ctaLabel}<ArrowRight size={18} /></a><ContactDetails profile={profile} /></div></section>
    </main>
    <footer><a className="waas-logo" href="#top"><BrandMark name={profile.businessName} /><span>{profile.businessName}</span></a><p>{site.brand.tagline}</p><span>© {new Date().getFullYear()}</span></footer>
  </div>;
}

export default function GeneratedWebsite({ project, theme, previewToken = null }) {
  const style = {
    "--site-primary": project.siteSpec.visualDirection.primaryColor,
    "--site-accent": project.siteSpec.visualDirection.accentColor,
  };
  const content = theme === "momentum"
    ? <MomentumSite project={project} />
    : theme === "aura"
      ? <AuraSite project={project} />
      : <EditorialSite project={project} />;
  return <div className={previewToken ? "waas-preview-page" : ""} style={style}>
    {content}
    {previewToken && <WebsiteSelectionBar
      token={previewToken}
      theme={theme}
      businessName={project.businessName}
      publishedTheme={project.selectedTheme}
      publishedUrl={project.publishedUrl}
    />}
  </div>;
}
