"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronRight, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { productCategories, productServices, serviceDetailHref } from "./product-catalog";
import { useProductStatus } from "./use-product-status";
import ProductShell from "./ProductShell";
import styles from "./marketplace.module.css";

function ServiceStatus({ status }) {
  return (
    <span className={`${styles.serviceStatus} ${styles[`status_${status.state}`] || ""}`}>
      <i />
      {status.label}
    </span>
  );
}

function ServiceRow({ service, status }) {
  return (
    <Link
      className={styles.serviceRow}
      href={serviceDetailHref(service)}
      style={{ "--service-accent": service.accent, "--service-tint": service.tint }}
    >
      <span className={styles.serviceLogo}><img src={service.logo} alt="" /></span>
      <span className={styles.serviceContent}>
        <span className={styles.serviceHeading}>
          <strong>{service.name}</strong>
          <ServiceStatus status={status} />
        </span>
        <span className={styles.serviceDescription}>{service.shortDescription}</span>
        <span className={styles.serviceMeta}>
          <span>{service.formatLabel || (service.availability === "live" ? "Guided workflow" : "Product preview")}</span>
          <span>{service.connectionKind === "none" ? "No account connection" : service.availability === "live" ? "Account connection" : "Planned release"}</span>
        </span>
      </span>
      <span className={styles.serviceOpen}>Overview <ChevronRight size={18} /></span>
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
      return [service.name, service.platformName, service.shortDescription, service.formatLabel]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
    return { ...category, services };
  }).filter((category) => category.services.length), [activeCategory, normalizedQuery]);

  const liveServices = productServices.filter((service) => service.availability === "live");
  const connectionServices = liveServices.filter((service) => service.connectionKind !== "none");
  const statusEntries = connectionServices.map((service) => ({ service, status: statusFor(service) }));
  const connectedCount = statusEntries.filter(({ status }) => status.state === "connected").length;
  const nextSetup = statusEntries.find(({ status }) => status.state === "continue")
    || statusEntries.find(({ status }) => status.state === "setup");
  const visibleCount = visibleCategories.reduce((total, category) => total + category.services.length, 0);

  return (
    <ProductShell user={user} active="apps">
      <main className={styles.marketplaceMain}>
        <section className={styles.marketplaceIntro}>
          <div className={styles.introCopy}>
            <span className={styles.kicker}><Sparkles size={16} />App catalogue</span>
            <h1>Explore AgenticThat apps</h1>
            <p>Connect customer messaging, coordinate publishing, and collect public data from one operating workspace. Choose a service and move directly to the right setup or dashboard.</p>
          </div>
          <div className={styles.workspaceMetrics} aria-label="Workspace summary">
            <span><strong>{liveServices.length}</strong><small>services available now</small></span>
            <span><strong>{connectedCount}</strong><small>connected {connectedCount === 1 ? "service" : "services"}</small></span>
            <span><strong>{productCategories.length}</strong><small>workflow categories</small></span>
          </div>
        </section>

        {nextSetup && (
          <Link
            className={styles.nextAction}
            href={serviceDetailHref(nextSetup.service)}
            style={{ "--service-accent": nextSetup.service.accent, "--service-tint": nextSetup.service.tint }}
          >
            <span className={styles.nextActionLabel}>{nextSetup.status.state === "continue" ? "Continue setup" : "Recommended next step"}</span>
            <span className={styles.nextActionLogo}><img src={nextSetup.service.logo} alt="" /></span>
            <span className={styles.nextActionCopy}>
              <strong>{nextSetup.status.state === "continue" ? `Finish connecting ${nextSetup.service.platformName}` : `Connect ${nextSetup.service.platformName}`}</strong>
              <small>{nextSetup.status.state === "continue" ? "One more step will make the workspace ready." : "Connect the account once, then return directly to its working dashboard."}</small>
            </span>
            <span className={styles.nextActionLink}>Review setup <ArrowRight size={18} /></span>
          </Link>
        )}

        <section className={styles.catalogToolbar} aria-label="Find a service">
          <div>
            <span>App catalogue</span>
            <strong>{visibleCount} {visibleCount === 1 ? "service" : "services"}</strong>
          </div>
          <label className={styles.catalogSearch}>
            <Search size={20} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by app or outcome" aria-label="Search services" />
            {query && <button type="button" onClick={() => setQuery("")}>Clear</button>}
          </label>
        </section>

        <div className={styles.catalogLayout}>
          <aside className={styles.catalogSidebar} aria-label="Service categories">
            <span className={styles.sidebarLabel}>Browse by category</span>
            <button className={activeCategory === "all" ? styles.categoryActive : ""} type="button" onClick={() => setActiveCategory("all")}>
              <span>All services</span><small>{productServices.length}</small>
            </button>
            {productCategories.map((category) => (
              <button className={activeCategory === category.id ? styles.categoryActive : ""} type="button" onClick={() => setActiveCategory(category.id)} key={category.id}>
                <span>{category.label}</span><small>{productServices.filter((service) => service.category === category.id).length}</small>
              </button>
            ))}
          </aside>

          <div className={styles.catalogResults}>
            {visibleCategories.map((category) => (
              <section className={styles.categorySection} id={category.id} key={category.id}>
                <header className={styles.categoryHeader}>
                  <div><span>{category.eyebrow}</span><h2>{category.label}</h2></div>
                  <p>{category.description}</p>
                </header>
                <div className={styles.serviceList}>
                  {category.services.map((service) => <ServiceRow service={service} status={statusFor(service)} key={`${service.category}-${service.slug}`} />)}
                </div>
              </section>
            ))}

            {visibleCategories.length === 0 && (
              <section className={styles.noResults}>
                <Search size={26} />
                <h2>No services found</h2>
                <p>Try a platform name such as WhatsApp, Instagram, or YouTube.</p>
                <button type="button" onClick={() => { setQuery(""); setActiveCategory("all"); }}>Reset catalogue</button>
              </section>
            )}
          </div>
        </div>

        <footer className={styles.catalogFooter}>
          <CheckCircle2 size={20} />
          <p><strong>Built as one product.</strong> Connections, content, and working dashboards stay inside your AgenticThat workspace.</p>
        </footer>
      </main>
    </ProductShell>
  );
}
