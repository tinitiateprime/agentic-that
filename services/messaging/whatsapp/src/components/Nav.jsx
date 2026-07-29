"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/dashboard",           label: "Dashboard", icon: "📊" },
  { href: "/messages",            label: "Chat",       icon: "💬" },
  { href: "/contacts",            label: "Contacts",   icon: "👥" },
  { href: "/dashboard/templates", label: "Templates",  icon: "📝" },
  { href: "/groups",              label: "Groups",     icon: "📣" },
  { href: "/settings",            label: "Settings",   icon: "⚙️" },
];

export default function Nav({ businessName }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/whatsapp/auth/logout", { method: "POST" });
    router.push("/whatsapp/login");
    router.refresh();
  }

  // "/dashboard" itself shouldn't also light up for the more-specific
  // "/dashboard/templates" — match longer hrefs first.
  const isActive = (href) =>
    pathname === href ||
    (pathname.startsWith(href + "/") &&
      !LINKS.some((other) => other.href !== href && other.href.startsWith(href) && pathname.startsWith(other.href)));

  return (
    <>
      {/* Left sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col bg-[var(--brand-dark)] text-white sm:flex">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold">
            T
          </span>
          <span className="truncate text-sm font-semibold">{businessName || "Tinitiate WA"}</span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                isActive(l.href) ? "bg-white/15 font-medium" : "text-white/75 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span className="text-base leading-none">{l.icon}</span>
              {l.label}
            </Link>
          ))}
        </nav>

        <button
          onClick={logout}
          className="mx-2 mb-3 rounded-lg px-3 py-2 text-left text-sm text-white/75 hover:bg-white/10 hover:text-white"
        >
          Sign out
        </button>
      </aside>

      {/* Bottom nav (mobile) — one column per link */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-slate-200 bg-white sm:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${
              isActive(l.href) ? "text-[var(--brand-dark)] font-medium" : "text-slate-500"
            }`}
          >
            <span className="text-base leading-none">{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
