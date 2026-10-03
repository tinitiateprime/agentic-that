"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Home,
  ContactRound,
  FileText,
  LogOut,
  MessageCircle,
  PlugZap,
  Send,
  Settings2,
  UsersRound,
} from "lucide-react";

const LINKS = [
  { href: "/dashboard", label: "Summary", icon: BarChart3 },
  { href: "/messages", label: "Chats", icon: MessageCircle },
  { href: "/contacts", label: "Contacts", icon: ContactRound },
  { href: "/dashboard/templates", label: "Ready messages", short: "Ready", icon: FileText },
  { href: "/groups", label: "Contact groups", short: "Groups", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

const OTHER_LINKS = [
  { href: "/apps", label: "Home", icon: Home },
  { href: "/messaging", label: "Send to everyone", icon: Send },
  { href: "/console", label: "Telegram", icon: MessageCircle },
  { href: "/config-manager?service=messaging&platform=whatsapp", label: "WhatsApp connection", icon: PlugZap },
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
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-500 text-xs font-extrabold text-neutral-900">AT</span>
          <span>WhatsApp</span>
        </Link>
        <Link href={CONNECTIONS_HREF} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
          <PlugZap size={15} />Connections
        </Link>
      </header>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-slate-200 bg-white sm:flex">
        <Link href="/apps" className="flex items-center gap-3 px-4 py-4" title="Back to Home">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px_4px_10px_4px] bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-500 text-xs font-extrabold text-neutral-900">AT</span>
          <span className="min-w-0">
            <strong className="block text-sm font-semibold text-slate-900">AgenticThat</strong>
            <small className="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">WhatsApp</small>
          </span>
        </Link>

        <nav className="border-y border-slate-100 px-2 py-3" aria-label="Product navigation">
          {OTHER_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                <Icon size={17} /><span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3" aria-label="WhatsApp workspace navigation">
          <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{businessName || "WhatsApp"}</p>
          {LINKS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                  active ? "border-amber-300/50 bg-amber-50 font-semibold text-slate-900" : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon size={17} className={active ? "text-amber-700" : ""} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button onClick={logout} className="mx-2 mb-3 flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-900">
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
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${active ? "font-medium text-slate-900" : "text-slate-500"}`}
            >
              <Icon size={17} />
              {item.short || item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
