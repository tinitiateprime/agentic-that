"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import ProductShell from "./ProductShell";
import { serviceDetailHref } from "./product-catalog";
import { useProductStatus } from "./use-product-status";
import styles from "./marketplace.module.css";

const WhatsAppServiceDetail = dynamic(() => import("./WhatsAppServiceDetail"));
const PremiumServiceDetail = dynamic(() => import("./PremiumServiceDetail"));

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
      <i />
      <span>{status.label}{status.detail ? <small>{status.detail}</small> : null}</span>
    </span>
  );
}

function StandardServiceDetail({ user, service, category, related }) {
  const { statusFor } = useProductStatus();
  const status = statusFor(service);
  const action = actionFor(service, status);
  const secondaryAction = secondaryActionFor(service);

  return (
    <ProductShell user={user} active="apps">
      <main className={styles.detailMain} style={{ "--service-accent": service.accent, "--service-tint": service.tint }}>
        <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
          <Link href="/apps">Apps</Link><ChevronRight size={15} /><Link href={`/apps#${category.id}`}>{category.label}</Link><ChevronRight size={15} /><span>{service.name}</span>
        </nav>

        <section className={styles.detailHero}>
          <div className={styles.detailHeroMain}>
            <Link className={styles.detailBack} href="/apps"><ArrowLeft size={17} />Back to catalogue</Link>
            <div className={styles.detailIdentity}>
              <span className={styles.detailLogo}><img src={service.logo} alt="" /></span>
              <div><span>{category.label}</span><small>{service.provider}</small></div>
            </div>
            <h1>{service.name}</h1>
            <h2>{service.promise}</h2>
            <p>{service.shortDescription}</p>
            <div className={styles.detailActions}>
              {action.disabled ? (
                <button className={styles.primaryAction} type="button" disabled>{action.label}</button>
              ) : (
                <Link className={styles.primaryAction} href={action.href}>{action.label}<ArrowRight size={18} /></Link>
              )}
              <Link className={styles.secondaryAction} href={secondaryAction.href}>{secondaryAction.label}<ChevronRight size={17} /></Link>
            </div>
          </div>

          <aside className={styles.detailFacts}>
            <div className={styles.factStatus}><span>Workspace status</span><DetailStatus status={status} /></div>
            <dl>
              <div><dt>Workflow</dt><dd>{service.formatLabel || category.label}</dd></div>
              <div><dt>Account</dt><dd>{service.connectionKind === "none" ? "Not required" : service.availability === "live" ? "Required once" : "Not available yet"}</dd></div>
              <div><dt>Experience</dt><dd>{service.availability === "live" ? "Guided workspace" : "Product preview"}</dd></div>
            </dl>
            <div className={styles.factOutputs}>
              <span>Primary outputs</span>
              <ul>{service.outcomes.slice(0, 4).map((outcome) => <li key={outcome}><Check size={16} />{outcome}</li>)}</ul>
            </div>
          </aside>
        </section>

        <section className={styles.editorialSection}>
          <header className={styles.sectionIntroduction}>
            <span>What it handles</span>
            <h2>{service.detailHeading || "A focused workspace for the work that matters"}</h2>
            <p>{service.detailDescription || "Use the service without learning the platform machinery behind it. The important controls and results stay visible; implementation details stay out of the way."}</p>
          </header>
          <div className={styles.capabilityList}>
            {service.capabilities.map((capability, index) => (
              <article key={capability.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{capability.title}</h3><p>{capability.description}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className={`${styles.editorialSection} ${styles.workflowSection}`}>
          <header className={styles.sectionIntroduction}>
            <span>How it works</span>
            <h2>From setup to a useful result</h2>
            <p>Each stage has one clear job. AgenticThat keeps the next action obvious and returns you to the right workspace after setup.</p>
          </header>
          <ol className={styles.workflowList}>
            {service.steps.map((step, index) => (
              <li key={step.title}>
                <span>{index + 1}</span>
                <div><h3>{step.title}</h3><p>{step.description}</p></div>
                {index < service.steps.length - 1 && <ArrowRight size={19} />}
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.operatingDetails}>
          <article>
            <span className={styles.operatingIcon}><Check size={20} /></span>
            <h2>Before you start</h2>
            <ul>{service.requirements.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
          <article>
            <span className={styles.operatingIcon}><ArrowRight size={20} /></span>
            <h2>Where it fits</h2>
            <ul>{service.useCases.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
          <article>
            <span className={styles.operatingIcon}><ShieldCheck size={20} /></span>
            <h2>Security and control</h2>
            <p>{service.note}</p>
            <small><LockKeyhole size={16} />Connect only accounts you own or are authorized to manage.</small>
          </article>
        </section>

        <section className={styles.launchSection}>
          <div>
            <span>{status.state === "connected" ? "Connection ready" : service.availability === "live" ? "Ready to begin" : "Planned service"}</span>
            <h2>{status.state === "connected" ? `Continue in your ${service.platformName} workspace.` : service.availability === "live" ? `Put ${service.name} to work.` : `${service.name} is being prepared for a future release.`}</h2>
          </div>
          {action.disabled ? <button type="button" disabled>{action.label}</button> : <Link href={action.href}>{action.label}<ArrowRight size={18} /></Link>}
        </section>

        {related.length > 0 && (
          <section className={styles.relatedSection}>
            <header><span>Continue exploring</span><h2>More in {category.label}</h2></header>
            <div className={styles.relatedList}>{related.map((item) => (
              <Link href={serviceDetailHref(item)} key={item.slug}>
                <span className={styles.relatedLogo}><img src={item.logo} alt="" /></span>
                <span><strong>{item.name}</strong><small>{item.shortDescription}</small></span>
                <ChevronRight size={19} />
              </Link>
            ))}</div>
          </section>
        )}
      </main>
    </ProductShell>
  );
}

export default function ServiceDetail(props) {
  if (props.category?.id === "messaging" && props.service?.slug === "whatsapp") {
    return <WhatsAppServiceDetail user={props.user} service={props.service} category={props.category} />;
  }
  if (props.service?.availability === "live" && props.category?.id !== "engagement") {
    return <PremiumServiceDetail {...props} />;
  }
  return <StandardServiceDetail {...props} />;
}
