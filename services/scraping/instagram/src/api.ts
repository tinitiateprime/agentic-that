import { getInstagramScraperInfo, runInstagramScrape } from "./scraper.ts";
import {
  InstagramRunStore,
  selectRecentRunFallback,
  type InstagramJob,
  type InstagramJobInput
} from "./store.ts";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, no-cache, must-revalidate",
  pragma: "no-cache",
  expires: "0",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type, cache-control, pragma"
};

class InstagramRequestError extends Error {}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { headers: jsonHeaders, status });
}

function routePath(url: URL) {
  return url.pathname.replace(/^\/api\/scraping\/instagram\/?/, "").replace(/^\/+/, "");
}

function instagramUrlType(value: string) {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : "https://" + value);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    const path = url.pathname.replace(/\/+$/, "");
    if (/^\/(?:p|reel)\/[^/]+$/i.test(path)) return "post";
    if (/^\/[A-Za-z0-9._]+$/.test(path)) return "profile";
    return null;
  } catch {
    return null;
  }
}

async function readBody(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function requestError(message: string): never {
  throw new InstagramRequestError(message);
}

function prepareScrapeInput(body: Record<string, unknown>): InstagramJobInput {
  const requestedMode = String(body.mode || body.inputMode || "").trim().toLowerCase();
  let requestedQuery = String(body.query || body.keyword || "").trim();
  if (requestedMode === "keyword" && requestedQuery && !requestedQuery.startsWith("#")) {
    requestedQuery = `#${requestedQuery}`;
  }
  if (!requestedQuery) requestError("Query is required.");

  const urlType = instagramUrlType(requestedQuery);
  if (requestedMode === "profile_url" && urlType !== "profile") {
    requestError("Enter an Instagram profile URL, not a post or reel URL.");
  }
  if (requestedMode === "post_url" && urlType !== "post") {
    requestError("Enter an Instagram post or reel URL.");
  }
  const isSinglePost = requestedMode === "post_url";
  const maxResults = isSinglePost
    ? 1
    : Math.max(1, Math.min(50, Number(body.max_results || body.maxResults) || 10));
  const recentDays = Math.max(1, Math.min(365, Number(body.recent_days || body.recentDays) || 7));
  const onlyPostsNewerThan = typeof body.only_posts_newer_than === "string"
    ? body.only_posts_newer_than
    : typeof body.onlyPostsNewerThan === "string"
      ? body.onlyPostsNewerThan
      : undefined;
  const autoExpandDays = typeof body.auto_expand_days === "boolean"
    ? body.auto_expand_days
    : typeof body.autoExpandDays === "boolean"
      ? body.autoExpandDays
      : false;
  const maxAutoExpandDays = Math.max(1, Number(body.max_auto_expand_days || body.maxAutoExpandDays) || recentDays);
  const requestedCollectionMode = String(body.collection_mode || body.collectionMode || "").toLowerCase();
  const selectedCollectionMode = (["latest", "range", "engagement"] as const)
    .find((value) => value === requestedCollectionMode) || "latest";
  const collectionMode = isSinglePost ? "latest" as const : selectedCollectionMode;
  const requestedRangeType = String(body.range_type || body.rangeType || "").toLowerCase();
  const rangeType = (["date", "month", "year"] as const).find((value) => value === requestedRangeType);
  const rangeFrom = typeof (body.range_from ?? body.rangeFrom) === "string"
    ? String(body.range_from ?? body.rangeFrom).trim()
    : undefined;
  const rangeTo = typeof (body.range_to ?? body.rangeTo) === "string"
    ? String(body.range_to ?? body.rangeTo).trim()
    : undefined;
  if (collectionMode === "range" && (!rangeType || !rangeFrom || !rangeTo)) {
    requestError("Choose a valid range type, start, and end.");
  }
  if (collectionMode === "engagement" && !["profile", "profile_url", "url"].includes(requestedMode)) {
    requestError("Profile analysis is available only for Profile and Profile URL.");
  }
  const timezoneOffsetMinutes = Math.max(
    -840,
    Math.min(840, Number(body.timezone_offset_minutes ?? body.timezoneOffsetMinutes) || 0)
  );
  const sortBy = collectionMode === "engagement" ? "engagement" as const : "recent" as const;

  return {
    requestedMode,
    requestedQuery,
    maxResults,
    collectionMode,
    recentDays,
    onlyPostsNewerThan,
    autoExpandDays,
    maxAutoExpandDays,
    rangeType,
    rangeFrom,
    rangeTo,
    timezoneOffsetMinutes,
    sortBy
  };
}

function friendlyScrapeMessage(error: unknown) {
  let message = error instanceof Error ? error.message : "Instagram scrape failed.";
  if (/browser|chromium|playwright|newContext|Target page/i.test(message)) {
    message = "Instagram public browser scraping could not start. Try again in a minute.";
  } else if (/checkpoint|redirected|update_risky_contactpoint/i.test(message)) {
    message = "Instagram redirected the public page. Try again in a minute.";
  } else if (/Instagram API returned 429|rate.?limit/i.test(message)) {
    message = "Instagram temporarily rate-limited public scraping. Wait a few minutes, then try again.";
  } else if (/fetch failed|network|timeout|aborted/i.test(message)) {
    message = "Instagram public page request failed. Try again in a minute.";
  }
  return message.length > 280 ? `${message.slice(0, 277)}...` : message;
}

async function executeScrape(input: InstagramJobInput, store: InstagramRunStore) {
  const scrape = await runInstagramScrape({
    query: input.requestedQuery,
    maxResults: input.maxResults,
    collectionMode: input.collectionMode,
    recentDays: input.recentDays,
    onlyPostsNewerThan: input.onlyPostsNewerThan,
    autoExpandDays: input.autoExpandDays,
    maxAutoExpandDays: input.maxAutoExpandDays,
    rangeType: input.rangeType,
    rangeFrom: input.rangeFrom,
    rangeTo: input.rangeTo,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    sortBy: input.sortBy
  });
  let results = scrape.results;
  let analysis = scrape.analysis;
  let discoveryStatus = scrape.discoveryStatus;
  let dataSource: "live" | "recent_cache" = "live";
  let sourceRunId: string | undefined;
  let sourceCreatedAt: string | undefined;

  if (!results.length && discoveryStatus !== "not_found" && input.collectionMode !== "range") {
    const configuredMinutes = Number(process.env.INSTAGRAM_CACHE_FALLBACK_MAX_AGE_MINUTES);
    const maxAgeMinutes = Number.isFinite(configuredMinutes) && configuredMinutes > 0
      ? Math.min(configuredMinutes, 24 * 60)
      : 6 * 60;
    const fallback = selectRecentRunFallback(
      await store.listRuns(),
      input,
      Date.now(),
      maxAgeMinutes * 60_000
    );
    if (fallback) {
      results = fallback.results
        .slice()
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
        .slice(0, input.maxResults);
      analysis = input.collectionMode === "engagement" ? fallback.analysis : undefined;
      discoveryStatus = "partial";
      dataSource = "recent_cache";
      sourceRunId = fallback.id;
      sourceCreatedAt = fallback.createdAt;
    }
  }

  return store.saveRun({
    query: scrape.query,
    requestedQuery: input.requestedQuery,
    maxResults: input.maxResults,
    recentDays: input.recentDays,
    collectionMode: input.collectionMode,
    rangeType: input.rangeType,
    rangeFrom: input.rangeFrom,
    rangeTo: input.rangeTo,
    sortBy: input.sortBy,
    results,
    analysis,
    discoveryStatus,
    diagnostics: scrape.diagnostics,
    dataSource,
    sourceRunId,
    sourceCreatedAt
  });
}

async function jobResponse(job: InstagramJob, store: InstagramRunStore) {
  const run = job.runId ? await store.getRun(job.runId) : null;
  return {
    job,
    run,
    results: run?.results,
    analysis: run?.analysis,
    discoveryStatus: run?.discoveryStatus,
    discovery_status: run?.discoveryStatus,
    dataSource: run?.dataSource,
    sourceCreatedAt: run?.sourceCreatedAt,
    diagnostics: run?.diagnostics,
    message: job.status === "complete" && run ? `Scraped ${run.results.length} posts` : undefined
  };
}

export async function executeInstagramJob(jobId: string) {
  const store = new InstagramRunStore();
  const current = await store.getJob(jobId);
  if (!current) return null;
  if (current.status === "complete" || current.status === "failed") return jobResponse(current, store);
  if (current.status === "running") {
    const age = Date.now() - new Date(current.updatedAt).getTime();
    // Netlify retries a failed background invocation after about one minute.
    if (age < 55_000) return jobResponse(current, store);
  }

  const running = await store.updateJob(jobId, { status: "running", error: undefined });
  if (!running) return null;
  try {
    const run = await executeScrape(running.input, store);
    const complete = await store.updateJob(jobId, { status: "complete", runId: run.id, error: undefined });
    return complete ? jobResponse(complete, store) : null;
  } catch (error) {
    const failed = await store.updateJob(jobId, {
      status: "failed",
      error: friendlyScrapeMessage(error)
    });
    return failed ? jobResponse(failed, store) : null;
  }
}

export async function handleInstagramRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: jsonHeaders, status: 204 });

  const route = routePath(new URL(request.url));
  const store = new InstagramRunStore();

  try {
    if (request.method === "GET" && (route === "" || route === "health")) {
      return json({ ok: true, service: "instagram-scraper", scraper: await getInstagramScraperInfo() });
    }
    if (request.method === "GET" && route === "runs") return json({ runs: await store.listRuns() });
    if (request.method === "GET" && route === "runs/keywords") {
      return json({ keywords: await store.listKeywords() });
    }
    if (request.method === "GET" && route.startsWith("runs/")) {
      const run = await store.getRun(route.slice("runs/".length));
      return run ? json({ run }) : json({ message: "Run not found" }, 404);
    }

    if (request.method === "POST" && route === "jobs") {
      const input = prepareScrapeInput(await readBody(request));
      return json({ job: await store.createJob(input) }, 201);
    }
    const runJobMatch = route.match(/^jobs\/([^/]+)\/run$/);
    if (request.method === "POST" && runJobMatch) {
      const result = await executeInstagramJob(runJobMatch[1]);
      return result ? json(result) : json({ message: "Job not found" }, 404);
    }
    const getJobMatch = route.match(/^jobs\/([^/]+)$/);
    if (request.method === "GET" && getJobMatch) {
      let job = await store.getJob(getJobMatch[1]);
      if (!job) return json({ message: "Job not found" }, 404);
      if (job.status === "running" && Date.now() - new Date(job.updatedAt).getTime() > 16 * 60_000) {
        job = await store.updateJob(job.id, {
          status: "failed",
          error: "The scrape exceeded the background execution limit. Try a smaller count or range."
        }) || job;
      }
      return json(await jobResponse(job, store));
    }

    if (request.method === "POST" && route === "scrape") {
      const input = prepareScrapeInput(await readBody(request));
      const run = await executeScrape(input, store);
      return json({
        run,
        results: run.results,
        analysis: run.analysis,
        discoveryStatus: run.discoveryStatus,
        discovery_status: run.discoveryStatus,
        dataSource: run.dataSource,
        sourceCreatedAt: run.sourceCreatedAt,
        diagnostics: run.diagnostics,
        message: `Scraped ${run.results.length} posts`
      });
    }

    return json({ message: "Not found" }, 404);
  } catch (error) {
    const message = friendlyScrapeMessage(error);
    return json({ message }, error instanceof InstagramRequestError ? 400 : 500);
  }
}
