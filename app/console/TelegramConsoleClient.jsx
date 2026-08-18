"use client";

import { useEffect, useRef } from "react";
import { TelegramConsole } from "@telegram/console/src/TelegramConsole";
import { initTelegramConsole } from "@telegram/console/src/telegram-controller";

export default function TelegramConsoleClient({ serviceToken }) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    initTelegramConsole({ serviceToken, apiBase: "/api/telegram" });
  }, [serviceToken]);

  return <TelegramConsole />;
}
