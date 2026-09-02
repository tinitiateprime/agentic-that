import { getClientServiceToken } from "../../../../../src/platform/client-service-token.js";

const CONTROL_PATH = "/api/job-control/scraping/facebook";

async function controlFetch(path, init = {}, identityToken = "", retry = true) {
  const token = await getClientServiceToken("scraping", identityToken, !retry);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${CONTROL_PATH}${path}`, { cache: "no-store", credentials: "same-origin", ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && retry) return controlFetch(path, init, identityToken, false);
    const error = new Error(data.message || `Companion job control failed (${response.status}).`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export async function getFacebookCompanionStatus(identityToken) {
  try {
    const status = await controlFetch("/status", {}, identityToken);
    return {
      ready: Boolean(status.companion),
      message: status.companion ? status.message : "Pair a desktop Companion once. Jobs can then be sent from any device.",
    };
  } catch (error) {
    return { ready: false, message: error instanceof Error ? error.message : "Companion job control is unavailable." };
  }
}

export async function listFacebookCompanionRuns(identityToken) {
  return controlFetch("/runs", {}, identityToken);
}

export async function runFacebookCompanionJob(payload, onStatus = () => {}, signal, identityToken) {
  const created = await controlFetch("/jobs", {
    method: "POST",
    headers: { "idempotency-key": `facebook:${crypto.randomUUID()}` },
    body: JSON.stringify(payload),
  }, identityToken);
  const jobId = created?.job?.id;
  if (!jobId) throw new Error("The Facebook scrape job could not be queued.");
  const cancel = () => controlFetch(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }, identityToken).catch(() => {});
  if (signal?.aborted) { await cancel(); throw new Error("Facebook scraping was cancelled."); }
  const abort = () => { void cancel(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const deadline = Date.now() + 24 * 60 * 60_000;
    let failures = 0;
    let current = created;
    while (current?.job?.status !== "complete") {
      if (signal?.aborted) throw new Error("Facebook scraping was cancelled.");
      if (["failed", "cancelled"].includes(current?.job?.status)) throw new Error(current.job.error?.message || "Facebook scraping did not complete.");
      if (Date.now() >= deadline) throw new Error("The job is still safely queued. Reopen this page later to view its result.");
      onStatus(current?.job?.progress?.message || (current?.job?.status === "queued" ? "Safely queued for the paired Companion" : "Collecting current Facebook data"));
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      try {
        current = await controlFetch(`/jobs/${encodeURIComponent(jobId)}`, {}, identityToken);
        failures = 0;
      } catch (error) {
        failures += 1;
        if (failures >= 8) throw error;
        onStatus("Reconnecting to job control");
      }
    }
    return current;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
