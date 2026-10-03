"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import BrandLoader from "./BrandLoader";
import styles from "./global-loader.module.css";

// App-wide loading indicator.
//  - Navigation (internal link clicks, back/forward): full-screen brand loader
//    until the new route renders.
//  - Actions (POST/PUT/PATCH/DELETE fetches): compact floating brand loader
//    while the request is in flight. Background GET polling never triggers it.
// Both only appear after a short delay so fast responses never flicker.

const SHOW_DELAY_MS = 180;
const NAVIGATION_TIMEOUT_MS = 8_000;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Short-lived plumbing requests that are not user actions.
const SILENT_URL_PATTERNS = [
  /\/api\/platform-auth\/service-token/,
  /\/api\/wati\/messages\/sync/, // background auto-sync timer
  /\/_next\//,
  /\/__nextjs/,
  /\/api\/health/,
  /\/health$/,
];

function requestDetails(input, init) {
  const method = String(init?.method || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
  const headers = new Headers(init?.headers || (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined));
  return { method, url, silent: headers.has("x-silent-request") };
}

function isTrackedRequest(input, init) {
  const { method, url, silent } = requestDetails(input, init);
  if (silent || !MUTATING_METHODS.has(method)) return false;
  return !SILENT_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function isInternalNavigation(event) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const anchor = event.target?.closest?.("a[href]");
  if (!anchor || anchor.hasAttribute("download") || anchor.dataset.noLoader !== undefined) return false;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return false;
  let next;
  try {
    next = new URL(anchor.href, window.location.href);
  } catch {
    return false;
  }
  if (next.origin !== window.location.origin) return false;
  // Same page or only the #hash changed: nothing to load.
  return next.pathname !== window.location.pathname || next.search !== window.location.search;
}

export default function GlobalLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, setNavigating] = useState(false);
  const [showNavigation, setShowNavigation] = useState(false);
  const [pending, setPending] = useState(0);
  const [showAction, setShowAction] = useState(false);
  const navigationTimeout = useRef(null);

  // Route changed: the navigation finished.
  useEffect(() => {
    setNavigating(false);
  }, [pathname, searchParams]);

  // Start the navigation loader on internal link clicks and back/forward.
  useEffect(() => {
    const start = () => {
      setNavigating(true);
      window.clearTimeout(navigationTimeout.current);
      navigationTimeout.current = window.setTimeout(() => setNavigating(false), NAVIGATION_TIMEOUT_MS);
    };
    const onClick = (event) => {
      if (isInternalNavigation(event)) start();
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
      window.clearTimeout(navigationTimeout.current);
    };
  }, []);

  // Count in-flight user actions by wrapping fetch once for the whole app.
  useEffect(() => {
    if (window.__agenticLoaderFetch) return undefined;
    const originalFetch = window.fetch;
    window.__agenticLoaderFetch = originalFetch;
    window.fetch = function trackedFetch(input, init) {
      if (!isTrackedRequest(input, init)) return originalFetch.call(this, input, init);
      setPending((count) => count + 1);
      return originalFetch.call(this, input, init).finally(() => setPending((count) => Math.max(0, count - 1)));
    };
    return () => {
      window.fetch = originalFetch;
      delete window.__agenticLoaderFetch;
    };
  }, []);

  // Delay before showing either loader to avoid flicker on fast work.
  useEffect(() => {
    if (!navigating) {
      setShowNavigation(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShowNavigation(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [navigating]);

  useEffect(() => {
    if (!pending) {
      setShowAction(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShowAction(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (showNavigation) {
    return (
      <div className={styles.overlay}>
        <BrandLoader label="Loading" />
      </div>
    );
  }
  if (showAction) {
    return (
      <div className={styles.badge}>
        <BrandLoader size="compact" label="Working…" />
      </div>
    );
  }
  return null;
}
