"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ContactRound,
  FileText,
  LogOut,
  MessageCircle,
  PlugZap,
  Settings2,
  UsersRound,
} from "lucide-react";

const LINKS = [
  { href: "/dashboard", label: "Overview", icon: BarChart3 },
  { href: "/messages", label: "Inbox", icon: MessageCircle },
  { href: "/contacts", label: "Contacts", icon: ContactRound },
  { href: "/dashboard/templates", label: "Templates", icon: FileText },
  { href: "/groups", label: "Groups", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

const CONNECTIONS_HREF = "/config-manager?service=messaging&platform=whatsapp";

export default function Nav({ businessName }) {
  const pathname = usePathname();

  async function logout() {
    await Promise.allSettled([
      fetch("/api/platform-auth/logout", { method: "POST" }),
      fetch("/api/whatsapp/auth/logout", { method: "POST" }),
      fetch("/api/telegram/auth/session", { method: "DELETE" }),
    ]);
    window.sessionStorage.removeItem("agenticthat-publish-queue-session");
    window.sessionStorage.removeItem("agenticthat-publish-account-summary");
    window.location.href = "/";
  }

  const isActive = (href) =>
    pathname === href ||
    (pathname.startsWith(href + "/") &&
      !LINKS.some((other) => other.href !== href && other.href.startsWith(href) && pathname.startsWith(other.href)));

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:hidden">
        <Link href="/apps" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--brand-dark)] text-xs font-bold text-white">AT</span>
          <span>WhatsApp workspace</span>
        </Link>
        <Link href={CONNECTIONS_HREF} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-dark)]">
          <PlugZap size={15} />Connections
        </Link>
      </header>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col bg-[var(--brand-dark)] text-white sm:flex">
        <Link href="/apps" className="flex items-center gap-3 border-b border-white/10 px-4 py-4" title="Back to AgenticThat Store">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15 text-xs font-bold">AT</span>
          <span className="min-w-0">
            <strong className="block text-sm font-semibold">AgenticThat</strong>
            <small className="mt-0.5 block truncate text-[10px] font-medium uppercase tracking-wider text-white/55">WhatsApp workspace</small>
          </span>
        </Link>

        <nav className="border-b border-white/10 px-2 py-3" aria-label="Product navigation">
          <p className="mb-1 px-3 text-[9px] font-bold uppercase tracking-[0.12em] text-white/45">AgenticThat</p>
          <Link href="/apps" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/75 hover:bg-white/10 hover:text-white">
            <Boxes size={17} /><span>Store</span>
          </Link>
          <Link href={CONNECTIONS_HREF} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/75 hover:bg-white/10 hover:text-white">
            <PlugZap size={17} /><span>Manage connection</span>
          </Link>
        </nav>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3" aria-label="WhatsApp workspace navigation">
          <p className="mb-1 px-3 text-[9px] font-bold uppercase tracking-[0.12em] text-white/45">{businessName || "Workspace"}</p>
          {LINKS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  active ? "bg-white/15 font-medium text-white" : "text-white/75 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={17} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button onClick={logout} className="mx-2 mb-3 flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white/75 hover:bg-white/10 hover:text-white">
          <LogOut size={17} />Sign out
        </button>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-slate-200 bg-white sm:hidden" aria-label="WhatsApp workspace navigation">
        {LINKS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${active ? "font-medium text-[var(--brand-dark)]" : "text-slate-500"}`}
            >
              <Icon size={17} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
