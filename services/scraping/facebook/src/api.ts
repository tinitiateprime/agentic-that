import {
  getFacebookScraperInfo,
  runFacebookScrape,
  type FacebookPost,
  type FacebookProfileAnalysis,
  type FacebookScrapeDiagnostics,
  facebookUrlType,
} from "./scraper.ts";
import { FacebookRunStore, type FacebookJob, type FacebookJobInput } from "./store.ts";
import { requireScrapingServiceAccess, ScrapingServiceAuthError } from "../../../../lib/scraping-service-auth.ts";
import { RollingTrialUsageLimiter } from "../../../../lib/trial-usage-limit.ts";
import { operationalBrowserError } from "../../browser-runtime.ts";
import { InProcessBackgroundJobs } from "../../background-jobs.ts";
import { teamTestingFullAccessEnabled } from "../../../../lib/team-testing-access.js";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, no-cache, must-revalidate",
  pragma: "no-cache",
  expires: "0",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,cache-control,pragma",
};
const trialScrapeLimiter = new RollingTrialUsageLimiter();
const serverBackgroundJobs = new InProcessBackgroundJobs();
const TRIAL_SCRAPES_PER_PROFILE_PER_HOUR = 2;

function enforceTrialScrapeLimit(identity: { workspaceId: string; billingStatus?: string }) {
  if (teamTestingFullAccessEnabled()) return;
  if (identity.billingStatus !== "trialing") return;
  const result = trialScrapeLimiter.consume(
    `${identity.workspaceId}:facebook`,
    TRIAL_SCRAPES_PER_PROFILE_PER_HOUR,
    60 * 60_000,
  );
  if (!result.allowed) {
    throw new ScrapingServiceAuthError(
      `Trial limit reached for Facebook scraping. Try again in ${result.retryAfterSeconds} seconds.`,
      429,
    );
  }
}

class FacebookRequestError extends Error {}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers });
}

function routePath(url: URL) {
  return url.pathname.replace(/^\/api\/scraping\/facebook\/?/, "").replace(/^\/+/, "");
}

