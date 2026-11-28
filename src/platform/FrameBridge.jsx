"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { HOST_PREFIX, isShellPath } from "./shell-routes";

const sameOrigin = (event) => event.origin === window.location.origin && event.source === window.parent;

// Connects a page to the frame host (see ShellHost). Mounted once in the root layout.
//  - Inside the frame: reports each route change so the host can update the
//    address bar and title, follows the host's menu clicks with a client-side
//    navigation, and leaves the frame for pages that aren't workspace screens.
//  - On its own: a workspace screen reached by an in-app navigation (for
//    example right after signing in) moves into the frame.
export default function FrameBridge() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() || "";
  const router = useRouter();

  useEffect(() => {
    const href = `${pathname}${search ? `?${search}` : ""}`;
    if (window.self === window.top) {
      if (isShellPath(pathname)) window.location.replace(`${HOST_PREFIX}${href}${window.location.hash}`);
      return;
    }
    if (!isShellPath(pathname)) {
      window.top.location.href = href;
      return;
    }
    window.parent.postMessage({ type: "agentic:route", href }, window.location.origin);
  }, [pathname, search]);

  useEffect(() => {
    if (window.self === window.top) return undefined;
    const onMessage = (event) => {
      if (!sameOrigin(event)) return;
      const href = event.data?.type === "agentic:go" ? event.data.href : "";
      if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) router.push(href);
    };
    const onPageHide = () => window.parent.postMessage({ type: "agentic:unload" }, window.location.origin);
    window.addEventListener("message", onMessage);
    window.addEventListener("pagehide", onPageHide);
    window.parent.postMessage({ type: "agentic:ready" }, window.location.origin);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [router]);

  return null;
}
