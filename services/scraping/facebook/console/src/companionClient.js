import { detectPublishingExtension, publishingExtensionFetch } from "../../../../../lib/publishing-extension-bridge.ts";
import {
  MINIMUM_COMPANION_EXTENSION_VERSION,
  MINIMUM_COMPANION_VERSION,
  versionAtLeast
} from "../../../../../lib/companion-version.js";

const PUBLISHING_SESSION_KEY = "agenticthat-publish-queue-session";
const SCRAPING_SESSION_KEY = "agenticthat-facebook-companion-session";
const JOBS_PATH = "/api/scraping/facebook/jobs";

function savedToken(key) {
  try {
    const session = JSON.parse(window.sessionStorage.getItem(key) || "null");
    if (typeof session?.token !== "string") return "";
    if (key === SCRAPING_SESSION_KEY && Number(session.expiresAt) <= Date.now() + 30_000) return "";
    return session.token;
  } catch { return ""; }
}

async function payload(response) {
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
  if (!(await detectPublishingExtension())) {
    const error = new Error("The AgenticThat Companion extension is not connected.");
    error.code = "extension_unavailable";
    throw error;
  }
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await publishingExtensionFetch(path, { cache: "no-store", ...init, headers });
  if (!response) throw new Error("The AgenticThat Companion extension is not connected.");
  return payload(response);
}

async function accessToken(identityToken, force = false) {
  const publishingToken = savedToken(PUBLISHING_SESSION_KEY);
  if (publishingToken) return publishingToken;
  if (!force) {
    const existing = savedToken(SCRAPING_SESSION_KEY);
    if (existing) return existing;
  }
  if (!identityToken) throw new Error("Refresh AgenticThat and try Local Companion again.");
  const session = await extensionJson("/api/auth/platform/facebook-scraping", {
    method: "POST",
    body: JSON.stringify({ token: identityToken }),
  });
  if (!session?.token) throw new Error("Companion could not create a Facebook scraping session.");
  window.sessionStorage.setItem(SCRAPING_SESSION_KEY, JSON.stringify({
    token: session.token,
    expiresAt: Date.now() + Math.max(300, Number(session.expiresInSeconds) || 7200) * 1000,
  }));
  return session.token;
}

async function companionFetch(path, init = {}, identityToken = "", retry = true) {
  const token = await accessToken(identityToken);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  try { return await extensionJson(path, { ...init, headers }); }
  catch (error) {
    if (retry && error?.status === 401 && !savedToken(PUBLISHING_SESSION_KEY)) {
      window.sessionStorage.removeItem(SCRAPING_SESSION_KEY);
      await accessToken(identityToken, true);
      return companionFetch(path, init, identityToken, false);
    }
    throw error;
  }
}

export async function getFacebookCompanionStatus(identityToken) {
  try {
    const extension = await detectPublishingExtension();
    if (!extension || !versionAtLeast(extension.version, MINIMUM_COMPANION_EXTENSION_VERSION)) {
      return { ready: false, message: `Update the AgenticThat Companion extension to ${MINIMUM_COMPANION_EXTENSION_VERSION} or newer.` };
    }
    const health = await extensionJson("/api/health");
    if (!versionAtLeast(health?.companionVersion, MINIMUM_COMPANION_VERSION)) {
      return { ready: false, message: `Update AgenticThat Companion to ${MINIMUM_COMPANION_VERSION} or newer.` };
    }
    const capability = health?.capabilities?.facebookScraping;
    if (!capability?.available) return { ready: false, message: "Restart Companion to enable Facebook scraping." };
    await accessToken(identityToken);
    return { ready: true, message: capability.activeJobs ? "Companion is busy; your job will be queued." : `Ready on this computer${health?.companionVersion ? ` · v${health.companionVersion}` : ""}` };
  } catch (error) {
    return { ready: false, message: error instanceof Error ? error.message : "Local Companion is unavailable." };
  }
}

export async function runFacebookCompanionJob(jobPayload, onStatus = () => {}, signal, identityToken) {
  const created = await companionFetch(JOBS_PATH, { method: "POST", body: JSON.stringify(jobPayload) }, identityToken);
  const jobId = created?.job?.id;
  if (!jobId) throw new Error("The local Facebook scrape job could not be created.");
  const cancel = () => companionFetch(`${JOBS_PATH}/${encodeURIComponent(jobId)}`, { method: "DELETE" }, identityToken).catch(() => undefined);
  if (signal?.aborted) { await cancel(); throw new Error("Local Facebook scraping was cancelled."); }
  const deadline = Date.now() + 16 * 60_000;
  let current = created;
  let failures = 0;
  while (current?.job?.status !== "complete") {
    if (signal?.aborted) { await cancel(); throw new Error("Local Facebook scraping was cancelled."); }
    if (["failed", "cancelled"].includes(current?.job?.status)) throw new Error(current.job.error?.message || "Local Facebook scraping failed.");
    if (Date.now() >= deadline) { await cancel(); throw new Error("The local Facebook scrape took too long. Try a smaller count or range."); }
    onStatus(current?.job?.progress?.message || "Collecting current public Facebook data");
    await new Promise(resolve => window.setTimeout(resolve, 1_000));
    try {
      current = await companionFetch(`${JOBS_PATH}/${encodeURIComponent(jobId)}`, {}, identityToken);
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= 5) throw error;
      onStatus("Reconnecting to Companion");
    }
  }
  return current;
}
