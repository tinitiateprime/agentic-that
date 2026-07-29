"use client";

import Link from "next/link";
import { Boxes, Database, LogOut, Menu, Settings2, X } from "lucide-react";
import { useState } from "react";
import styles from "./apps.module.css";

const navigation = [
  { href: "/apps", label: "Apps", icon: Boxes, id: "apps" },
  { href: "/config-manager", label: "Connections", icon: Settings2, id: "connections" },
  { href: "/content-manager", label: "Content", icon: Database, id: "content" },
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
    <div className={styles.productPage}>
      <header className={styles.productHeader}>
        <div className={styles.headerInner}>
          <Link className={styles.productBrand} href="/apps" aria-label="AgenticThat Apps">
            <span className={styles.brandMark}>A</span>
            <span><strong>AgenticThat</strong><small>Workspace</small></span>
          </Link>

          <nav className={`${styles.productNav} ${menuOpen ? styles.productNavOpen : ""}`} aria-label="Workspace navigation">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link className={active === item.id ? styles.navActive : ""} href={item.href} key={item.id} onClick={() => setMenuOpen(false)}>
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className={styles.accountArea}>
            <div className={styles.accountAvatar}>{initial}</div>
            <span className={styles.accountCopy}>
              <strong>{user?.name || "Workspace owner"}</strong>
              <small>{user?.businessName || user?.email}</small>
            </span>
            <button className={styles.signOutButton} type="button" onClick={signOut} aria-label="Sign out">
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>

          <button className={styles.mobileMenuButton} type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Toggle navigation" aria-expanded={menuOpen}>
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
