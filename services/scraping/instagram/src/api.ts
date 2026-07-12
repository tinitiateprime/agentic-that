import { getInstagramSessionPoolInfo, runInstagramScrape } from "./scraper.ts";
import { InstagramRunStore } from "./store.ts";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { headers: jsonHeaders, status });
}

function routePath(url: URL) {
  return url.pathname.replace(/^\/api\/scraping\/instagram\/?/, "").replace(/^\/+/, "");
}

async function readBody(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleInstagramRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: jsonHeaders, status: 204 });

  const url = new URL(request.url);
  const route = routePath(url);
  const store = new InstagramRunStore();

  try {
    if (request.method === "GET" && (route === "" || route === "health")) {
      return json({ ok: true, service: "instagram-scraper", sessionPool: await getInstagramSessionPoolInfo() });
    }

    if (request.method === "GET" && route === "runs") {
      return json({ runs: await store.listRuns() });
    }

    if (request.method === "GET" && route === "runs/keywords") {
      return json({ keywords: await store.listKeywords() });
    }

    if (request.method === "GET" && route.startsWith("runs/")) {
      const run = await store.getRun(route.slice("runs/".length));
      return run ? json({ run }) : json({ message: "Run not found" }, 404);
    }

    if (request.method === "POST" && route === "scrape") {
      const body = await readBody(request);
      const requestedQuery = String(body.query || body.keyword || "").trim();
      if (!requestedQuery) return json({ message: "Query is required." }, 400);

      const maxResults = Math.max(1, Math.min(50, Number(body.max_results || body.maxResults) || 10));
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
          : true;
      const maxAutoExpandDays = Math.max(1, Number(body.max_auto_expand_days || body.maxAutoExpandDays) || 365);

      const scrape = await runInstagramScrape({
        query: requestedQuery,
        maxResults,
        recentDays,
        onlyPostsNewerThan,
        autoExpandDays,
        maxAutoExpandDays
      });
      const run = await store.saveRun({
        query: scrape.query,
        requestedQuery,
        maxResults,
        recentDays,
        results: scrape.results
      });

      return json({ run, results: run.results, message: `Scraped ${run.results.length} posts` });
    }

    return json({ message: "Not found" }, 404);
  } catch (error) {
    let message = error instanceof Error ? error.message : "Instagram scrape failed.";
    if (/browser|chromium|playwright|newContext|Target page/i.test(message)) {
      message = "Instagram scrape failed before the browser fallback could run. Try again or refresh the Instagram sessions.";
    } else if (/Instagram API returned 429|rate.?limit/i.test(message)) {
      message = "Instagram temporarily rate-limited the saved scraper accounts. Wait a few minutes, then try again.";
    } else if (/fetch failed|network|timeout|aborted/i.test(message)) {
      message = "Instagram request failed from Netlify. Try again in a minute; if it repeats, refresh the Instagram sessions.";
    }
    if (message.length > 280) message = `${message.slice(0, 277)}...`;
    return json({ message }, 500);
  }
}
