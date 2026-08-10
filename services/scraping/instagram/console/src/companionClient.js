import {
  detectPublishingExtension,
  publishingExtensionFetch
} from "../../../../../lib/publishing-extension-bridge.ts";

const SESSION_KEY = "agenticthat-publish-queue-session";
const JOBS_PATH = "/api/scraping/instagram/jobs";

function readCompanionToken() {
  try {
    const session = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "null");
    return typeof session?.token === "string" ? session.token : "";
  } catch {
    return "";
  }
}

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

async function companionFetch(path, init = {}, requireSession = true) {
  const extension = await detectPublishingExtension();
  if (!extension) {
    const error = new Error("The AgenticThat Companion extension is not connected.");
    error.code = "extension_unavailable";
    throw error;
  }
  const token = requireSession ? readCompanionToken() : "";
  if (requireSession && !token) {
    const error = new Error("Connect to Companion in Connections first, then return here.");
    error.code = "companion_sign_in_required";
    throw error;
  }
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await publishingExtensionFetch(path, {
    cache: "no-store",
    ...init,
    headers
  });
  if (!response) throw new Error("The AgenticThat Companion extension is not connected.");
  return responsePayload(response);
}

export async function getInstagramCompanionStatus() {
  try {
    const health = await companionFetch("/api/health", {}, false);
    const capability = health?.capabilities?.instagramScraping;
    if (!capability?.available) {
      return { ready: false, message: "Restart Companion to enable local scraping." };
    }
    if (!readCompanionToken()) {
      return { ready: false, message: "Connect to Companion in Connections first." };
    }
    return {
      ready: true,
      message: capability.activeJobs ? "Local scraper is busy; your job will be queued." : "Ready on this computer"
    };
  } catch (error) {
    return {
      ready: false,
      message: error instanceof Error ? error.message : "Local Companion is unavailable."
    };
  }
}

export async function runInstagramCompanionJob(payload, onStatus = () => {}, signal) {
  const created = await companionFetch(JOBS_PATH, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const jobId = created?.job?.id;
  if (!jobId) throw new Error("The local scrape job could not be created.");

  const cancelJob = () => companionFetch(`${JOBS_PATH}/${encodeURIComponent(jobId)}`, {
    method: "DELETE"
  }).catch(() => {});
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
      current = await companionFetch(`${JOBS_PATH}/${encodeURIComponent(jobId)}`);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 5) throw error;
      onStatus("Reconnecting to Companion");
    }
  }
  return current;
}
