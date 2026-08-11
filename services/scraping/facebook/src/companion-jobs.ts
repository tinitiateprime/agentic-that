import { randomUUID } from "node:crypto";
import { facebookCompanionDesktopHost } from "./companion-desktop-host.js";
import { FacebookCompanionCancelledError, runFacebookCompanionScrape } from "./companion-runner.js";
import type { FacebookScrapeInput } from "./scraper.js";

type Status = "queued" | "running" | "complete" | "failed" | "cancelled";
type Failure = { code: string; message: string; retryable: boolean };
type Job = {
  id: string;
  ownerKey: string;
  input: FacebookScrapeInput;
  requestedQuery: string;
  status: Status;
  progress: { stage: string; message: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: Awaited<ReturnType<typeof runFacebookCompanionScrape>>;
  error?: Failure;
  controller?: AbortController;
  timedOut?: boolean;
};

const jobs = new Map<string, Job>();
const queue: string[] = [];
let activeJobId: string | null = null;
type Executor = typeof runFacebookCompanionScrape;
let executor: Executor = runFacebookCompanionScrape;
type FacebookCompanionActivityListener = (state: ReturnType<typeof facebookCompanionActivityState>) => void;
const activityListeners = new Set<FacebookCompanionActivityListener>();
let activityNotificationQueued = false;

function activityJob(job: Job, queuePosition: number | null = null) {
  const analysisResultCount = job.result?.analysis
    ? Math.max(
        job.result.analysis.top_viewed.length,
        job.result.analysis.top_reacted.length,
        job.result.analysis.top_discussed.length,
      )
    : 0;
  return {
    id: job.id,
    query: job.requestedQuery,
    collectionMode: job.input.collectionMode || "latest",
    maxResults: Math.max(1, Number(job.input.maxResults) || 10),
    status: job.status,
    progress: { ...job.progress },
    queuePosition,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    resultCount: job.result ? Math.max(job.result.results.length, analysisResultCount) : null,
    discoveryStatus: job.result?.discoveryStatus || null,
    error: job.error ? { ...job.error } : null,
  };
}

export function facebookCompanionActivityState() {
  const activeJob = activeJobId ? jobs.get(activeJobId) : null;
  const queuedJobs = queue.map((jobId, index) => {
    const job = jobs.get(jobId);
    return job ? activityJob(job, index + 1) : null;
  }).filter((job): job is NonNullable<typeof job> => Boolean(job));
  const recentJobs = [...jobs.values()]
    .filter(job => ["complete", "failed", "cancelled"].includes(job.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 12)
    .map(job => activityJob(job));
  return {
    activeJob: activeJob ? activityJob(activeJob) : null,
    queuedJobs,
    recentJobs,
    concurrency: 1,
    updatedAt: new Date().toISOString(),
  };
}

function notifyActivity() {
  if (activityNotificationQueued) return;
  activityNotificationQueued = true;
  queueMicrotask(() => {
    activityNotificationQueued = false;
    const state = facebookCompanionActivityState();
    for (const listener of activityListeners) listener(state);
  });
}

export function subscribeFacebookCompanionActivity(listener: FacebookCompanionActivityListener) {
  activityListeners.add(listener);
  listener(facebookCompanionActivityState());
  return () => activityListeners.delete(listener);
}

function value(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export function prepareFacebookCompanionInput(body: Record<string, unknown>): FacebookScrapeInput {
  const inputMode = (["profile", "keyword", "profile_url", "post_url"] as const)
    .find(mode => mode === value(body.mode || body.inputMode).toLowerCase()) || "profile";
  const query = value(body.query || body.keyword);
  if (!query) throw new Error("Query is required.");
  const profileType = value(body.profile_type || body.profileType) === "public_profile" ? "public_profile" as const : "page" as const;
  const requestedCollection = value(body.collection_mode || body.collectionMode).toLowerCase();
  const selectedCollection = (["latest", "range", "engagement"] as const).find(mode => mode === requestedCollection) || "latest";
  const collectionMode = inputMode === "post_url" ? "latest" as const : selectedCollection;
  if (collectionMode === "engagement" && !["profile", "profile_url"].includes(inputMode)) {
    throw new Error("Profile analysis is available only for a Facebook Page or public profile.");
  }
  const rangeType = (["date", "month", "year"] as const).find(type => type === value(body.range_type || body.rangeType).toLowerCase());
  const rangeFrom = value(body.range_from ?? body.rangeFrom) || undefined;
  const rangeTo = value(body.range_to ?? body.rangeTo) || undefined;
  if (collectionMode === "range" && (!rangeType || !rangeFrom || !rangeTo)) throw new Error("Choose a valid range type, start, and end.");
  return {
    query,
    inputMode,
    profileType,
    maxResults: inputMode === "post_url" ? 1 : Math.max(1, Math.min(50, Number(body.max_results || body.maxResults) || 10)),
    collectionMode,
    recentDays: Math.max(1, Math.min(365, Number(body.recent_days || body.recentDays) || 7)),
    rangeType,
    rangeFrom,
    rangeTo,
    timezoneOffsetMinutes: Math.max(-840, Math.min(840, Number(body.timezone_offset_minutes ?? body.timezoneOffsetMinutes) || 0)),
    skipComments: body.comparison_mode === true || body.skip_comments === true,
  };
}

export function setFacebookCompanionScrapeExecutorForTests(next: Executor | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("The Companion executor can only be replaced in tests.");
  executor = next || runFacebookCompanionScrape;
}

function failure(error: unknown, job: Job): Failure {
  const original = error instanceof Error ? error.message : "Facebook scraping failed.";
  if (job.timedOut) return { code: "timeout", message: "The local Facebook scrape took too long. Try a smaller count or range.", retryable: true };
  if (error instanceof FacebookCompanionCancelledError || job.controller?.signal.aborted) return { code: "cancelled", message: "Facebook scraping was cancelled.", retryable: true };
  if (/Companion.*unavailable|hidden Companion Facebook browser|debugging endpoint/i.test(original)) return { code: "companion_unavailable", message: "Local Companion Facebook scraping is unavailable. Open or restart Companion.", retryable: true };
  if (/login_required|log in|login required/i.test(original)) return { code: "public_access_limited", message: "Facebook did not expose this target to an anonymous public browser. No login session was used.", retryable: false };
  if (/not_found|not found|isn't available/i.test(original)) return { code: "not_found", message: "This Facebook Page, profile, or post was not found.", retryable: false };
  if (/network|timeout|fetch failed|ERR_/i.test(original)) return { code: "network_error", message: "The local network could not load Facebook reliably. Try again.", retryable: true };
  return { code: "scrape_failed", message: original.slice(0, 280), retryable: true };
}

function emptyResultError(job: Job, result: Awaited<ReturnType<typeof runFacebookCompanionScrape>>) {
  const diagnostics = result.diagnostics;
  const target = diagnostics.page_title && !/^Facebook$/i.test(diagnostics.page_title)
    ? diagnostics.page_title
    : job.requestedQuery;
  if (result.discoveryStatus === "login_required") {
    return new Error("Facebook did not expose this target to a public browser. No login session was used.");
  }
  return new Error(
    `Facebook loaded ${target || "the requested profile"}, but no trustworthy current posts matched after ${diagnostics.scroll_rounds} page scans. `
    + "The Companion retried in isolated local browser sessions. Use the exact profile URL and retry.",
  );
}

function publicJob(job: Job) {
  return { id: job.id, engine: "companion", status: job.status, progress: job.progress, createdAt: job.createdAt, updatedAt: job.updatedAt, startedAt: job.startedAt, completedAt: job.completedAt, error: job.error };
}

export function facebookCompanionJobResponse(job: Job) {
  const result = job.result;
  return {
    job: publicJob(job),
    run: result ? { id: job.id, createdAt: job.completedAt, query: result.query, requestedQuery: job.requestedQuery, results: result.results, analysis: result.analysis, discoveryStatus: result.discoveryStatus, diagnostics: result.diagnostics, dataSource: "live" } : null,
    results: result?.results,
    analysis: result?.analysis,
    discoveryStatus: result?.discoveryStatus,
    discovery_status: result?.discoveryStatus,
    diagnostics: result?.diagnostics,
    dataSource: result ? "live" : undefined,
    message: result ? `Scraped ${result.results.length} Facebook posts locally` : undefined,
  };
}

function touch(job: Job) { job.updatedAt = new Date().toISOString(); notifyActivity(); }

async function executeJob(job: Job) {
  const controller = new AbortController();
  job.controller = controller;
  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.progress = { stage: "opening_browser", message: "Opening a private local Facebook browser" };
  touch(job);
  const timeout = setTimeout(() => { job.timedOut = true; controller.abort(); }, 16 * 60_000);
  try {
    const result = await executor(job.id, job.input, controller.signal, () => {
      job.progress = { stage: "scraping", message: "Collecting current public Facebook data" };
      touch(job);
    }, job.ownerKey);
    if (controller.signal.aborted) throw new FacebookCompanionCancelledError();
    job.result = result;
    const hasAnalysisResults = Boolean(
      result.analysis?.top_viewed.length
      || result.analysis?.top_reacted.length
      || result.analysis?.top_discussed.length,
    );
    if (!result.results.length && !hasAnalysisResults && result.discoveryStatus !== "not_found") {
      console.warn("Facebook Companion scrape produced no usable results", JSON.stringify({
        query: job.requestedQuery,
        status: result.discoveryStatus,
        diagnostics: result.diagnostics,
      }));
      throw emptyResultError(job, result);
    }
    job.progress = { stage: "preparing_results", message: "Preparing fresh Facebook results" };
    touch(job);
    job.status = "complete";
    const resultCount = Math.max(
      result.results.length,
      result.analysis?.top_viewed.length || 0,
      result.analysis?.top_reacted.length || 0,
      result.analysis?.top_discussed.length || 0,
    );
    job.progress = { stage: "complete", message: `Collected ${resultCount} public Facebook posts` };
  } catch (error) {
    console.warn("Facebook Companion job failed", JSON.stringify({
      query: job.requestedQuery,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }));
    job.error = failure(error, job);
    job.status = job.error.code === "cancelled" ? "cancelled" : "failed";
  } finally {
    clearTimeout(timeout);
    job.controller = undefined;
    job.completedAt = new Date().toISOString();
    touch(job);
  }
}

async function pump() {
  if (activeJobId) return;
  const nextId = queue.shift();
  if (!nextId) return;
  const job = jobs.get(nextId);
  if (!job || job.status !== "queued") { queueMicrotask(() => void pump()); return; }
  activeJobId = job.id;
  try { await executeJob(job); }
  finally {
    activeJobId = null;
    const terminal = [...jobs.values()].filter(item => ["complete", "failed", "cancelled"].includes(item.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const item of terminal.slice(50)) jobs.delete(item.id);
    notifyActivity();
    queueMicrotask(() => void pump());
  }
}

export function createFacebookCompanionJob(ownerKey: string, body: Record<string, unknown>) {
  if (!facebookCompanionDesktopHost()) throw new Error("Local Companion Facebook scraping is unavailable. Open or restart AgenticThat Publishing Companion.");
  const input = prepareFacebookCompanionInput(body);
  const now = new Date().toISOString();
  const job: Job = { id: `fscrape_${randomUUID()}`, ownerKey, input, requestedQuery: input.query, status: "queued", progress: { stage: "queued", message: "Waiting for the local Facebook browser" }, createdAt: now, updatedAt: now };
  jobs.set(job.id, job);
  queue.push(job.id);
  notifyActivity();
  queueMicrotask(() => void pump());
  return facebookCompanionJobResponse(job);
}

export function getFacebookCompanionJob(ownerKey: string, jobId: string) {
  const job = jobs.get(jobId);
  return job?.ownerKey === ownerKey ? facebookCompanionJobResponse(job) : null;
}

export async function cancelFacebookCompanionJob(ownerKey: string, jobId: string) {
  const job = jobs.get(jobId);
  if (!job || job.ownerKey !== ownerKey) return null;
  if (job.status === "queued") {
    const index = queue.indexOf(job.id);
    if (index >= 0) queue.splice(index, 1);
    job.status = "cancelled";
    job.error = { code: "cancelled", message: "Facebook scraping was cancelled.", retryable: true };
    job.completedAt = new Date().toISOString();
    touch(job);
  } else if (job.status === "running") {
    job.controller?.abort();
  }
  return facebookCompanionJobResponse(job);
}

export async function cancelAllFacebookCompanionJobs(reason = "Facebook scraping was cancelled.") {
  let cancelled = false;
  for (const job of jobs.values()) {
    if (job.status === "queued") {
      job.status = "cancelled";
      job.error = { code: "cancelled", message: reason, retryable: true };
      job.completedAt = new Date().toISOString();
      touch(job);
      cancelled = true;
    } else if (job.status === "running") { job.controller?.abort(); cancelled = true; }
  }
  queue.splice(0);
  notifyActivity();
  await Promise.resolve(facebookCompanionDesktopHost()?.stopBrowsers(reason)).catch(() => undefined);
  return cancelled;
}

export function facebookCompanionQueueHealth() {
  return { available: Boolean(facebookCompanionDesktopHost()), activeJobs: activeJobId ? 1 : 0, queuedJobs: queue.length, concurrency: 1 };
}
