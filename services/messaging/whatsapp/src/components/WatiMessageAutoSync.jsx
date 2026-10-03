"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const SYNC_INTERVAL_MS = 60_000;

// Webhooks remain the real-time source. This bounded poll is a recovery path
// while an operator has the CRM open, and never overlaps its own requests.
export default function WatiMessageAutoSync() {
  const router = useRouter();
  const running = useRef(false);
  const nextOffset = useRef(0);
  const [status, setStatus] = useState("Checking WATI…");

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      if (cancelled || running.current || document.visibilityState === "hidden") return;
      running.current = true;
      try {
        const response = await fetch("/api/wati/messages/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset: nextOffset.current }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "WATI sync failed");
        if (cancelled) return;
        nextOffset.current = Number(data.nextOffset) || 0;
        const changes = Number(data.importedMessages || 0) + Number(data.updatedMessages || 0);
        if (changes > 0) {
          setStatus(`${changes} WATI message${changes === 1 ? "" : "s"} updated`);
          router.refresh();
        } else {
          setStatus(data.remaining ? `WATI sync on · ${data.remaining} contacts remaining` : "WATI auto-sync on");
        }
      } catch (error) {
        if (!cancelled) setStatus(error.message || "WATI sync unavailable");
      } finally {
        running.current = false;
      }
    }

    const initial = window.setTimeout(sync, 750);
    const interval = window.setInterval(sync, SYNC_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs text-sky-700"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
      {status}
    </span>
  );
}
