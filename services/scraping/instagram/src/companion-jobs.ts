import { randomUUID } from "node:crypto";
import { runInstagramCompanionScrape, InstagramCompanionCancelledError } from "./companion-runner.js";
import { instagramCompanionDesktopHost } from "./companion-desktop-host.js";
import { instagramScrapeRange, type InstagramScrapeInput } from "./scraper.js";
import { runCompanionScrapingTask } from "../../companion-resource-scheduler.js";
import { loadCompanionJobs, persistCompanionJobs } from "../../companion-job-persistence.js";

export type InstagramCompanionJobStatus = "queued" | "running" | "complete" | "failed" | "cancelled";
export type InstagramCompanionFailureCode =
  | "companion_unavailable"
  | "cancelled"
  | "timeout"
  | "instagram_login_required"
  | "profile_not_found"
  | "instagram_temporarily_unavailable"
  | "network_error"
  | "scrape_failed";

export type InstagramCompanionFailure = {
  code: InstagramCompanionFailureCode;
  message: string;
  retryable: boolean;
};

type CompanionJob = {
  id: string;
  ownerKey: string;
  input: InstagramScrapeInput;
  requestedQuery: string;
  status: InstagramCompanionJobStatus;
  progress: {
    stage: "queued" | "opening_browser" | "scraping" | "preparing_results" | "complete";
    message: string;
  };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: Awaited<ReturnType<typeof runInstagramCompanionScrape>>;
  error?: InstagramCompanionFailure;
  controller?: AbortController;
  queueController?: AbortController;
  timedOut?: boolean;
};

const jobs = new Map<string, CompanionJob>();
const queue: string[] = [];
let activeJobId: string | null = null;
type CompanionScrapeExecutor = typeof runInstagramCompanionScrape;
let companionScrapeExecutor: CompanionScrapeExecutor = runInstagramCompanionScrape;
type InstagramCompanionActivityListener = (state: ReturnType<typeof instagramCompanionActivityState>) => void;
const activityListeners = new Set<InstagramCompanionActivityListener>();
let activityNotificationQueued = false;

function persistJobs() {
  const records = [...jobs.values()].map(({ controller, queueController, timedOut, ...job }) => job);
  try {
    persistCompanionJobs("instagram", records);
  } catch (error) {
    console.warn("Could not persist the Instagram Companion queue:", error instanceof Error ? error.message : error);
  }
}

function restoreJobs() {
  const validStatuses = new Set<InstagramCompanionJobStatus>(["queued", "running", "complete", "failed", "cancelled"]);
  for (const record of loadCompanionJobs("instagram")) {
    if (!record.id || !record.ownerKey || !record.input || !validStatuses.has(record.status as InstagramCompanionJobStatus)) continue;
    const job = record as unknown as CompanionJob;
    if (job.status === "running") {
      job.status = "queued";
      job.startedAt = undefined;
      job.completedAt = undefined;
      job.error = undefined;
      job.progress = { stage: "queued", message: "Recovered safely after Companion restarted" };
      job.updatedAt = new Date().toISOString();
    }
    jobs.set(job.id, job);
    if (job.status === "queued") queue.push(job.id);
  }
  if (jobs.size) persistJobs();
  if (queue.length) queueMicrotask(() => { void pumpQueue(); });
}

function companionActivityJob(job: CompanionJob, queuePosition: number | null = null) {
  const input = {
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
    resultCount: job.result?.results.length ?? null,
    discoveryStatus: job.result?.discoveryStatus || null,
    error: job.error ? { ...job.error } : null,
  };
  return input;
}

