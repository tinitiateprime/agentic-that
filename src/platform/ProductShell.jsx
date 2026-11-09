"use client";

import Link from "next/link";
import { Boxes, Database, LogIn, LogOut, Menu, Settings2, UsersRound, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BrandSymbol } from "./BrandMark";
import styles from "./product-shell.module.css";

const navigation = [
  { href: "/apps", label: "Store", description: "Choose a service", icon: Boxes, id: "apps" },
  { href: "/config-manager", label: "Connections", description: "Add and sign in accounts", icon: Settings2, id: "connections", anyCapability: ["publishing.accounts.configure", "messaging.configure"] },
  { href: "/content-manager", label: "Content", description: "Review accounts and activity", icon: Database, id: "content", anyCapability: ["publishing.view", "messaging.view"] },
  { href: "/workspace-team", label: "Team", description: "Members and roles", icon: UsersRound, id: "team", capability: "workspace.team.manage" },
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

export default function ProductShell({ user, active = "apps", children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const guest = !user;
  const homeHref = guest ? "/" : "/apps";
  const returnPath = usePathname() || "/apps";
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
        <Link className={styles.mobileBrand} href={homeHref}><span><BrandSymbol size={19} /></span><strong>AgenticThat</strong></Link>
        <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle navigation" aria-expanded={menuOpen}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {menuOpen && <button className={styles.sidebarBackdrop} type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}>
        <Link className={styles.brand} href={homeHref} onClick={() => setMenuOpen(false)}>
          <span className={styles.brandMark}><BrandSymbol size={20} /></span>
          <span><strong>AgenticThat</strong><small>Operations</small></span>
        </Link>

        <nav className={styles.sidebarNav} aria-label="Workspace navigation">
          <span>Workspace tools</span>
          {navigation.filter((item) => (
            (!guest || item.id === "apps")
            && (!item.capability || capabilities.includes(item.capability))
            && (!item.anyCapability || item.anyCapability.some((capability) => capabilities.includes(capability)))
          )).map((item) => {
            const Icon = item.icon;
            return (
              <Link className={active === item.id ? styles.navActive : ""} href={navigationHref(item)} key={item.id} onClick={() => setMenuOpen(false)} aria-current={active === item.id ? "page" : undefined}>
                <Icon size={19} />
                <span className={styles.navCopy}><strong>{item.label}</strong><small>{item.description}</small></span>
              </Link>
            );
          })}
        </nav>

        {user?.isGlobalAdmin && (
          <nav className={styles.sidebarNav} aria-label="Administration">
            <span>Administration</span>
            <Link href="/admin-center" onClick={() => setMenuOpen(false)}>
              <Settings2 size={19} />
              <span className={styles.navCopy}><strong>Admin Center</strong><small>Users, roles and workspaces</small></span>
            </Link>
          </nav>
        )}

        <section className={styles.workspacePath} aria-label="Getting started">
          <strong>Getting started</strong>
          <ol>
            <li><i>1</i><span>Choose an app</span></li>
            <li><i>2</i><span>Connect its account</span></li>
            <li><i>3</i><span>Open the workspace</span></li>
          </ol>
        </section>

        {guest ? (
          <div className={styles.sidebarFooter}>
            <a className={styles.guestPrimary} href={`/?auth=signup&next=${encodeURIComponent(returnPath)}`}>Create account</a>
            <a className={styles.signOut} href={`/?auth=login&next=${encodeURIComponent(returnPath)}`}>
              <LogIn size={17} /><span>Sign in</span>
            </a>
          </div>
        ) : (
        <div className={styles.sidebarFooter}>
          <section className={styles.account} aria-label="Signed-in workspace">
            <span className={styles.accountAvatar}>{initial}</span>
            <span className={styles.accountCopy}>
              <strong>{user?.name || "Workspace owner"}</strong>
              <small>{user?.businessName || user?.email || "Personal workspace"}</small>
              {billingLabel(user) && <small>{billingLabel(user)}</small>}
            </span>
          </section>
          <button className={styles.signOut} type="button" onClick={signOut}>
            <LogOut size={17} /><span>Sign out</span>
          </button>
        </div>
        )}
      </aside>

      <div className={styles.productContent}>{children}</div>
    </div>
  );
}
