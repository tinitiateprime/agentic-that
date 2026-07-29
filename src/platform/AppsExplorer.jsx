"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronRight, Search, Sparkles, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { productCategories, productServices, serviceDetailHref } from "./product-catalog";
import { useProductStatus } from "./use-product-status";
import ProductShell from "./ProductShell";
import styles from "./apps.module.css";

function StatusBadge({ status }) {
  return (
    <span className={`${styles.statusBadge} ${styles[`status_${status.state}`] || ""}`}>
      <i />
      {status.label}
    </span>
  );
}

function ServiceCard({ service, status }) {
  return (
    <Link
      className={styles.serviceCard}
      href={serviceDetailHref(service)}
      style={{ "--service-accent": service.accent, "--service-tint": service.tint }}
    >
      <div className={styles.serviceCardTop}>
        <span className={styles.serviceLogo}><img src={service.logo} alt="" /></span>
        <StatusBadge status={status} />
      </div>
      <div className={styles.serviceIdentity}>
        <h3>{service.name}</h3>
        <span>{service.provider}</span>
      </div>
      <p>{service.shortDescription}</p>
      <div className={styles.serviceCardFooter}>
        <span>{service.formatLabel || (service.availability === "live" ? "Guided workflow" : "Product preview")}</span>
        <strong>View details <ChevronRight size={15} /></strong>
      </div>
    </Link>
  );
}

export default function AppsExplorer({ user }) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const { statusFor } = useProductStatus();

  const normalizedQuery = query.trim().toLowerCase();
  const visibleCategories = useMemo(() => productCategories.map((category) => {
    const services = productServices.filter((service) => {
      if (service.category !== category.id) return false;
      if (activeCategory !== "all" && activeCategory !== category.id) return false;
      if (!normalizedQuery) return true;
      return [service.name, service.platformName, service.shortDescription, service.provider]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
    return { ...category, services };
  }).filter((category) => category.services.length), [activeCategory, normalizedQuery]);

  const statusEntries = productServices
    .filter((service) => service.availability === "live" && service.connectionKind !== "none")
    .map((service) => ({ service, status: statusFor(service) }));
  const connectedCount = statusEntries.filter(({ status }) => status.state === "connected").length;
  const nextSetup = statusEntries.find(({ status }) => status.state === "continue")
    || statusEntries.find(({ status }) => status.state === "setup");

  return (
    <ProductShell user={user} active="apps">
      <main className={styles.appsMain}>
        <section className={styles.appsHero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}><Sparkles size={14} /> Your automation workspace</span>
            <h1>What would you like to put to work?</h1>
            <p>Choose a service, understand it in a minute, and take the right next step. AgenticThat handles the product complexity behind a clear workflow.</p>
          </div>
          <div className={styles.workspaceSummary}>
            <span><CheckCircle2 size={18} /><strong>{connectedCount}</strong><small>connected {connectedCount === 1 ? "service" : "services"}</small></span>
            <span><Wrench size={18} /><strong>{productServices.filter((service) => service.availability === "live").length}</strong><small>available now</small></span>
          </div>
        </section>

        {nextSetup && (
          <Link className={styles.continueBanner} href={serviceDetailHref(nextSetup.service)} style={{ "--service-accent": nextSetup.service.accent, "--service-tint": nextSetup.service.tint }}>
            <span className={styles.continueIcon}><img src={nextSetup.service.logo} alt="" /></span>
            <span><small>{nextSetup.status.state === "continue" ? "Continue where you stopped" : "Recommended next step"}</small><strong>{nextSetup.status.state === "continue" ? `Finish setting up ${nextSetup.service.platformName}` : `Connect ${nextSetup.service.platformName}`}</strong></span>
            <p>{nextSetup.status.state === "continue" ? "Your connection is started but needs one more step before the workspace is ready." : "Connect the account once, then AgenticThat will take you directly to its working dashboard."}</p>
            <b>{nextSetup.status.state === "continue" ? "Continue setup" : "View setup"}<ArrowRight size={16} /></b>
          </Link>
        )}

        <section className={styles.catalogControls} aria-label="Find an app">
          <label className={styles.catalogSearch}>
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps and outcomes" aria-label="Search apps" />
            {query && <button type="button" onClick={() => setQuery("")}>Clear</button>}
          </label>
          <div className={styles.categoryTabs} role="tablist" aria-label="App categories">
            <button className={activeCategory === "all" ? styles.categoryActive : ""} type="button" onClick={() => setActiveCategory("all")}>All apps</button>
            {productCategories.map((category) => (
              <button className={activeCategory === category.id ? styles.categoryActive : ""} type="button" onClick={() => setActiveCategory(category.id)} key={category.id}>{category.label}</button>
            ))}
          </div>
        </section>

        <div className={styles.categoryStack}>
          {visibleCategories.map((category) => (
            <section className={styles.categorySection} id={category.id} key={category.id}>
              <header className={styles.categoryHeader}>
                <div><span>{category.eyebrow}</span><h2>{category.label}</h2></div>
                <p>{category.description}</p>
                <small>{category.services.length} {category.services.length === 1 ? "app" : "apps"}</small>
              </header>
              <div className={styles.serviceGrid}>
                {category.services.map((service) => <ServiceCard service={service} status={statusFor(service)} key={`${service.category}-${service.slug}`} />)}
              </div>
            </section>
          ))}
        </div>

        {visibleCategories.length === 0 && (
          <section className={styles.noResults}>
            <Search size={24} />
            <h2>No apps match “{query}”</h2>
            <p>Try a platform name such as WhatsApp, Instagram, or YouTube.</p>
            <button type="button" onClick={() => { setQuery(""); setActiveCategory("all"); }}>Show all apps</button>
          </section>
        )}
      </main>
    </ProductShell>
  );
}
