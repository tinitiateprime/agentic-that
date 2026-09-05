"use client";

import { useCallback, useEffect, useState } from "react";

const COMPANION_STATUS_KEY = "agenticthat-companion-status";
const COMPANION_HEALTH_URL = "http://127.0.0.1:8792/api/health";
const FRESH_FOR_MS = 60_000;
const PROBE_TIMEOUT_MS = 2500;

export const companionDownloadUrl = process.env.NEXT_PUBLIC_PUBLISHING_COMPANION_DOWNLOAD_URL?.trim()
  || "/companion/download";

function readCache() {
  try {
    const cached = JSON.parse(window.sessionStorage.getItem(COMPANION_STATUS_KEY) || "null");
    if (!cached || typeof cached.checkedAt !== "number") return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCache(value) {
  try {
    window.sessionStorage.setItem(COMPANION_STATUS_KEY, JSON.stringify({ ...value, checkedAt: Date.now() }));
  } catch {
    // Session storage is unavailable in private windows; probing still works.
  }
}

// Several surfaces mount this hook at once; one probe serves all of them.
let inFlightProbe = null;

/**
 * Probes the Companion running on this device. `targetAddressSpace` opts the request
 * into Chrome's private network access rules, matching how Connections pairs a device.
 */
function probeCompanion() {
  inFlightProbe = inFlightProbe || requestHealth().finally(() => { inFlightProbe = null; });
  return inFlightProbe;
}

async function requestHealth() {
  try {
    const response = await fetch(COMPANION_HEALTH_URL, {
      cache: "no-store",
      mode: "cors",
      targetAddressSpace: "loopback",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { state: "missing" };
    const health = await response.json();
    return {
      state: "connected",
      version: typeof health?.version === "string" ? health.version : "",
      automationReady: Boolean(health?.automationReady),
    };
  } catch {
    return { state: "missing" };
  }
}

/**
 * Reports whether AgenticThat Companion is installed and running on this device so every
 * workspace surface can offer the download when it is not. Returns "checking" until the
 * first probe settles, so nothing flashes on screen for people who already have it.
 */
export function useCompanionStatus() {
  const [status, setStatus] = useState({ state: "checking" });

  const refresh = useCallback(async (options = {}) => {
    const cached = readCache();
    if (cached && !options.force && Date.now() - cached.checkedAt < FRESH_FOR_MS) {
      setStatus(cached);
      return cached;
    }
    if (cached) setStatus(cached);
    const result = await probeCompanion();
    writeCache(result);
    setStatus(result);
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refresh().then(() => {
      if (cancelled) return;
    });
    const onFocus = () => { void refresh({ force: true }); };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { status, refresh };
}
