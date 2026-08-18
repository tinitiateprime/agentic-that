"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Captions,
  Cloud,
  Eye,
  FileText,
  Hash,
  Heart,
  Image,
  KeyRound,
  Link as LinkIcon,
  Link2,
  MessageCircleMore,
  MessagesSquare,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Type,
  UserRound,
  Video,
} from "lucide-react";
import { useMemo, useState } from "react";
import { productCategories, productServices, serviceDetailHref } from "./product-catalog";
import { useProductStatus } from "./use-product-status";
import ProductShell from "./ProductShell";
import styles from "./app-store.module.css";
import { accessResourceForService, accessSatisfies } from "./access-catalog";

const categoryPresentation = {
  messaging: { icon: MessageCircleMore, accent: "#087360", tint: "#e6f4f0" },
  publishing: { icon: SquarePen, accent: "#7857e8", tint: "#f1edff" },
  scraping: { icon: Search, accent: "#2378d4", tint: "#eaf3ff" },
  seo: { icon: BarChart3, accent: "#a05f17", tint: "#fff5e8" },
  engagement: { icon: Heart, accent: "#e43f73", tint: "#fff0f5" },
};

const capabilityIcons = {
  "cloud api": Cloud,
  wati: Link2,
  coexistence: ShieldCheck,
  "direct messaging": Send,
  "account sessions": KeyRound,
  images: Image,
  video: Video,
  captions: Captions,
  "community text": MessagesSquare,
  text: Type,
  profile: UserRound,
  keyword: Search,
  keywords: Search,
  "search seo": Search,
  "site audit": ShieldCheck,
  priorities: BarChart3,
  "ai seo": Sparkles,
  visibility: Eye,
  mentions: MessageCircleMore,
  content: FileText,
  citations: LinkIcon,
  "social seo": Hash,
  profiles: UserRound,
  discovery: Search,
  hashtags: Hash,
  url: LinkIcon,
  "product preview": Eye,
};

function serviceCapabilities(service) {
  const label = service.formatLabel || (service.availability === "live" ? "Guided workflow" : "Product preview");
  return label.split("·").map((item) => item.trim()).filter(Boolean).slice(0, 3);
}

function ServiceStatus({ status }) {
  return (
    <span className={`${styles.serviceStatus} ${styles[`status_${status.state}`] || ""}`}>
      <i />{status.label}
    </span>
  );
}

function ServiceCard({ service, status, allowed }) {
  const capabilities = serviceCapabilities(service);

  return (
    <Link
      className={styles.serviceCard}
      href={allowed || service.availability !== "live" ? serviceDetailHref(service) : `/access-denied?resource=${encodeURIComponent(accessResourceForService(service))}`}
      aria-label={!allowed && service.availability === "live" ? `${service.name}: access required` : undefined}
      style={{ "--service-accent": service.accent, "--service-tint": service.tint }}
    >
      <div className={styles.serviceVisual} aria-hidden="true">
        <span className={styles.serviceLogo}><img src={service.logo} alt="" /></span>
      </div>
      <div className={styles.cardContent}>
        <div className={styles.cardHeader}>
          <div className={styles.serviceIdentity}>
            <h3>{service.name}</h3>
          </div>
          <ServiceStatus status={!allowed && service.availability === "live" ? { state: "locked", label: "Access required" } : status} />
        </div>
        <div className={styles.cardBody}>
          <p>{service.shortDescription}</p>
        </div>
        <div className={styles.cardAction}>
          <span className={styles.capabilityList}>
            {capabilities.map((capability) => {
              const CapabilityIcon = capabilityIcons[capability.toLowerCase()] || FileText;
              return (
                <span className={styles.capability} title={capability} key={capability}>
                  <i><CapabilityIcon size={13} strokeWidth={1.9} /></i>
                  <small>{capability}</small>
                </span>
              );
            })}
          </span>
          <strong>{service.availability === "live" ? "View details" : "Preview"}<ArrowRight size={15} /></strong>
        </div>
      </div>
    </Link>
  );
}

export default function AppsExplorer({ user, access = {} }) {
  const [query, setQuery] = useState("");
  const { statusFor } = useProductStatus();
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCategories = useMemo(() => productCategories.map((category) => ({
    ...category,
    services: productServices.filter((service) => service.category === category.id && (
      !normalizedQuery || [service.name, service.platformName, service.shortDescription, service.formatLabel]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    )),
  })).filter((category) => category.services.length), [normalizedQuery]);

  return (
    <ProductShell user={user} active="apps">
      <main className={styles.appStoreMain}>
        <section className={styles.storeHeader}>
          <div className={styles.storeTitle}><h1>AgenticThat Store</h1></div>
          <p className={styles.storeIntro}>Discover powerful apps and workflows to automate, engage, and grow your business—all in one place.</p>
          <label className={styles.storeSearch}>
            <Search size={19} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps, tools or workflows..." aria-label="Search the AgenticThat Store" />
            {query ? <button type="button" onClick={() => setQuery("")}>Clear</button> : <span className={styles.searchAction}><ArrowRight size={17} /></span>}
          </label>
          <nav className={styles.categoryShortcuts} aria-label="Browse popular categories">
            <span>Popular:</span>
            {productCategories.map((category) => {
              const presentation = categoryPresentation[category.id];
              const ShortcutIcon = presentation.icon;
              return (
                <a
                  href={`#category-${category.id}`}
                  style={{ "--category-accent": presentation.accent, "--category-tint": presentation.tint }}
                  key={category.id}
                >
                  <ShortcutIcon size={16} strokeWidth={2} aria-hidden="true" />
                  {category.label}
                </a>
              );
            })}
          </nav>
        </section>

        <div className={styles.categoryStack}>
          {visibleCategories.map((category) => {
            const categoryPresentationItem = categoryPresentation[category.id];
            const CategoryIcon = categoryPresentationItem.icon;
            return (
              <section className={styles.categorySection} id={`category-${category.id}`} key={category.id}>
                <div className={styles.categoryHeading}>
                  <span
                    className={styles.categoryIcon}
                    style={{ "--category-accent": categoryPresentationItem.accent, "--category-tint": categoryPresentationItem.tint }}
                  >
                    <CategoryIcon size={20} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <h2>{category.label}</h2>
                  <i />
                </div>
                <div className={styles.serviceGrid}>
                  {category.services.map((service) => (
                    <ServiceCard service={service} status={statusFor(service)} allowed={accessSatisfies(access[accessResourceForService(service)] || "none", "view")} key={`${service.category}-${service.slug}`} />
                  ))}
                </div>
              </section>
            );
          })}

          {visibleCategories.length === 0 && (
            <section className={styles.noResults}>
              <h2>No matching apps</h2>
              <p>Try another app name or workflow.</p>
              <button type="button" onClick={() => setQuery("")}>Show all apps</button>
            </section>
          )}
        </div>
      </main>
    </ProductShell>
  );
}
