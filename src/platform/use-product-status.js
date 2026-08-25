"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getClientServiceToken } from "./client-service-token";

const PUBLISH_ACCOUNT_SUMMARY_KEY = "agenticthat-publish-account-summary";

function readJson(key, fallback) {
  try {
    return JSON.parse(window.sessionStorage.getItem(key) || "null") || fallback;
  } catch {
    return fallback;
  }
}

async function jsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.message || "Unable to check service status");
    error.status = response.status;
    throw error;
  }
  return data;
}

function summarizePublishingAccounts(accounts) {
  return Array.isArray(accounts)
    ? accounts.map(({ workspaceId, platform, displayName, handle, enabled, credentialConfigured }) => ({
        workspaceId,
        platform,
        displayName,
        handle,
        enabled: Boolean(enabled),
        credentialConfigured: Boolean(credentialConfigured),
      }))
    : [];
}

async function loadPublishingAccounts() {
  const headers = new Headers();
  headers.set("authorization", "Bearer " + await getClientServiceToken("publishing"));
  const response = await fetch("/api/automation-server/accounts", {
    cache: "no-store",
    headers,
    credentials: "include",
  });
  const data = await jsonResponse(response);
  return (data.accounts || []).map((account) => ({
    ...account,
    handle: account.status === "CONNECTED" ? "Persistent server session" : "Login required",
    credentialConfigured: account.status === "CONNECTED",
  }));
}

async function loadTelegram(path) {
  const headers = new Headers();
  headers.set("authorization", "Bearer " + await getClientServiceToken("telegram"));
  const response = await fetch("/api/telegram" + path, {
    cache: "no-store",
    headers,
    credentials: "include",
  });
  return jsonResponse(response);
}

export function useProductStatus() {
  const [whatsapp, setWhatsapp] = useState({ state: "checking" });
  const [telegram, setTelegram] = useState({ state: "checking", accounts: 0 });
  const [publishing, setPublishing] = useState({ state: "checking" });
  const [publishingAccounts, setPublishingAccounts] = useState([]);

  const refresh = useCallback(async () => {
    setWhatsapp({ state: "checking" });
    setTelegram({ state: "checking", accounts: 0 });

    const cachedAccounts = summarizePublishingAccounts(readJson(PUBLISH_ACCOUNT_SUMMARY_KEY, []));
    setPublishingAccounts(cachedAccounts);
    setPublishing({ state: cachedAccounts.length ? "ready" : "checking" });

    void loadPublishingAccounts()
      .then((accounts) => {
        const accountList = summarizePublishingAccounts(accounts);
        rememberPublishingAccounts(accountList);
        setPublishingAccounts(accountList);
        setPublishing({ state: "ready" });
      })
      .catch(() => {
        setPublishing({ state: cachedAccounts.length ? "ready" : "setup" });
      });

    void fetch("/api/apps/status", { cache: "no-store", credentials: "include" })
      .then(jsonResponse)
      .then((data) => {
        const service = data.whatsapp || {};
        setWhatsapp({
          state: service.connected ? (service.onboarded ? "connected" : "continue") : "setup",
          provider: service.provider,
          senderCount: service.senderCount || 0,
        });
      })
      .catch(() => setWhatsapp({ state: "setup" }));

    void loadTelegram("/me")
      .then(() => loadTelegram("/telegram/accounts"))
      .then((data) => {
        const count = Array.isArray(data.accounts) ? data.accounts.length : 0;
        setTelegram({ state: count ? "connected" : "setup", accounts: count });
      })
      .catch(() => setTelegram({ state: "setup", accounts: 0 }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const statusFor = useCallback((service) => {
    if (service.availability !== "live" || service.connectionKind === "unavailable") {
      return { state: "coming-soon", label: "Coming soon" };
    }
    if (service.connectionKind === "none") return { state: "ready", label: "Ready to use" };
    if (service.connectionKind === "whatsapp") {
      if (whatsapp.state === "connected") {
        const detail = whatsapp.provider === "wati" ? "WATI connected" : `${whatsapp.senderCount || 1} sender${whatsapp.senderCount === 1 ? "" : "s"}`;
        return { ...whatsapp, label: "Connected", detail };
      }
      if (whatsapp.state === "continue") return { ...whatsapp, label: "Continue setup" };
      if (whatsapp.state === "checking") return { ...whatsapp, label: "Checking" };
      return { ...whatsapp, label: "Setup required" };
    }
    if (service.connectionKind === "telegram") {
      if (telegram.state === "connected") {
        return { ...telegram, label: "Connected", detail: `${telegram.accounts} account${telegram.accounts === 1 ? "" : "s"}` };
      }
      if (telegram.state === "checking") return { ...telegram, label: "Checking" };
      return { ...telegram, label: "Setup required" };
    }
    if (service.connectionKind === "publishing") {
      const account = publishingAccounts.find((item) => item.platform === service.platform && item.enabled && item.credentialConfigured);
      if (!account && publishing.state === "checking") return { state: "checking", label: "Checking" };
      return account
        ? { state: "connected", label: "Connected", detail: account.displayName || account.handle || "Login ready" }
        : { state: "setup", label: "Setup required" };
    }
    return { state: "setup", label: "Setup required" };
  }, [publishing, publishingAccounts, telegram, whatsapp]);

  const summary = useMemo(() => ({ whatsapp, telegram, publishing, publishingAccounts }), [publishing, publishingAccounts, telegram, whatsapp]);
  return { statusFor, refresh, summary };
}

export function rememberPublishingAccounts(accounts) {
  if (typeof window === "undefined") return;
  const summary = summarizePublishingAccounts(accounts);
  window.sessionStorage.setItem(PUBLISH_ACCOUNT_SUMMARY_KEY, JSON.stringify(summary));
}