export function instagramCompanionActivityState() {
  const activeJob = activeJobId ? jobs.get(activeJobId) : null;
  const queuedJobs = queue
    .map((jobId, index) => {
      const job = jobs.get(jobId);
      return job ? companionActivityJob(job, index + 1) : null;
    })
    .filter((job): job is NonNullable<typeof job> => Boolean(job));
  const recentJobs = [...jobs.values()]
    .filter(job => ["complete", "failed", "cancelled"].includes(job.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 12)
    .map(job => companionActivityJob(job));
  return {
    activeJob: activeJob ? companionActivityJob(activeJob) : null,
    queuedJobs,
    recentJobs,
    concurrency: 1,
    updatedAt: new Date().toISOString(),
  };
}

function notifyInstagramCompanionActivity() {
  if (activityNotificationQueued) return;
  activityNotificationQueued = true;
  queueMicrotask(() => {
    activityNotificationQueued = false;
    const state = instagramCompanionActivityState();
    for (const listener of activityListeners) listener(state);
  });
}

export function subscribeInstagramCompanionActivity(listener: InstagramCompanionActivityListener) {
  activityListeners.add(listener);
  listener(instagramCompanionActivityState());
  return () => activityListeners.delete(listener);
}

export function setInstagramCompanionScrapeExecutorForTests(executor: CompanionScrapeExecutor | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("The Companion scrape executor can only be replaced in tests.");
  companionScrapeExecutor = executor ?? runInstagramCompanionScrape;
}

function instagramUrlType(value: string) {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    const pathname = url.pathname.replace(/\/+$/, "");
    if (/^\/(?:p|reel)\/[^/]+$/i.test(pathname)) return "post";
    if (/^\/[A-Za-z0-9._]+$/.test(pathname)) return "profile";
    return null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function prepareInstagramCompanionInput(body: Record<string, unknown>): InstagramScrapeInput {
  const requestedMode = stringValue(body.mode || body.inputMode).toLowerCase();
  let query = stringValue(body.query || body.keyword);
  if (requestedMode === "keyword" && query && !query.startsWith("#")) query = `#${query}`;
  if (!query) throw new Error("Query is required.");

  const urlType = instagramUrlType(query);
  if (requestedMode === "profile_url" && urlType !== "profile") {
    throw new Error("Enter an Instagram profile URL, not a post or reel URL.");
  }
  if (requestedMode === "post_url" && urlType !== "post") {
    throw new Error("Enter an Instagram post or reel URL.");
  }

  const singlePost = requestedMode === "post_url";
  const requestedCollectionMode = stringValue(body.collection_mode || body.collectionMode).toLowerCase();
  const selectedCollectionMode = (["latest", "range", "engagement"] as const)
    .find(value => value === requestedCollectionMode) || "latest";
  const collectionMode = singlePost ? "latest" as const : selectedCollectionMode;
  if (collectionMode === "engagement" && !["profile", "profile_url", "url"].includes(requestedMode)) {
    throw new Error("Profile analysis is available only for Profile and Profile URL.");
  }

  const requestedRangeType = stringValue(body.range_type || body.rangeType).toLowerCase();
  const rangeType = (["date", "month", "year"] as const).find(value => value === requestedRangeType);
  const rangeFrom = stringValue(body.range_from ?? body.rangeFrom) || undefined;
  const rangeTo = stringValue(body.range_to ?? body.rangeTo) || undefined;
  if (collectionMode === "range" && (!rangeType || !rangeFrom || !rangeTo)) {
    throw new Error("Choose a valid range type, start, and end.");
  }

  const recentDays = Math.max(1, Math.min(365, Number(body.recent_days || body.recentDays) || 7));
  const input: InstagramScrapeInput = {
    query,
    maxResults: singlePost ? 1 : Math.max(1, Math.min(50, Number(body.max_results || body.maxResults) || 10)),
    collectionMode,
    recentDays,
    onlyPostsNewerThan: stringValue(body.only_posts_newer_than ?? body.onlyPostsNewerThan) || undefined,
    autoExpandDays: typeof (body.auto_expand_days ?? body.autoExpandDays) === "boolean"
      ? Boolean(body.auto_expand_days ?? body.autoExpandDays)
      : false,
    maxAutoExpandDays: Math.max(1, Number(body.max_auto_expand_days || body.maxAutoExpandDays) || recentDays),
    rangeType,
    rangeFrom,
    rangeTo,
    timezoneOffsetMinutes: Math.max(
      -840,
      Math.min(840, Number(body.timezone_offset_minutes ?? body.timezoneOffsetMinutes) || 0),
    ),
    sortBy: collectionMode === "engagement" ? "engagement" : "recent",
  };
  if (collectionMode === "range") instagramScrapeRange(input);
  return input;
}

function failureFor(error: unknown, job: CompanionJob): InstagramCompanionFailure {
  const original = error instanceof Error ? error.message : "Instagram scraping failed.";
  if (job.timedOut) {
    return { code: "timeout", message: "The local scrape took too long. Try a smaller count or range.", retryable: true };
  }
  if (error instanceof InstagramCompanionCancelledError || job.controller?.signal.aborted) {
    return { code: "cancelled", message: "Instagram scraping was cancelled.", retryable: true };
  }
  if (/Companion scraping is unavailable|hidden Companion scraping browser|debugging endpoint/i.test(original)) {
    return {
      code: "companion_unavailable",
      message: "Local Companion scraping is unavailable. Open or restart AgenticThat Publishing Companion.",
      retryable: true,
    };
  }
  if (/login_required|login required|log in/i.test(original)) {
    return { code: "instagram_login_required", message: "Instagram is requiring a login for this public page.", retryable: false };
  }
  if (/not_found|not found|does not exist/i.test(original)) {
    return { code: "profile_not_found", message: "This public Instagram profile or post was not found.", retryable: false };
  }
  if (/fetch failed|network|timeout|aborted|ERR_/i.test(original)) {
    return { code: "network_error", message: "The local network could not load Instagram reliably. Try again.", retryable: true };
  }
  if (/temporarily_unavailable|temporarily unavailable|rate.?limit|429|checkpoint/i.test(original)) {
    return {
      code: "instagram_temporarily_unavailable",
      message: "Instagram temporarily refused public discovery. Wait briefly, then try again.",
      retryable: true,
    };
  }
  return {
    code: "scrape_failed",
    message: original.length > 280 ? `${original.slice(0, 277)}...` : original,
    retryable: true,
  };
}

function publicJob(job: CompanionJob) {
  return {
    id: job.id,
    engine: "companion" as const,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
  };
}

export function instagramCompanionJobResponse(job: CompanionJob) {
  const result = job.result;
  return {
    job: publicJob(job),
    run: result ? {
      id: job.id,
      createdAt: job.completedAt,
      query: result.query,
      requestedQuery: job.requestedQuery,
      results: result.results,
      analysis: result.analysis,
      discoveryStatus: result.discoveryStatus,
      diagnostics: result.diagnostics,
      dataSource: "live" as const,
    } : null,
    results: result?.results,
    analysis: result?.analysis,
    discoveryStatus: result?.discoveryStatus,
    discovery_status: result?.discoveryStatus,
    diagnostics: result?.diagnostics,
    dataSource: result ? "live" as const : undefined,
    message: result ? `Scraped ${result.results.length} posts locally` : undefined,
  };
}

function touch(job: CompanionJob) {
  job.updatedAt = new Date().toISOString();
  persistJobs();
  notifyInstagramCompanionActivity();
}

function pruneJobs() {
  const terminal = [...jobs.values()]
    .filter(job => ["complete", "failed", "cancelled"].includes(job.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  for (const job of terminal.slice(50)) jobs.delete(job.id);
  persistJobs();
}

async function executeJob(job: CompanionJob) {
  const controller = new AbortController();
  job.controller = controller;
  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.progress = { stage: "opening_browser", message: "Opening a private local browser" };
  touch(job);
  const timeout = setTimeout(() => {
    job.timedOut = true;
    controller.abort();
  }, 16 * 60_000);

  try {
    const result = await companionScrapeExecutor(job.id, job.input, controller.signal, () => {
      if (controller.signal.aborted) return;
      job.progress = { stage: "scraping", message: "Collecting current public Instagram data" };
      touch(job);
    });
    if (controller.signal.aborted) throw new InstagramCompanionCancelledError();
    if (!result.results.length && result.discoveryStatus !== "not_found") {
      throw new Error(result.discoveryStatus || "temporarily_unavailable");
    }
    job.progress = { stage: "preparing_results", message: "Preparing fresh results" };
    touch(job);
    job.result = result;
    job.status = "complete";
    job.progress = { stage: "complete", message: `Collected ${result.results.length} public posts` };
  } catch (error) {
    job.error = failureFor(error, job);
    job.status = job.error.code === "cancelled" ? "cancelled" : "failed";
  } finally {
    clearTimeout(timeout);
    job.controller = undefined;
    job.completedAt = new Date().toISOString();
    touch(job);
  }
}

async function pumpQueue() {
  if (activeJobId) return;
  const nextId = queue.shift();
  if (!nextId) return;
  const job = jobs.get(nextId);
  if (!job || job.status !== "queued") {
    queueMicrotask(() => { void pumpQueue(); });
    return;
  }
  activeJobId = job.id;
  const queueController = new AbortController();
  job.queueController = queueController;
  try {
    await runCompanionScrapingTask("instagram", job.id, async () => {
      job.queueController = undefined;
      if (job.status !== "queued") return;
      await executeJob(job);
    }, queueController.signal);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
  } finally {
    job.queueController = undefined;
    activeJobId = null;
    pruneJobs();
    notifyInstagramCompanionActivity();
    queueMicrotask(() => { void pumpQueue(); });
  }
}

export function createInstagramCompanionJob(ownerKey: string, body: Record<string, unknown>) {
  if (!instagramCompanionDesktopHost()) {
    throw new Error("Local Companion scraping is unavailable. Open or restart AgenticThat Publishing Companion.");
  }
  const input = prepareInstagramCompanionInput(body);
  const now = new Date().toISOString();
  const job: CompanionJob = {
    id: `iscrape_${randomUUID()}`,
    ownerKey,
    input,
    requestedQuery: input.query,
    status: "queued",
    progress: { stage: "queued", message: "Waiting for the local scraping browser" },
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  persistJobs();
  notifyInstagramCompanionActivity();
  queueMicrotask(() => { void pumpQueue(); });
  return instagramCompanionJobResponse(job);
}

export function getInstagramCompanionJob(ownerKey: string, jobId: string) {
  const job = jobs.get(jobId);
  return job?.ownerKey === ownerKey ? instagramCompanionJobResponse(job) : null;
}

export async function cancelInstagramCompanionJob(ownerKey: string, jobId: string) {
  const job = jobs.get(jobId);
  if (!job || job.ownerKey !== ownerKey) return null;
  if (job.status === "queued") {
    const index = queue.indexOf(job.id);
    if (index >= 0) queue.splice(index, 1);
    job.status = "cancelled";
    job.queueController?.abort();
    job.error = { code: "cancelled", message: "Instagram scraping was cancelled.", retryable: true };
    job.completedAt = new Date().toISOString();
    touch(job);
  } else if (job.status === "running") {
    job.controller?.abort();
    job.status = "cancelled";
    job.error = { code: "cancelled", message: "Instagram scraping was cancelled.", retryable: true };
    job.completedAt = new Date().toISOString();
    touch(job);
  }
  return instagramCompanionJobResponse(job);
}

export async function cancelAllInstagramCompanionJobs(reason = "Instagram scraping was cancelled.") {
  let cancelled = 0;
  for (const job of jobs.values()) {
    if (job.status === "queued") {
      job.queueController?.abort();
      job.status = "cancelled";
      job.error = { code: "cancelled", message: reason, retryable: true };
      job.completedAt = new Date().toISOString();
      touch(job);
      cancelled += 1;
    } else if (job.status === "running") {
      job.controller?.abort();
      cancelled += 1;
    }
  }
  queue.splice(0);
  notifyInstagramCompanionActivity();
  await Promise.resolve(instagramCompanionDesktopHost()?.stopBrowsers(reason)).catch(() => undefined);
  return cancelled > 0;
}

export function instagramCompanionQueueHealth() {
  return {
    available: Boolean(instagramCompanionDesktopHost()),
    activeJobs: activeJobId ? 1 : 0,
    queuedJobs: queue.length,
    concurrency: 1,
  };
}

restoreJobs();
