"use client";

import Link from "next/link";
import { ClipboardList, Globe2, Home, LogOut, Menu, MessageCircle, MessageCircleMore, MonitorDown, PhoneCall, PlugZap, Send, Settings2, SquarePen, UsersRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CompanionBridgeBanner, CompanionBridgePill } from "./CompanionBridge";
import styles from "./product-shell.module.css";

// Two levels. The slim rail on the left lists everything you can do; sections with
// sub-pages (Messages, More) open a second panel beside it. Everything else is one click.
const sections = [
  { id: "apps", label: "Home", icon: Home, href: "/apps" },
  { id: "connections", label: "Connect", icon: PlugZap, href: "/config-manager", anyCapability: ["publishing.accounts.configure", "messaging.configure"] },
  {
    id: "messages",
    label: "Messages",
    icon: MessageCircleMore,
    capability: "messaging.view",
    children: [
      { id: "messaging", label: "Send to everyone", description: "One message, all channels", href: "/messaging", icon: Send },
      { id: "whatsapp", label: "WhatsApp", description: "Chats, contacts, templates", href: "/dashboard", icon: MessageCircle },
      { id: "telegram", label: "Telegram", description: "Chats, groups, channels", href: "/console", icon: MessageCircle },
    ],
  },
  { id: "publishing", label: "Social posts", icon: SquarePen, href: "/publishing", capability: "publishing.view" },
  { id: "website", label: "Websites", icon: Globe2, href: "/website-studio" },
  { id: "phone", label: "Phone AI", icon: PhoneCall, href: "/phone-front-desk" },
  { id: "content", label: "Activity", icon: ClipboardList, href: "/content-manager", anyCapability: ["publishing.view", "messaging.view"] },
];

const moreChildren = [
  { id: "team", label: "Your team", description: "Invite people, set access", href: "/workspace-team", icon: UsersRound, capability: "workspace.team.manage" },
  { id: "companion", label: "Desktop helper", description: "Needed for social posting", href: "/companion/download", icon: MonitorDown },
  { id: "admin", label: "Admin Center", description: "Users, roles and workspaces", href: "/admin-center", icon: Settings2, admin: true },
];

export function billingLabel(user) {
  if (user?.billingStatus === "trialing" && !user.trialStartsAt) {
    return "Trial ready · starts with first service";
  }
  if (user?.billingStatus === "trialing" && user.trialEndsAt) {
    const days = Math.max(0, Math.ceil((new Date(user.trialEndsAt).getTime() - Date.now()) / 86_400_000));
    return `Free trial · ${days} day${days === 1 ? "" : "s"} left`;
  }
  if (user?.billingStatus === "expired") return "Free trial expired";
  if (user?.billingStatus === "past_due") return "Payment past due";
  if (user?.billingStatus === "payment_pending") return "Payment pending";
  return "";
}