async function body(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { return {}; }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function prepareFacebookScrapeInput(value: Record<string, unknown>): FacebookJobInput {
  const inputMode = (["profile", "keyword", "profile_url", "post_url"] as const)
    .find(mode => mode === stringValue(value.mode || value.inputMode).toLowerCase()) || "profile";
  const profileType = stringValue(value.profile_type || value.profileType) === "public_profile" ? "public_profile" as const : "page" as const;
  const requestedQuery = stringValue(value.query || value.keyword);
  if (!requestedQuery) throw new FacebookRequestError("Query is required.");
  const requestedCollection = stringValue(value.collection_mode || value.collectionMode).toLowerCase();
  const selectedCollection = (["latest", "range", "engagement"] as const).find(mode => mode === requestedCollection) || "latest";
  const collectionMode = inputMode === "post_url" ? "latest" as const : selectedCollection;
  if (collectionMode === "engagement" && !["profile", "profile_url"].includes(inputMode)) {
    throw new FacebookRequestError("Profile analysis is available only for a Facebook Page or public profile.");
  }
  const rangeType = (["date", "month", "year"] as const).find(type => type === stringValue(value.range_type || value.rangeType).toLowerCase());
  const rangeFrom = stringValue(value.range_from ?? value.rangeFrom) || undefined;
  const rangeTo = stringValue(value.range_to ?? value.rangeTo) || undefined;
  if (collectionMode === "range" && (!rangeType || !rangeFrom || !rangeTo)) {
    throw new FacebookRequestError("Choose a valid range type, start, and end.");
  }
  return {
    inputMode,
    profileType,
    requestedQuery,
    maxResults: inputMode === "post_url" ? 1 : Math.max(1, Math.min(50, Number(value.max_results || value.maxResults) || 10)),
    collectionMode,
    recentDays: Math.max(1, Math.min(365, Number(value.recent_days || value.recentDays) || 7)),
    rangeType,
    rangeFrom,
    rangeTo,
    timezoneOffsetMinutes: Math.max(-840, Math.min(840, Number(value.timezone_offset_minutes ?? value.timezoneOffsetMinutes) || 0)),
    skipComments: value.comparison_mode === true || value.skip_comments === true,
  };
}

function friendlyError(error: unknown) {
  const original = error instanceof Error ? error.message : "Facebook scrape failed.";
  if (/browserType\.launch|executable.*(?:missing|exist)|failed to launch|chromium.*executable|playwright.*install/i.test(original)) {
    return "Facebook public browser could not launch. The service retried automatically; try again in a minute.";
  }
  if (/Target page, context or browser has been closed|browser.*(?:closed|disconnected)|newContext/i.test(original)) {
    return "Facebook ended the anonymous browser session while the public page was loading. The service retried automatically; try Local Companion if it repeats.";
  }
  if (/429|rate.?limit|temporarily unavailable/i.test(original)) return "Facebook temporarily refused public discovery. Wait briefly, then try again.";
  if (/fetch failed|network|timeout|aborted|ERR_/i.test(original)) return "Facebook public pages could not be loaded reliably. Try again in a minute.";
  return original.length > 280 ? `${original.slice(0, 277)}...` : original;
}

async function executeScrape(input: FacebookJobInput, store: FacebookRunStore, createdByUserId?: string) {
  const scrape = await runFacebookScrape({
    query: input.requestedQuery,
    inputMode: input.inputMode,
    profileType: input.profileType,
    maxResults: input.maxResults,
    collectionMode: input.collectionMode,
    recentDays: input.recentDays,
    rangeType: input.rangeType,
    rangeFrom: input.rangeFrom,
    rangeTo: input.rangeTo,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    skipComments: input.skipComments,
  });
  return store.saveRun({
    createdByUserId,
    requestedQuery: input.requestedQuery,
    query: scrape.query,
    inputMode: input.inputMode,
    profileType: input.profileType,
    maxResults: input.maxResults,
    collectionMode: input.collectionMode,
    recentDays: input.recentDays,
    rangeType: input.rangeType,
    rangeFrom: input.rangeFrom,
    rangeTo: input.rangeTo,
    results: scrape.results,
    analysis: scrape.analysis,
    discoveryStatus: scrape.discoveryStatus,
    diagnostics: scrape.diagnostics,
    dataSource: "live",
    engine: "server",
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function facebookDiscoveryStatus(value: unknown) {
  return (["ok", "partial", "temporarily_unavailable", "login_required", "not_found"] as const)
    .find(status => status === value) || "ok";
}

function facebookCompanionResults(value: unknown, maxResults: number): FacebookPost[] {
  if (!Array.isArray(value)) throw new FacebookRequestError("Companion results are required.");
  if (value.length > maxResults) throw new FacebookRequestError("Companion returned more results than requested.");
  for (const result of value) {
    const postUrl = objectValue(result).post_url;
    if (typeof postUrl !== "string" || facebookUrlType(postUrl) !== "post") {
      throw new FacebookRequestError("Companion returned an invalid Facebook post URL.");
    }
  }
  return value as FacebookPost[];
}

export function prepareFacebookCompanionRun(
  payload: Record<string, unknown>,
  createdByUserId: string,
) {
  const input = prepareFacebookScrapeInput(objectValue(payload.input));
  const companion = objectValue(payload.result);
  const companionRun = objectValue(companion.run);
  const results = facebookCompanionResults(
    Array.isArray(companion.results) ? companion.results : companionRun.results,
    input.maxResults,
  );
  const query = String(companionRun.query || input.requestedQuery).trim() || input.requestedQuery;
  return {
    createdByUserId,
    requestedQuery: input.requestedQuery,
    query,
    inputMode: input.inputMode,
    profileType: input.profileType,
    maxResults: input.maxResults,
    collectionMode: input.collectionMode,
    recentDays: input.recentDays,
    rangeType: input.rangeType,
    rangeFrom: input.rangeFrom,
    rangeTo: input.rangeTo,
    results,
    analysis: (companion.analysis || companionRun.analysis) as FacebookProfileAnalysis | undefined,
    discoveryStatus: facebookDiscoveryStatus(companion.discoveryStatus || companion.discovery_status || companionRun.discoveryStatus),
    diagnostics: (companion.diagnostics || companionRun.diagnostics || {}) as FacebookScrapeDiagnostics,
    dataSource: "live" as const,
    engine: "companion" as const,
  };
}

async function importCompanionRun(
  payload: Record<string, unknown>,
  store: FacebookRunStore,
  createdByUserId: string,
) {
  return store.saveRun(prepareFacebookCompanionRun(payload, createdByUserId));
}

async function jobResponse(job: FacebookJob, store: FacebookRunStore) {
  const run = job.runId ? await store.getRun(job.runId) : null;
  return {
    job,
    run,
    results: run?.results,
    analysis: run?.analysis,
    discoveryStatus: run?.discoveryStatus,
    discovery_status: run?.discoveryStatus,
    diagnostics: run?.diagnostics,
    dataSource: run?.dataSource,
    message: job.status === "complete" && run ? `Scraped ${run.results.length} Facebook posts` : undefined,
  };
}

export async function executeFacebookJob(jobId: string, workspaceId: string) {
  const store = new FacebookRunStore(workspaceId);
  const current = await store.getJob(jobId);
  if (!current) return null;
  if (["complete", "failed"].includes(current.status)) return jobResponse(current, store);
  if (current.status === "running" && Date.now() - new Date(current.updatedAt).getTime() < 55_000) return jobResponse(current, store);
  const running = await store.updateJob(jobId, { status: "running", error: undefined });
  if (!running) return null;
  try {
    const run = await executeScrape(running.input, store, running.createdByUserId);
    const complete = await store.updateJob(jobId, { status: "complete", runId: run.id, error: undefined });
    return complete ? jobResponse(complete, store) : null;
  } catch (error) {
    console.error("Facebook server scrape failed", operationalBrowserError(error));
    const failed = await store.updateJob(jobId, { status: "failed", error: friendlyError(error) });
    return failed ? jobResponse(failed, store) : null;
  }
}

export async function handleFacebookRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const route = routePath(new URL(request.url));
  try {
    if (request.method === "GET" && (route === "" || route === "health")) {
      return json({ ok: true, service: "facebook-scraper", scraper: await getFacebookScraperInfo() });
    }
    const identity = requireScrapingServiceAccess(
      request,
      "scraping.facebook",
      request.method === "GET" ? "view" : "operate"
    );
    const store = new FacebookRunStore(identity.workspaceId);
    if (request.method === "GET" && route === "runs") return json({ runs: await store.listRuns() });
    if (request.method === "GET" && route === "runs/queries") return json({ queries: await store.listQueries() });
    if (request.method === "GET" && route.startsWith("runs/")) {
      const run = await store.getRun(route.slice("runs/".length));
      return run ? json({ run }) : json({ message: "Run not found" }, 404);
    }
    if (request.method === "POST" && route === "runs/import-companion") {
      const run = await importCompanionRun(await body(request), store, String(identity.sub));
      return json({
        run,
        results: run.results,
        analysis: run.analysis,
        discoveryStatus: run.discoveryStatus,
        discovery_status: run.discoveryStatus,
        diagnostics: run.diagnostics,
        dataSource: run.dataSource,
        engine: run.engine,
        message: `Saved ${run.results.length} Companion results to this workspace`,
      }, 201);
    }
    if (request.method === "POST" && route === "jobs") {
      const input = prepareFacebookScrapeInput(await body(request));
      enforceTrialScrapeLimit(identity);
      return json({ job: await store.createJob(input, String(identity.sub)) }, 201);
    }
    const runJob = route.match(/^jobs\/([^/]+)\/run$/);
    if (request.method === "POST" && runJob) {
      const jobId = runJob[1];
      const current = await store.getJob(jobId);
      if (!current) return json({ message: "Job not found" }, 404);
      if (current.status === "complete" || current.status === "failed") {
        return json(await jobResponse(current, store));
      }
      const executionKey = `${identity.workspaceId}:${jobId}`;
      serverBackgroundJobs.start(
        executionKey,
        () => executeFacebookJob(jobId, identity.workspaceId),
        error => console.error("Facebook background job failed", operationalBrowserError(error)),
      );
      return json(await jobResponse(current, store), 202);
    }
    const getJob = route.match(/^jobs\/([^/]+)$/);
    if (request.method === "GET" && getJob) {
      let job = await store.getJob(getJob[1]);
      if (!job) return json({ message: "Job not found" }, 404);
      if (job.status === "running" && Date.now() - new Date(job.updatedAt).getTime() > 16 * 60_000) {
        job = await store.updateJob(job.id, { status: "failed", error: "The scrape exceeded the background execution limit. Try a smaller count or range." }) || job;
      }
      return json(await jobResponse(job, store));
    }
    if (request.method === "POST" && route === "scrape") {
      const input = prepareFacebookScrapeInput(await body(request));
      enforceTrialScrapeLimit(identity);
      const run = await executeScrape(input, store, String(identity.sub));
      return json({ run, results: run.results, analysis: run.analysis, discoveryStatus: run.discoveryStatus, diagnostics: run.diagnostics, dataSource: "live" });
    }
    return json({ message: "Not found" }, 404);
  } catch (error) {
    if (!(error instanceof ScrapingServiceAuthError) && !(error instanceof FacebookRequestError)) {
      console.error("Facebook scraping request failed", operationalBrowserError(error));
    }
    return json(
      { message: friendlyError(error) },
      error instanceof ScrapingServiceAuthError ? error.status : error instanceof FacebookRequestError ? 400 : 500
    );
  }
}
