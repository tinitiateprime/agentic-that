"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ProductShell from "./ProductShell";
import { HOST_PREFIX } from "./shell-routes";
import styles from "./product-shell.module.css";

// The frame host: the main menu, with the current screen in an iframe beside it.
// The menu never reloads; screens tell the host where they are (FrameBridge),
// and menu clicks are passed into the frame as client-side navigations.
export default function ShellHost({ user, initialPath }) {
  const frameRef = useRef(null);
  const bridgeReady = useRef(false);
  const [active, setActive] = useState(null);
  const [src] = useState(initialPath);

  const syncTitle = useCallback(() => {
    try {
      const title = frameRef.current?.contentDocument?.title;
      if (title) document.title = title;
    } catch {
      // A page outside this site; keep the current title.
    }
  }, []);

  useEffect(() => {
    // A #section in the address bar belongs to the screen.
    if (window.location.hash && frameRef.current) frameRef.current.src = `${initialPath}${window.location.hash}`;
  }, [initialPath]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data || {};
      if (data.type === "agentic:ready") bridgeReady.current = true;
      if (data.type === "agentic:unload") bridgeReady.current = false;
      if (data.type === "agentic:active" && typeof data.active === "string") setActive(data.active);
      if (data.type === "agentic:route" && typeof data.href === "string" && data.href.startsWith("/")) {
        bridgeReady.current = true;
        const url = `${HOST_PREFIX}${data.href}`;
        if (url !== `${window.location.pathname}${window.location.search}`) {
          window.history.replaceState(window.history.state, "", url);
        }
        syncTitle();
        // Client-side navigations set the new title a moment later.
        window.setTimeout(syncTitle, 400);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [syncTitle]);

  const navigate = useCallback((href) => {
    const frame = frameRef.current;
    if (!frame) return;
    if (bridgeReady.current && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "agentic:go", href }, window.location.origin);
    } else {
      frame.src = href;
    }
  }, []);

  return (
    <ProductShell user={user} active={active} companionBridge={false} onNavigate={navigate}>
      <iframe ref={frameRef} className={styles.frame} src={src} title="AgenticThat workspace" onLoad={syncTitle} />
    </ProductShell>
  );
}
