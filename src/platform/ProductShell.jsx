"use client";

import Link from "next/link";
import { ClipboardList, Globe2, Home, LogOut, Menu, MessageCircle, MessageCircleMore, MonitorDown, PhoneCall, PlugZap, Send, Settings2, SquarePen, UsersRound, X } from "lucide-react";
import { useState } from "react";
import { CompanionBridgeBanner, CompanionBridgePill } from "./CompanionBridge";
import styles from "./product-shell.module.css";

// Ordered as the journey a new person follows: connect accounts, do the work, check results.
const navigationGroups = [
  {
    label: "Start here",
    items: [
      { href: "/apps", label: "Home", description: "See what you can do", icon: Home, id: "apps" },
    ],
  },
  {
    label: "1 · Connect",
    items: [
      { href: "/config-manager", label: "Connect accounts", description: "WhatsApp, Instagram and more", icon: PlugZap, id: "connections", anyCapability: ["publishing.accounts.configure", "messaging.configure"] },
    ],
  },
  {
    label: "2 · Do your work",
    items: [
      { href: "/messaging", label: "Send to everyone", description: "One message, all channels", icon: MessageCircleMore, id: "messaging", capability: "messaging.view" },
      { href: "/dashboard", label: "WhatsApp", description: "Chats, contacts, templates", icon: MessageCircle, id: "whatsapp", capability: "messaging.view" },
      { href: "/console", label: "Telegram", description: "Chats, groups, channels", icon: Send, id: "telegram", capability: "messaging.view" },
      { href: "/publishing", label: "Post on social media", description: "Instagram, Facebook, YouTube…", icon: SquarePen, id: "publishing", capability: "publishing.view" },
      { href: "/website-studio", label: "Build a website", description: "From a short description", icon: Globe2, id: "website" },
      { href: "/phone-front-desk", label: "Answer phone calls", description: "Your AI receptionist", icon: PhoneCall, id: "phone" },
    ],
  },
  {
    label: "3 · Check results",
    items: [
      { href: "/content-manager", label: "Activity & records", description: "See what was sent and posted", icon: ClipboardList, id: "content", anyCapability: ["publishing.view", "messaging.view"] },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/workspace-team", label: "Your team", description: "Invite people, set access", icon: UsersRound, id: "team", capability: "workspace.team.manage" },
      { href: "/companion/download", label: "Desktop helper", description: "Needed for social posting", icon: MonitorDown, id: "companion" },
    ],
  },
];

function billingLabel(user) {
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

export default function ProductShell({ user, active = "apps", companionBridge = true, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = String(user?.name || user?.email || "A").charAt(0).toUpperCase();
  const capabilities = Array.isArray(user?.capabilities) ? user.capabilities : [];
  const navigationHref = (item) => {
    if (item.id === "connections") return capabilities.includes("messaging.configure")
      ? "/config-manager?service=messaging"
      : "/config-manager?service=publishing";
    if (item.id === "content") return capabilities.includes("messaging.view")
      ? "/content-manager?service=messaging"
      : "/content-manager?service=publishing";
    return item.href;
  };

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

  return (
    <div className={styles.productShell}>
      <header className={styles.mobileHeader}>
        <Link className={styles.mobileBrand} href="/apps"><span>AT</span><strong>AgenticThat</strong></Link>
        <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle navigation" aria-expanded={menuOpen}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {menuOpen && <button className={styles.sidebarBackdrop} type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}>
        <Link className={styles.brand} href="/apps" onClick={() => setMenuOpen(false)}>
          <span className={styles.brandMark}>AT</span>
          <span><strong>AgenticThat</strong><small>Your workspace</small></span>
        </Link>

        <div className={styles.sidebarScroll}>
          {navigationGroups.map((group) => {
            const items = group.items.filter((item) => (
              (!item.capability || capabilities.includes(item.capability))
              && (!item.anyCapability || item.anyCapability.some((capability) => capabilities.includes(capability)))
            ));
            if (!items.length) return null;
            return (
              <nav className={styles.sidebarNav} aria-label={group.label} key={group.label}>
                <span>{group.label}</span>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link className={active === item.id ? styles.navActive : ""} href={navigationHref(item)} key={item.id} onClick={() => setMenuOpen(false)} aria-current={active === item.id ? "page" : undefined}>
                      <Icon size={19} />
                      <span className={styles.navCopy}><strong>{item.label}</strong><small>{item.description}</small></span>
                    </Link>
                  );
                })}
              </nav>
            );
          })}

          {user?.isGlobalAdmin && (
            <nav className={styles.sidebarNav} aria-label="Administration">
              <span>Administration</span>
              <Link href="/admin-center" onClick={() => setMenuOpen(false)}>
                <Settings2 size={19} />
                <span className={styles.navCopy}><strong>Admin Center</strong><small>Users, roles and workspaces</small></span>
              </Link>
            </nav>
          )}
        </div>

        <CompanionBridgePill />

        <div className={styles.sidebarFooter}>
          <section className={styles.account} aria-label="Signed-in workspace">
            <span className={styles.accountAvatar}>{initial}</span>
            <span className={styles.accountCopy}>
              <strong>{user?.name || "Your workspace"}</strong>
              <small>{user?.businessName || user?.email || "Personal workspace"}</small>
              {billingLabel(user) && <small>{billingLabel(user)}</small>}
            </span>
          </section>
          <button className={styles.signOut} type="button" onClick={signOut}>
            <LogOut size={17} /><span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className={styles.productContent}>
        {companionBridge && <CompanionBridgeBanner />}
        {children}
      </div>
    </div>
  );
}
