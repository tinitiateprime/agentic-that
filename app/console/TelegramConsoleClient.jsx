"use client";

import { useEffect, useRef, useState } from "react";
import { TelegramConsole } from "@telegram/console/src/TelegramConsole";
import { initTelegramConsole } from "@telegram/console/src/telegram-controller";

export default function TelegramConsoleClient({ serviceToken }) {
  const [mounted, setMounted] = useState(false);
  const initialized = useRef(false);

  // Important:
  // Do not render the large legacy Telegram console during SSR/hydration.
  // Mount it only after the browser has hydrated this small wrapper.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || initialized.current) return;

    initialized.current = true;

    const cleanup = initTelegramConsole({
      serviceToken,
      apiBase: "/api/telegram",
    });

    return () => {
      if (typeof cleanup === "function") {
        cleanup();
      }
    };
  }, [mounted, serviceToken]);

  // Keep server HTML and the browser's first render identical.
  if (!mounted) {
    return (
      <div
        aria-label="Loading Telegram workspace"
        aria-busy="true"
        style={{ minHeight: "100vh" }}
      />
    );
  }

  return <TelegramConsole integrated />;
}
