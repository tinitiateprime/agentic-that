import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelAllInstagramCompanionJobs,
  cancelInstagramCompanionJob,
  createInstagramCompanionJob,
  getInstagramCompanionJob,
  instagramCompanionActivityState,
  prepareInstagramCompanionInput,
  setInstagramCompanionScrapeExecutorForTests,
  subscribeInstagramCompanionActivity,
} from "./companion-jobs.js";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

function installFakeHost() {
  globalThis.__AGENTICTHAT_INSTAGRAM_COMPANION_DESKTOP_HOST__ = {
    async openBrowser() {
      return { id: "fake", debugEndpoint: "http://127.0.0.1:1", targetUrl: "about:blank" };
    },
    async closeBrowser() {},
    async stopBrowsers() {},
  };
}

async function waitForJob(owner: string, jobId: string, terminal = new Set(["complete", "failed", "cancelled"])) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const response = getInstagramCompanionJob(owner, jobId);
    if (response && terminal.has(response.job.status)) return response;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${jobId}`);
}

test("Companion input validation preserves the server scraper contract", () => {
  const input = prepareInstagramCompanionInput({
    mode: "profile",
    keyword: "example",
    max_results: 200,
    collection_mode: "engagement",
    timezone_offset_minutes: 9999,
  });
  assert.equal(input.query, "example");
  assert.equal(input.maxResults, 50);
  assert.equal(input.collectionMode, "engagement");
  assert.equal(input.sortBy, "engagement");
  assert.equal(input.timezoneOffsetMinutes, 840);
  assert.throws(
    () => prepareInstagramCompanionInput({ mode: "profile_url", keyword: "https://instagram.com/reel/abc/" }),
    /profile URL/,
  );
  assert.throws(
    () => prepareInstagramCompanionInput({
      mode: "profile",
      keyword: "example",
      collection_mode: "range",
      range_type: "date",
      range_from: "2026-02-30",
      range_to: "2026-03-01",
    }),
    /valid date range/,
  );
});

test("Companion jobs execute one at a time and return only fresh live results", async context => {
  installFakeHost();
  context.after(async () => {
    await cancelAllInstagramCompanionJobs();
    setInstagramCompanionScrapeExecutorForTests(null);
    globalThis.__AGENTICTHAT_INSTAGRAM_COMPANION_DESKTOP_HOST__ = undefined;
  });

  let active = 0;
  let maximumActive = 0;
  setInstagramCompanionScrapeExecutorForTests(async (_jobId, input) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 25));
    active -= 1;
    return {
      query: `@${input.query.replace(/^@/, "")}`,
      results: [{ post_url: `https://www.instagram.com/p/${input.query}/` }],
      discoveryStatus: "ok",
      diagnostics: {
        discoveredCandidates: 1,
        candidatePool: 1,
        extractionAttempts: 1,
        extractionSuccesses: 1,
        fallbackResults: 0,
        rejections: { navigation: 0, unexpectedPost: 0, ownerMismatch: 0, outOfRange: 0, extraction: 0 },
      },
    } as never;
  });

  const owner = "workspace:user";
  const first = createInstagramCompanionJob(owner, { mode: "profile", keyword: "first" });
  const second = createInstagramCompanionJob(owner, { mode: "profile", keyword: "second" });
  const [firstResult, secondResult] = await Promise.all([
    waitForJob(owner, first.job.id),
    waitForJob(owner, second.job.id),
  ]);
  assert.equal(maximumActive, 1);
  assert.equal(firstResult.job.status, "complete");
  assert.equal(secondResult.job.status, "complete");
  assert.equal(firstResult.dataSource, "live");
  assert.equal(firstResult.results?.[0]?.post_url, "https://www.instagram.com/p/first/");
  assert.equal(getInstagramCompanionJob("another:user", first.job.id), null);
});

test("Companion activity reports the active scrape, queue, progress, and safe recent result", async context => {
  installFakeHost();
  let releaseFirst = () => {};
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const updates: ReturnType<typeof instagramCompanionActivityState>[] = [];
  const unsubscribe = subscribeInstagramCompanionActivity(state => updates.push(state));
  context.after(async () => {
    releaseFirst();
    unsubscribe();
    await cancelAllInstagramCompanionJobs();
    setInstagramCompanionScrapeExecutorForTests(null);
    globalThis.__AGENTICTHAT_INSTAGRAM_COMPANION_DESKTOP_HOST__ = undefined;
  });

  setInstagramCompanionScrapeExecutorForTests(async (_jobId, input, _signal, onBrowserReady) => {
    onBrowserReady?.();
    if (input.query === "activity-first") await firstGate;
    return {
      query: `@${input.query}`,
      results: [{ post_url: `https://www.instagram.com/p/${input.query}/` }],
      discoveryStatus: "ok",
      diagnostics: {},
    } as never;
  });

  const owner = "private-workspace:private-user";
  const first = createInstagramCompanionJob(owner, {
    mode: "profile",
    keyword: "activity-first",
    collection_mode: "engagement",
    max_results: 3,
  });
  const second = createInstagramCompanionJob(owner, { mode: "profile", keyword: "activity-second" });

  const deadline = Date.now() + 1_000;
  let live = instagramCompanionActivityState();
  while (Date.now() < deadline && live.activeJob?.id !== first.job.id) {
    await new Promise(resolve => setTimeout(resolve, 5));
    live = instagramCompanionActivityState();
  }
  assert.equal(live.activeJob?.query, "activity-first");
  assert.equal(live.activeJob?.collectionMode, "engagement");
  assert.equal(live.activeJob?.maxResults, 3);
  assert.equal(live.activeJob?.progress.stage, "scraping");
  assert.equal(live.queuedJobs[0]?.id, second.job.id);
  assert.equal(live.queuedJobs[0]?.queuePosition, 1);
  assert.equal(JSON.stringify(live).includes(owner), false);

  releaseFirst();
  await Promise.all([waitForJob(owner, first.job.id), waitForJob(owner, second.job.id)]);
  const completed = instagramCompanionActivityState().recentJobs.find(job => job.id === second.job.id);
  assert.equal(completed?.status, "complete");
  assert.equal(completed?.resultCount, 1);
  assert.ok(updates.some(state => state.activeJob?.progress.stage === "scraping"));
});

test("a queued Companion job can be cancelled without running", async context => {
  installFakeHost();
  context.after(async () => {
    await cancelAllInstagramCompanionJobs();
    setInstagramCompanionScrapeExecutorForTests(null);
    globalThis.__AGENTICTHAT_INSTAGRAM_COMPANION_DESKTOP_HOST__ = undefined;
  });

  let releaseFirst = () => {};
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  let calls = 0;
  setInstagramCompanionScrapeExecutorForTests(async (_jobId, input) => {
    calls += 1;
    if (input.query === "blocking") await firstGate;
    return {
      query: input.query,
      results: [{ post_url: `https://www.instagram.com/p/${input.query}/` }],
      discoveryStatus: "ok",
      diagnostics: {},
    } as never;
  });

  const owner = "workspace:cancel-user";
  const blocking = createInstagramCompanionJob(owner, { mode: "profile", keyword: "blocking" });
  const queued = createInstagramCompanionJob(owner, { mode: "profile", keyword: "cancel-me" });
  await new Promise(resolve => setTimeout(resolve, 10));
  const cancelled = await cancelInstagramCompanionJob(owner, queued.job.id);
  assert.equal(cancelled?.job.status, "cancelled");
  releaseFirst();
  await waitForJob(owner, blocking.job.id);
  assert.equal(calls, 1);
});
