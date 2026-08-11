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
    async openBrowser() { return { id: "unused", debugEndpoint: "http://127.0.0.1:1", targetUrl: "about:blank", sessionMode: "anonymous" }; },
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
  assert.equal(prepareFacebookCompanionInput({ mode: "profile", query: "example", comparison_mode: true }).skipComments, true);
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

test("Companion accepts a Most Viewed analysis even when the recent-post result list is empty", async () => {
  setFacebookCompanionScrapeExecutorForTests(async (_jobId, input, _signal, onReady) => {
    onReady?.();
    const ranked = {
      post_id: "reel-1",
      post_url: "https://www.facebook.com/reel/1/",
      author_name: "Example",
      author_url: "https://www.facebook.com/example/",
      profile_type: "page" as const,
      content: null,
      media_type: "reel" as const,
      thumbnail_url: null,
      timestamp: null,
      reactions_count: null,
      reactions_display: null,
      reactions_exact: false,
      comments_count: null,
      comments_display: null,
      comments_exact: false,
      top_comments: [],
      views_count: 35_000,
      views_display: "35K",
      views_exact: false,
      follower_count: null,
      follower_count_display: null,
      follower_count_exact: false,
      engagement_score: null,
      metric_source: "visible_reels_grid" as const,
      captured_at: new Date().toISOString(),
    };
    return {
      query: input.query,
      results: [],
      discoveryStatus: "partial" as const,
      analysis: {
        profile_name: "Example",
        profile_url: "https://www.facebook.com/example/",
        profile_type: "page" as const,
        follower_count: null,
        follower_count_display: null,
        captured_at: new Date().toISOString(),
        analyzed_posts: 0,
        analyzed_reels: 1,
        averages: { reactions: null, comments: null, views: 35_000 },
        engagement_rate: null,
        posting_frequency: { posts_last_30_days: 0, posts_per_week: 0 },
        top_reacted: [],
        top_discussed: [],
        top_viewed: [ranked],
        patterns: { formats: [], hashtags: [], keywords: [], posting_days: [], posting_hours: [] },
        accuracy: { source: "test", followers: "N/A", reactions: "N/A", comments: "N/A", views: "visible" },
      },
      diagnostics: {
        attempts: 1,
        browser_session: "anonymous" as const,
        scroll_rounds: 1,
        dom_candidates: 0,
        payload_candidates: 0,
        reels_grid_candidates: 1,
        unique_candidates: 1,
        accepted_results: 0,
        comments_opened: 0,
        comments_scraped: 0,
        rejected: { missing_url: 0, unexpected_post: 0, owner_mismatch: 0, missing_timestamp: 0, out_of_range: 0 },
        final_url: "https://facebook.com/example/reels/",
        page_title: "Example | Facebook",
      },
    };
  });
  const owner = "workspace:analysis-user";
  const created = createFacebookCompanionJob(owner, { mode: "profile", query: "example", collection_mode: "engagement" });
  const deadline = Date.now() + 1_000;
  let current = created;
  while (current.job.status !== "complete" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
    current = getFacebookCompanionJob(owner, created.job.id)!;
  }
  assert.equal(current.job.status, "complete");
  assert.equal(current.analysis?.top_viewed[0]?.views_count, 35_000);
});
