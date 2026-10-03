"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Captions,
  Cloud,
  Eye,
  FileText,
  Globe2,
  Hash,
  Heart,
  Image,
  KeyRound,
  Link as LinkIcon,
  Link2,
  MessageCircleMore,
  MessagesSquare,
  PhoneCall,
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

const categoryIcons = {
  website: Globe2,
  messaging: MessageCircleMore,
  publishing: SquarePen,
  scraping: Search,
  seo: BarChart3,
  engagement: Heart,
};

const capabilityIcons = {
  "ai generation": Sparkles,
  "responsive sites": Eye,
  "auto publishing": Cloud,
  "cloud api": Cloud,
  wati: Link2,
  coexistence: ShieldCheck,
  "direct messaging": Send,
  "live voice": MessageCircleMore,
  "lead capture": UserRound,
  "call summaries": FileText,
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

// The four things most people come here to do, in plain words. Each card names the
// outcome (not the technology) and says whether an account needs connecting first.
const tasks = [
  {
    id: "messaging",
    title: "Send messages to customers",
    description: "Write one message and send it on WhatsApp and Telegram.",
    icon: MessageCircleMore,
    href: "/messaging",
    setupHref: "/config-manager?service=messaging",
    setupLabel: "WhatsApp or Telegram",
    category: "messaging",
    slugs: ["whatsapp", "telegram"],
    channelLinks: [
      { href: "/dashboard", label: "Open WhatsApp" },
      { href: "/console", label: "Open Telegram" },
    ],
  },
  {
    id: "publishing",
    title: "Post on social media",
    description: "Prepare a post once and publish it to Instagram, Facebook, YouTube, X and LinkedIn.",
    icon: SquarePen,
    href: "/publishing",
    setupHref: "/config-manager?service=publishing",
    setupLabel: "a social media account",
    category: "publishing",
  },
  {
    id: "website",
    title: "Build a website",
    description: "Describe your business and get three ready-to-publish website designs.",
    icon: Globe2,
    href: "/website-studio",
    category: "website",
    slugs: ["ai-website-studio"],
  },
  {
    id: "phone",
    title: "Answer phone calls with AI",
    description: "Try an AI receptionist that greets callers and writes down their details.",
    icon: PhoneCall,
    href: "/phone-front-desk",
    category: "messaging",
    slugs: ["ai-phone-front-desk"],
  },
];
const taskCategoryIds = new Set(["website", "messaging", "publishing"]);

function serviceCapabilities(service) {
  const label = service.formatLabel || (service.availability === "live" ? "Guided workflow" : "Product preview");
  return label.split(/(?:Â·|·)/).map((item) => item.trim()).filter(Boolean).slice(0, 3);
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
  const opensWhatsAppWorkspace = Boolean(
    allowed
    && service.connectionKind === "whatsapp"
    && status.state === "connected"
    && service.dashboardHref
  );
  const href = !allowed && service.availability === "live"
    ? `/access-denied?resource=${encodeURIComponent(accessResourceForService(service))}`
    : opensWhatsAppWorkspace
      ? service.dashboardHref
      : serviceDetailHref(service);

  const isPreview = service.availability !== "live";

  return (
    <Link
      className={`${styles.serviceCard} ${isPreview ? styles.serviceCardCompact : ""}`}
      href={href}
      aria-label={!allowed && service.availability === "live" ? `${service.name}: access required` : undefined}
    >
      <div className={styles.cardContent}>
        <div className={styles.cardHeader}>
          <span className={styles.serviceLogo} aria-hidden="true"><img src={service.logo} alt="" /></span>
          <div className={styles.serviceIdentity}>
            <h3>{service.name}</h3>
            <ServiceStatus status={!allowed && service.availability === "live" ? { state: "locked", label: "Access required" } : status} />
          </div>
        </div>
        <div className={styles.cardBody}>
          <p>{service.shortDescription}</p>
        </div>
        {!isPreview && <div className={styles.cardAction}>
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
          <strong>{opensWhatsAppWorkspace ? "Open workspace" : "View details"}<ArrowRight size={15} /></strong>
        </div>}
      </div>
    </Link>
  );
}

function TaskCard({ task, services, statusFor, user, access }) {
  const Icon = task.icon;
  const allowedFor = (service) => accessSatisfies(access[accessResourceForService(service)] || "none", "view")
    && Boolean(user?.capabilities?.includes(`${service.category}.view`));
  const usable = services.filter(allowedFor);
  const allowed = usable.length > 0;
  const needsSetup = Boolean(task.setupHref);
  const connected = needsSetup && usable.some((service) => statusFor(service).state === "connected");
  const checking = needsSetup && !connected && usable.some((service) => statusFor(service).state === "checking");
  const deniedHref = `/access-denied?resource=${encodeURIComponent(accessResourceForService(services[0]))}`;

  let chip = { text: "Ready to use", tone: "ready" };
  let primary = { href: task.href, label: "Open" };
  let secondary = null;
  if (!allowed) {
    chip = { text: "Access needed", tone: "locked" };
    primary = { href: deniedHref, label: "How to get access" };
  } else if (needsSetup && !connected && !checking) {
    chip = { text: "Connect an account first", tone: "setup" };
    primary = { href: task.setupHref, label: "Connect your account" };
    secondary = { href: task.href, label: "Open anyway" };
  } else if (connected) {
    chip = { text: "Account connected", tone: "ready" };
  } else if (checking) {
    chip = { text: "Checking…", tone: "checking" };
  }

  return (
    <article className={styles.taskCard}>
      <span className={styles.taskIcon}><Icon size={24} strokeWidth={1.9} aria-hidden="true" /></span>
      <span className={`${styles.taskChip} ${styles[`taskChip_${chip.tone}`]}`}><i />{chip.text}</span>
      <h3>{task.title}</h3>
      <p>{task.description}</p>
      <div className={styles.taskActions}>
        <Link className={styles.taskPrimary} href={primary.href}>{primary.label}<ArrowRight size={16} aria-hidden="true" /></Link>
        {secondary && <Link className={styles.taskSecondary} href={secondary.href}>{secondary.label}</Link>}
      </div>
      {allowed && task.channelLinks && (
        <div className={styles.channelLinks}>
          <span>Or go straight to:</span>
          {task.channelLinks.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}
        </div>
      )}
    </article>
  );
}

export default function AppsExplorer({ user, access = {} }) {
  const [query, setQuery] = useState("");
  const { statusFor } = useProductStatus();
  const normalizedQuery = query.trim().toLowerCase();
  const firstName = String(user?.name || "").trim().split(/\s+/)[0];
  const servicesFor = (task) => productServices.filter((service) => (
    service.category === task.category
    && service.availability === "live"
    && (task.slugs ? task.slugs.includes(service.slug) : true)
  ));
  const visibleCategories = useMemo(() => productCategories.map((category) => ({
    ...category,
    services: productServices.filter((service) => service.category === category.id && (
      !normalizedQuery || [service.name, service.platformName, service.shortDescription, service.formatLabel]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    )),
  })).filter((category) => category.services.length && (normalizedQuery || !taskCategoryIds.has(category.id))), [normalizedQuery]);

  return (
    <ProductShell user={user} active="apps">
      <main className={styles.appStoreMain}>
        <section className={styles.welcome}>
          <h1>{firstName ? `Hello, ${firstName}` : "Welcome"} 👋</h1>
          <p>What would you like to do today? Pick one below — we will guide you through the rest.</p>
          <ol className={styles.journey} aria-label="How it works">
            <li><i>1</i><span><strong>Connect</strong> your accounts</span></li>
            <li><i>2</i><span><strong>Do</strong> your work</span></li>
            <li><i>3</i><span><strong>Check</strong> the results</span></li>
          </ol>
        </section>

        {!normalizedQuery && (
          <section className={styles.taskGrid} aria-label="What would you like to do?">
            {tasks.map((task) => (
              <TaskCard task={task} services={servicesFor(task)} statusFor={statusFor} user={user} access={access} key={task.id} />
            ))}
          </section>
        )}

        <section className={styles.moreTools} aria-label="More tools">
          <div className={styles.moreHeader}>
            <div>
              <h2>{normalizedQuery ? "Search results" : "More tools"}</h2>
              <p>{normalizedQuery ? "Everything that matches your search." : "Research and growth tools. Ones marked “Coming soon” are not open yet."}</p>
            </div>
            <label className={styles.storeSearch}>
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search, e.g. WhatsApp or website" aria-label="Search all tools" />
              {query && <button type="button" onClick={() => setQuery("")}>Clear</button>}
            </label>
          </div>

          <div className={styles.categoryStack}>
            {visibleCategories.map((category) => {
              const CategoryIcon = categoryIcons[category.id];
              return (
                <section className={styles.categorySection} id={`category-${category.id}`} key={category.id}>
                  <div className={styles.categoryHeading}>
                    <span className={styles.categoryIcon}>
                      <CategoryIcon size={20} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <h2>{category.label}</h2>
                    <span className={styles.categoryCount}>{category.services.length}</span>
                    <i />
                  </div>
                  <div className={styles.serviceGrid}>
                    {category.services.map((service) => (
                      <ServiceCard
                        service={service}
                        status={statusFor(service)}
                        allowed={accessSatisfies(access[accessResourceForService(service)] || "none", "view")
                          && (!service.availability || service.availability !== "live" || user?.capabilities?.includes(`${service.category}.view`))}
                        key={`${service.category}-${service.slug}`}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {visibleCategories.length === 0 && (
              <section className={styles.noResults}>
                <h2>Nothing found</h2>
                <p>Try a simpler word, like “message”, “post” or “website”.</p>
                <button type="button" onClick={() => setQuery("")}>Show everything</button>
              </section>
            )}
          </div>
        </section>
      </main>
    </ProductShell>
  );
}
