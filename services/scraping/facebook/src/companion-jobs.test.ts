import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  cancelAllFacebookCompanionJobs,
  createFacebookCompanionJob,
  facebookCompanionQueueHealth,
  getFacebookCompanionJob,
  prepareFacebookCompanionInput,
  setFacebookCompanionScrapeExecutorForTests,
  subscribeFacebookCompanionActivity,
} from "./companion-jobs.ts";

const previousEnvironment = process.env.NODE_ENV;

before(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  globalThis.__AGENTICTHAT_FACEBOOK_COMPANION_DESKTOP_HOST__ = {
    async openBrowser() { return { id: "unused", debugEndpoint: "http://127.0.0.1:1", targetUrl: "about:blank" }; },
    closeBrowser() {},
    stopBrowsers() {},
  };
});

after(async () => {
  await cancelAllFacebookCompanionJobs();
  setFacebookCompanionScrapeExecutorForTests(null);
  globalThis.__AGENTICTHAT_FACEBOOK_COMPANION_DESKTOP_HOST__ = undefined;
  (process.env as Record<string, string | undefined>).NODE_ENV = previousEnvironment;
});

test("Companion validation preserves the Facebook scraper contract", () => {
  const input = prepareFacebookCompanionInput({ mode: "profile", profile_type: "public_profile", query: "example", collection_mode: "engagement", max_results: 200 });
  assert.equal(input.inputMode, "profile");
  assert.equal(input.profileType, "public_profile");
  assert.equal(input.maxResults, 50);
  assert.throws(() => prepareFacebookCompanionInput({ mode: "keyword", query: "launch", collection_mode: "engagement" }), /Profile analysis/);
});

test("Companion jobs are owner-scoped and return only the current live result", async () => {
  setFacebookCompanionScrapeExecutorForTests(async (_jobId, input, _signal, onReady) => {
    onReady?.();
    return {
      query: input.query,
      results: [],
      discoveryStatus: "not_found" as const,
      diagnostics: {
        attempts: 1,
        scroll_rounds: 1,
        dom_candidates: 0,
        payload_candidates: 0,
        reels_grid_candidates: 0,
        unique_candidates: 0,
        accepted_results: 0,
        comments_opened: 0,
        comments_scraped: 0,
        rejected: { missing_url: 0, unexpected_post: 0, owner_mismatch: 0, missing_timestamp: 0, out_of_range: 0 },
        final_url: "https://facebook.com/example",
        page_title: "Facebook",
      },
    };
  });
  const owner = "workspace:user";
  const created = createFacebookCompanionJob(owner, { mode: "profile", query: "missing" });
  const deadline = Date.now() + 1_000;
  let current = created;
  while (current.job.status !== "complete" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
    current = getFacebookCompanionJob(owner, created.job.id)!;
  }
  assert.equal(current.job.status, "complete");
  assert.equal(current.dataSource, "live");
  assert.equal(getFacebookCompanionJob("other:user", created.job.id), null);
  assert.equal(facebookCompanionQueueHealth().concurrency, 1);
});

test("Companion activity exposes Facebook queue, progress, and recent completion", async () => {
  const snapshots: Array<Parameters<Parameters<typeof subscribeFacebookCompanionActivity>[0]>[0]> = [];
  const unsubscribe = subscribeFacebookCompanionActivity(state => snapshots.push(state));
  setFacebookCompanionScrapeExecutorForTests(async (_jobId, input, _signal, onReady) => {
    onReady?.();
    await new Promise(resolve => setTimeout(resolve, 20));
    return {
      query: input.query,
      results: [],
      discoveryStatus: "not_found" as const,
      diagnostics: {
        attempts: 1,
        scroll_rounds: 1,
        dom_candidates: 0,
        payload_candidates: 0,
        reels_grid_candidates: 0,
        unique_candidates: 0,
        accepted_results: 0,
        comments_opened: 0,
        comments_scraped: 0,
        rejected: { missing_url: 0, unexpected_post: 0, owner_mismatch: 0, missing_timestamp: 0, out_of_range: 0 },
        final_url: "https://facebook.com/missing",
        page_title: "Facebook",
      },
    };
  });
  const created = createFacebookCompanionJob("workspace:activity-user", { mode: "profile", query: "activity-target" });
  const deadline = Date.now() + 1_000;
  while (getFacebookCompanionJob("workspace:activity-user", created.job.id)?.job.status !== "complete" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  unsubscribe();
  assert.ok(snapshots.some(state => state.activeJob?.query === "activity-target"));
  assert.ok(snapshots.some(state => state.activeJob?.progress.stage === "scraping"));
  assert.ok(snapshots.at(-1)?.recentJobs.some(job => job.query === "activity-target" && job.status === "complete"));
});