export default function ProductShell({ user, active = "apps", companionBridge = true, embedded = false, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = String(user?.name || user?.email || "A").charAt(0).toUpperCase();
  const capabilities = Array.isArray(user?.capabilities) ? user.capabilities : [];
  const allowed = (item) => (
    (!item.capability || capabilities.includes(item.capability))
    && (!item.anyCapability || item.anyCapability.some((capability) => capabilities.includes(capability)))
    && (!item.admin || user?.isGlobalAdmin)
  );

  const hrefFor = (item) => {
    if (item.id === "connections") return capabilities.includes("messaging.configure")
      ? "/config-manager?service=messaging"
      : "/config-manager?service=publishing";
    if (item.id === "content") return capabilities.includes("messaging.view")
      ? "/content-manager?service=messaging"
      : "/content-manager?service=publishing";
    return item.href;
  };

  const visibleMore = moreChildren.filter(allowed);
  const railSections = [
    ...sections.filter(allowed).map((section) => (
      section.children ? { ...section, children: section.children.filter(allowed) } : section
    )),
    { id: "more", label: "More", icon: null, children: visibleMore },
  ];

  const sectionOf = (id) => railSections.find((section) => section.id === id || section.children?.some((child) => child.id === id));
  const activeSection = sectionOf(active);
  // The second panel is a flyout: it opens when you click a section with sub-pages and
  // closes when you click anywhere else, press Escape, or pick a page.
  const [previewId, setPreviewId] = useState(null);
  const sidebarRef = useRef(null);
  const panelSection = railSections.find((section) => section.id === previewId && section.children?.length);

  useEffect(() => {
    if (!previewId) return undefined;
    const onPointerDown = (event) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target)) setPreviewId(null);
    };
    const onKeyDown = (event) => { if (event.key === "Escape") setPreviewId(null); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [previewId]);

  async function signOut() {
    await Promise.allSettled([
      fetch("/api/platform-auth/logout", { method: "POST" }),
      fetch("/api/telegram/auth/session", { method: "DELETE" }),
      fetch("/api/whatsapp/auth/logout", { method: "POST" }),
    ]);
    window.sessionStorage.removeItem("agenticthat-publish-queue-session");
    window.sessionStorage.removeItem("agenticthat-publish-account-summary");
    window.location.href = "/";
  }

  const close = () => { setMenuOpen(false); setPreviewId(null); };

  function ChildLink({ child, section }) {
    const Icon = child.icon;
    const on = active === child.id;
    return (
      <Link className={on ? styles.navActive : ""} href={hrefFor(child)} onClick={close} aria-current={on ? "page" : undefined} key={child.id}>
        <Icon size={18} />
        <span className={styles.navCopy}><strong>{child.label}</strong><small>{child.description}</small></span>
      </Link>
    );
  }

  const moreOpen = panelSection?.id === "more";

  return (
    <div className={`${styles.productShell} ${embedded ? styles.embedded : ""}`}>
      <header className={styles.mobileHeader}>
        <Link className={styles.mobileBrand} href="/apps"><span>AT</span><strong>AgenticThat</strong></Link>
        <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle navigation" aria-expanded={menuOpen}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {menuOpen && <button className={styles.sidebarBackdrop} type="button" aria-label="Close navigation" onClick={close} />}

      <aside ref={sidebarRef} className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}>
        <nav className={styles.rail} aria-label="Main navigation">
          <Link className={styles.brandMark} href="/apps" onClick={close} title="AgenticThat home">AT</Link>

          <div className={styles.railItems}>
            {railSections.filter((section) => section.id !== "more").map((section) => {
              const Icon = section.icon;
              const isActive = activeSection?.id === section.id;
              const open = panelSection?.id === section.id;
              const className = `${styles.railItem} ${isActive ? styles.railActive : ""} ${open && !isActive ? styles.railOpen : ""}`;
              const inlineOpen = open || isActive;
              return (
                <div key={section.id}>
                  {section.children ? (
                    <button type="button" className={className} aria-expanded={open} aria-current={isActive ? "page" : undefined} onClick={() => setPreviewId(open ? null : section.id)}>
                      <Icon size={21} /><span>{section.label}</span>
                    </button>
                  ) : (
                    <Link className={className} href={hrefFor(section)} aria-current={isActive ? "page" : undefined} onClick={close}>
                      <Icon size={21} /><span>{section.label}</span>
                    </Link>
                  )}
                  {inlineOpen && section.children && (
                    <div className={styles.inlineChildren}>
                      {section.children.map((child) => <ChildLink child={child} section={section} key={child.id} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.railFooter}>
            <button type="button" className={`${styles.railItem} ${activeSection?.id === "more" ? styles.railActive : ""} ${moreOpen && activeSection?.id !== "more" ? styles.railOpen : ""}`} aria-expanded={moreOpen} onClick={() => setPreviewId(moreOpen ? null : "more")}>
              <span className={styles.accountAvatar}>{initial}</span><span>More</span>
            </button>
            {(moreOpen || activeSection?.id === "more") && (
              <div className={styles.inlineChildren}>
                {visibleMore.map((child) => <ChildLink child={child} section={null} key={child.id} />)}
                <button className={styles.signOut} type="button" onClick={signOut}><LogOut size={17} /><span>Sign out</span></button>
              </div>
            )}
          </div>
        </nav>

        {panelSection && (
          <nav className={styles.panel} aria-label={panelSection.label}>
            <h2>{panelSection.id === "more" ? "More" : panelSection.label}</h2>
            {panelSection.children.map((child) => <ChildLink child={child} section={panelSection} key={child.id} />)}
            {panelSection.id === "more" && (
              <>
                <CompanionBridgePill />
                <section className={styles.account} aria-label="Signed-in workspace">
                  <span className={styles.accountAvatar}>{initial}</span>
                  <span className={styles.accountCopy}>
                    <strong>{user?.name || "Your workspace"}</strong>
                    <small>{user?.businessName || user?.email || "Personal workspace"}</small>
                    {billingLabel(user) && <small>{billingLabel(user)}</small>}
                  </span>
                </section>
                <button className={styles.signOut} type="button" onClick={signOut}><LogOut size={17} /><span>Sign out</span></button>
              </>
            )}
          </nav>
        )}
      </aside>

      <div className={styles.productContent}>
        {companionBridge && <CompanionBridgeBanner />}
        {children}
      </div>
    </div>
  );
}
