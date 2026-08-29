import {
  detectPublishingExtension,
  publishingExtensionFetch
} from "../../../../../lib/publishing-extension-bridge.ts";
import {
  MINIMUM_COMPANION_EXTENSION_VERSION,
  MINIMUM_COMPANION_VERSION,
  versionAtLeast
} from "../../../../../lib/companion-version.js";
import { getClientServiceToken } from "../../../../../src/platform/client-service-token.js";

const JOBS_PATH = "/api/scraping/instagram/jobs";

async function responsePayload(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Local Companion request failed (${response.status}).`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

async function extensionJson(path, init = {}) {
  const extension = await detectPublishingExtension();
  if (!extension) {
    const error = new Error("The AgenticThat Companion extension is not connected.");
    error.code = "extension_unavailable";
    throw error;
  }
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await publishingExtensionFetch(path, {
    cache: "no-store",
    ...init,
    headers
  });
  if (!response) throw new Error("The AgenticThat Companion extension is not connected.");
  return responsePayload(response);
}

async function scrapingAccessToken(publishingIdentityToken, force = false) {
  if (!publishingIdentityToken) {
    throw new Error("Refresh AgenticThat and try Local Companion again.");
  }
  return getClientServiceToken("scraping", publishingIdentityToken, force);
}

async function companionFetch(path, init = {}, publishingIdentityToken = "", retry = true) {
  const token = await scrapingAccessToken(publishingIdentityToken);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  try {
    return await extensionJson(path, { ...init, headers });
  } catch (error) {
    if (retry && error?.status === 401) {
      await scrapingAccessToken(publishingIdentityToken, true);
      return companionFetch(path, init, publishingIdentityToken, false);
    }
    throw error;
  }
}

export async function getInstagramCompanionStatus(publishingIdentityToken) {
  try {
    const extension = await detectPublishingExtension();
    if (!extension || !versionAtLeast(extension.version, MINIMUM_COMPANION_EXTENSION_VERSION)) {
      return { ready: false, message: `Update the AgenticThat Companion extension to ${MINIMUM_COMPANION_EXTENSION_VERSION} or newer.` };
    }
    const health = await extensionJson("/api/health");
    if (!versionAtLeast(health?.companionVersion, MINIMUM_COMPANION_VERSION)) {
      return { ready: false, message: `Update AgenticThat Companion to ${MINIMUM_COMPANION_VERSION} or newer.` };
    }
    const capability = health?.capabilities?.instagramScraping;
    if (!capability?.available) {
      return { ready: false, message: "Restart Companion to enable local scraping." };
    }
    await scrapingAccessToken(publishingIdentityToken);
    return {
      ready: true,
      message: capability.activeJobs ? "Companion is busy; your job will be queued." : `Ready on this computer${health?.companionVersion ? ` · v${health.companionVersion}` : ""}`
    };
  } catch (error) {
    return {
      ready: false,
      message: error instanceof Error ? error.message : "Local Companion is unavailable."
    };
  }
}

export async function runInstagramCompanionJob(payload, onStatus = () => {}, signal, publishingIdentityToken) {
  const created = await companionFetch(JOBS_PATH, {
    method: "POST",
    body: JSON.stringify(payload)
  }, publishingIdentityToken);
  const jobId = created?.job?.id;
  if (!jobId) throw new Error("The local scrape job could not be created.");

  const cancelJob = () => companionFetch(`${JOBS_PATH}/${encodeURIComponent(jobId)}`, {
    method: "DELETE"
  }, publishingIdentityToken).catch(() => {});
  if (signal?.aborted) {
    await cancelJob();
    throw new Error("Local Instagram scraping was cancelled.");
  }

  const deadline = Date.now() + 16 * 60_000;
  let consecutiveFailures = 0;
  let current = created;
  while (current?.job?.status !== "complete") {
    if (signal?.aborted) {
      await cancelJob();
      throw new Error("Local Instagram scraping was cancelled.");
    }
    const status = current?.job?.status;
    if (status === "failed" || status === "cancelled") {
      throw new Error(current.job.error?.message || "Local Instagram scraping failed.");
    }
    if (Date.now() >= deadline) {
      await cancelJob();
      throw new Error("The local scrape took too long. Try a smaller count or range.");
    }
    onStatus(current?.job?.progress?.message || (status === "queued"
      ? "Waiting for the local scraper"
      : "Collecting current public data"));
    await new Promise(resolve => window.setTimeout(resolve, 1_000));
    try {
      current = await companionFetch(`${JOBS_PATH}/${encodeURIComponent(jobId)}`, {}, publishingIdentityToken);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 5) throw error;
      onStatus("Reconnecting to Companion");
    }
  }
  return current;
}
