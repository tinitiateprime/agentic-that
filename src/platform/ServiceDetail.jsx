"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Info,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import ProductShell from "./ProductShell";
import { serviceDetailHref } from "./product-catalog";
import { useProductStatus } from "./use-product-status";
import styles from "./apps.module.css";

function actionFor(service, status) {
  if (status.state === "coming-soon") return { label: "Coming soon", disabled: true };
  if (status.state === "checking") return { label: "Checking connection", disabled: true };
  if (service.connectionKind === "none") return { label: "Start scraping", href: service.dashboardHref };
  if (status.state === "connected") return { label: `Open ${service.platformName} workspace`, href: service.dashboardHref };
  if (status.state === "continue") return { label: "Continue setup", href: service.configHref };
  return { label: `Connect ${service.platformName}`, href: service.configHref };
}

function secondaryActionFor(service) {
  if (service.availability !== "live") return { label: "Explore available apps", href: "/apps" };
  if (service.connectionKind === "none") return { label: "Browse all apps", href: "/apps" };
  return { label: "Manage connections", href: "/config-manager" };
}

function DetailStatus({ status }) {
  return (
    <span className={`${styles.detailStatus} ${styles[`status_${status.state}`] || ""}`}>
      <i />{status.label}{status.detail ? <small>{status.detail}</small> : null}
    </span>
  );
}

export default function ServiceDetail({ user, service, category, related }) {
  const { statusFor } = useProductStatus();
  const status = statusFor(service);
  const action = actionFor(service, status);
  const secondaryAction = secondaryActionFor(service);

  return (
    <ProductShell user={user} active="apps">
      <main className={styles.detailMain} style={{ "--service-accent": service.accent, "--service-tint": service.tint }}>
        <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
          <Link href="/apps">Apps</Link><ChevronRight size={14} /><Link href={`/apps#${category.id}`}>{category.label}</Link><ChevronRight size={14} /><span>{service.name}</span>
        </nav>

        <section className={styles.detailHero}>
          <div className={styles.detailHeroMain}>
            <Link className={styles.detailBack} href="/apps"><ArrowLeft size={16} />All apps</Link>
            <div className={styles.detailIdentity}>
              <span className={styles.detailLogo}><img src={service.logo} alt="" /></span>
              <div><small>{service.provider}</small><h1>{service.name}</h1><p>{service.formatLabel || category.label}</p></div>
            </div>
            <h2>{service.promise}</h2>
            <p className={styles.detailLead}>{service.shortDescription}</p>
            <div className={styles.detailActions}>
              {action.disabled ? (
                <button className={styles.primaryAction} type="button" disabled>{action.label}</button>
              ) : (
                <Link className={styles.primaryAction} href={action.href}>{action.label}<ArrowRight size={17} /></Link>
              )}
              <Link className={styles.secondaryAction} href={secondaryAction.href}>{secondaryAction.label}<ChevronRight size={15} /></Link>
            </div>
          </div>

          <aside className={styles.atGlance}>
            <div className={styles.glanceHead}><span>At a glance</span><DetailStatus status={status} /></div>
            <div className={styles.glanceRows}>
              <span><CircleDot size={16} /><small>Category</small><strong>{category.label}</strong></span>
              <span><Sparkles size={16} /><small>Experience</small><strong>{service.availability === "live" ? "Guided workflow" : "Product preview"}</strong></span>
              <span><LockKeyhole size={16} /><small>Account</small><strong>{service.connectionKind === "none" ? "No connection needed" : service.availability === "live" ? "Connection required" : "Not available yet"}</strong></span>
            </div>
            <div className={styles.resultPreview}>
              <small>What you get</small>
              {service.outcomes.slice(0, 4).map((outcome) => <span key={outcome}><Check size={14} />{outcome}</span>)}
            </div>
          </aside>
        </section>

        <section className={styles.detailSection}>
          <header className={styles.detailSectionHeader}><div><span>Built for useful work</span><h2>Everything you need, without the operational clutter</h2></div><p>AgenticThat keeps the workflow focused while the service handles the platform-specific details underneath.</p></header>
          <div className={styles.capabilityGrid}>
            {service.capabilities.map((capability, index) => (
              <article key={capability.title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{capability.title}</h3><p>{capability.description}</p></article>
            ))}
          </div>
        </section>

        <section className={styles.workflowPanel}>
          <header><span>How it works</span><h2>From first click to useful outcome</h2></header>
          <div className={styles.workflowSteps}>
            {service.steps.map((step, index) => (
              <article key={step.title}><b>{index + 1}</b><div><h3>{step.title}</h3><p>{step.description}</p></div>{index < service.steps.length - 1 && <ArrowRight size={18} />}</article>
            ))}
          </div>
        </section>

        <section className={styles.detailInfoGrid}>
          <article className={styles.infoCard}>
            <header><CheckCircle2 size={20} /><div><span>Before you start</span><h2>What you need</h2></div></header>
            <div className={styles.checkList}>{service.requirements.map((item) => <span key={item}><Check size={15} />{item}</span>)}</div>
          </article>
          <article className={styles.infoCard}>
            <header><Sparkles size={20} /><div><span>Made for real work</span><h2>Common uses</h2></div></header>
            <div className={styles.useCaseList}>{service.useCases.map((item) => <span key={item}>{item}</span>)}</div>
          </article>
          <article className={`${styles.infoCard} ${styles.trustCard}`}>
            <header><ShieldCheck size={20} /><div><span>Clear by design</span><h2>Security and control</h2></div></header>
            <p>{service.note}</p>
            <span className={styles.trustLine}><Info size={15} />Only connect accounts you own or are authorized to manage.</span>
          </article>
        </section>

        <section className={styles.detailCta}>
          <div><span>{status.state === "connected" ? "Your connection is ready" : service.availability === "live" ? "Ready when you are" : "On the product roadmap"}</span><h2>{status.state === "connected" ? `Continue in the ${service.platformName} workspace.` : service.availability === "live" ? `Put ${service.name} to work.` : `Follow the ${service.name} product direction.`}</h2></div>
          {action.disabled ? <button type="button" disabled>{action.label}</button> : <Link href={action.href}>{action.label}<ArrowRight size={17} /></Link>}
        </section>

        {related.length > 0 && (
          <section className={styles.relatedSection}>
            <header><span>Also in {category.label}</span><h2>Explore related apps</h2></header>
            <div>{related.map((item) => (
              <Link href={serviceDetailHref(item)} key={item.slug} style={{ "--service-accent": item.accent, "--service-tint": item.tint }}>
                <span><img src={item.logo} alt="" /></span><div><strong>{item.name}</strong><small>{item.shortDescription}</small></div><ChevronRight size={17} />
              </Link>
            ))}</div>
          </section>
        )}
      </main>
    </ProductShell>
  );
}
