import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelAllInstagramCompanionJobs,
  cancelInstagramCompanionJob,
  createInstagramCompanionJob,
  getInstagramCompanionJob,
  prepareInstagramCompanionInput,
  setInstagramCompanionScrapeExecutorForTests,
} from "./companion-jobs.js";

process.env.NODE_ENV = "test";

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
