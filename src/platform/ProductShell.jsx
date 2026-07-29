"use client";

import Link from "next/link";
import { Boxes, Database, LogOut, Menu, Settings2, X } from "lucide-react";
import { useState } from "react";
import styles from "./product-shell.module.css";

const navigation = [
  { href: "/apps", label: "Store", icon: Boxes, id: "apps" },
  { href: "/content-manager", label: "Content", icon: Database, id: "content" },
  { href: "/config-manager", label: "Connections", icon: Settings2, id: "connections" },
];

export default function ProductShell({ user, active = "apps", children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = String(user?.name || user?.email || "A").charAt(0).toUpperCase();

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
          <span><strong>AgenticThat</strong><small>Operations</small></span>
        </Link>

        <nav className={styles.sidebarNav} aria-label="Workspace navigation">
          <span>Workspace tools</span>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <Link className={active === item.id ? styles.navActive : ""} href={item.href} key={item.id} onClick={() => setMenuOpen(false)}>
                <Icon size={19} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <section className={styles.account} aria-label="Signed-in workspace">
            <span className={styles.accountAvatar}>{initial}</span>
            <span className={styles.accountCopy}>
              <strong>{user?.name || "Workspace owner"}</strong>
              <small>{user?.businessName || user?.email || "Personal workspace"}</small>
            </span>
            <button className={styles.signOut} type="button" onClick={signOut} aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </section>
        </div>
      </aside>

      <div className={styles.productContent}>{children}</div>
    </div>
  );
}
