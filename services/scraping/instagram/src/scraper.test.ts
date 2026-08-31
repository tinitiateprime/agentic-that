import assert from "node:assert/strict";
import test from "node:test";
import { handleInstagramRequest, prepareInstagramCompanionRun, prepareScrapeInput } from "./api.ts";
import {
  buildProfileAnalysis,
  canUpgradeCurrentReelsGridView,
  classifyInstagramAccess,
  currentReelsCandidatesFromAuthoritativePayload,
  currentReelViewCandidatesFromPayload,
  engagementValues,
  instagramVisibleMetric,
  instagramRangeCoverage,
  instagramScrapeRange,
  latestProfileCandidateTarget,
  liveRequestHeaders,
  mergeCandidateData,
  mergeProfileDiscoveryCandidates,
  profileAnalysisCandidateTarget,
  publicProfileCandidatesFromPayload,
  profileTileMetrics,
  publicProfileIdFromHtml,
  reconcileVisibleReelView,
  recordUniqueReelShortcodes,
  resolvePublicPostCounts,
  selectAnalysisEnrichmentCandidates,
  selectFreshReelViewMetric,
  trustedProfileFallbackCandidates,
  viewDisplayMatchesExactCount
} from "./scraper.ts";
import { selectRecentRunFallback, type InstagramJobInput, type InstagramRun } from "./store.ts";

test("uses the launched browser user agent for live no-cache requests", () => {
  const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36";
  const headers = liveRequestHeaders(userAgent, { accept: "application/json" });

  assert.deepEqual(headers, {
    accept: "application/json",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent": userAgent
  });
  assert.doesNotMatch(JSON.stringify(headers), /Chrome\/122\.0\.0\.0/);
});

test("prevents scraper API and polling responses from being cached", async () => {
  const response = await handleInstagramRequest(new Request("http://localhost/api/scraping/instagram/health"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("expires"), "0");
});

test("prepares Companion results for durable workspace storage", () => {
  const run = prepareInstagramCompanionRun({
    input: { mode: "profile", keyword: "example", max_results: 10, collection_mode: "latest" },
    result: {
      run: { query: "@example" },
      results: [{ post_url: "https://www.instagram.com/p/example/" }],
      discoveryStatus: "partial",
      diagnostics: { discoveredCandidates: 1 },
    },
  }, "user-1");
  assert.equal(run.engine, "companion");
  assert.equal(run.createdByUserId, "user-1");
  assert.equal(run.query, "@example");
  assert.equal(run.results.length, 1);
  assert.equal(run.discoveryStatus, "partial");
});

test("rejects malformed or excessive Companion Instagram results", () => {
  assert.throws(() => prepareInstagramCompanionRun({
    input: { mode: "profile", keyword: "example", max_results: 1 },
    result: { results: [{ post_url: "https://example.com/not-instagram" }] },
  }, "user-1"), /invalid Instagram post URL/);
  assert.throws(() => prepareInstagramCompanionRun({
    input: { mode: "profile", keyword: "example", max_results: 1 },
    result: { results: [
      { post_url: "https://www.instagram.com/p/one/" },
      { post_url: "https://www.instagram.com/p/two/" },
    ] },
  }, "user-1"), /more results than requested/);
});

test("bounds Latest profile discovery to a smaller reliability-focused pool", () => {
  assert.equal(latestProfileCandidateTarget(3), 12);
  assert.equal(latestProfileCandidateTarget(10), 20);
  assert.equal(latestProfileCandidateTarget(50), 60);
});

test("uses exact timezone-aware range boundaries and reports scan completeness", () => {
  const range = instagramScrapeRange({
    query: "example",
    collectionMode: "range",
    rangeType: "date",
    rangeFrom: "2026-03-01",
    rangeTo: "2026-03-02",
    timezoneOffsetMinutes: -330,
  });
  assert.equal(range.start.toISOString(), "2026-02-28T18:30:00.000Z");
  assert.equal(range.end.toISOString(), "2026-03-02T18:29:59.999Z");

  const incomplete = instagramRangeCoverage([
    "2026-03-03T08:00:00.000Z",
    "2026-03-02T08:00:00.000Z",
  ], range, 2);
  assert.equal(incomplete.inRangeCandidates, 1);
  assert.equal(incomplete.complete, false);
  assert.equal(instagramRangeCoverage([
    "2026-02-28T18:00:00.000Z",
    "2026-03-03T08:00:00.000Z",
  ], range, 5).reachedRangeStart, false);

  const complete = instagramRangeCoverage([
    "2026-03-02T08:00:00.000Z",
    "2026-02-28T18:15:00.000Z",
    "2026-02-28T18:00:00.000Z",
  ], range, 5);
  assert.equal(complete.reachedRangeStart, true);
  assert.equal(complete.complete, true);
  assert.throws(() => prepareScrapeInput({
    mode: "profile",
    query: "example",
    collection_mode: "range",
    range_type: "date",
    range_from: "2026-02-30",
    range_to: "2026-03-01",
  }), /valid date range/);
});

test("keeps only trusted requested-profile discoveries when post pages are temporarily unavailable", () => {
  const fallback = trustedProfileFallbackCandidates([
    {
      post_url: "https://www.instagram.com/p/ProfilePost1/",
      username: "bakery",
      timestamp: "2026-08-10T00:00:00.000Z",
      _source: "profile"
    },
    {
      post_url: "https://www.instagram.com/reel/ProfileReel2/",
      username: null,
      timestamp: "2026-08-09T00:00:00.000Z",
      _source: "profile reels"
    },
    {
      post_url: "https://www.instagram.com/p/UntrustedSearch3/",
      username: "bakery",
      timestamp: "2026-08-08T00:00:00.000Z",
      _source: "latest keyword"
    },
    {
      post_url: "https://www.instagram.com/p/WrongOwner4/",
      username: "another_bakery",
      timestamp: "2026-08-07T00:00:00.000Z",
      _source: "public profile feed"
    }
  ], "bakery", 3, ["https://www.instagram.com/p/ProfilePost1/"]);

  assert.deepEqual(fallback.map((post) => post.post_url), [
    "https://www.instagram.com/reel/ProfileReel2/"
  ]);
  assert.equal(fallback[0].username, "bakery");
  assert.equal(fallback[0]._handle, "bakery");
});

test("selects a recent live run as a cache fallback without chaining cached or ranged runs", () => {
  const now = Date.parse("2026-08-10T06:00:00.000Z");
  const post = {
    username: "bakery",
    display_name: "Bakery",
    profile_url: "https://www.instagram.com/bakery/",
    post_url: "https://www.instagram.com/p/CachedPost1/",
    thumbnail_url: null,
    comments_count: 1,
    comments_display: "1",
    comments_exact: true,
    comments_hidden: false,
    likes: 2,
    likes_display: "2",
    likes_exact: true,
    likes_hidden: false,
    views: null,
    views_display: null,
    views_exact: false,
    follower_count: 10,
    follower_count_display: "10",
    engagement_score: null,
    engagement_rate: null,
    top_comments: [],
    timestamp: "2026-08-10T00:00:00.000Z",
    caption: null
  };
  const input: InstagramJobInput = {
    requestedMode: "profile",
    requestedQuery: "@bakery",
    maxResults: 10,
    collectionMode: "latest",
    recentDays: 7,
    autoExpandDays: false,
    maxAutoExpandDays: 1,
    timezoneOffsetMinutes: 0,
    sortBy: "recent"
  };
  const runs: InstagramRun[] = [
    {
      id: "cached-chain",
      workspaceId: "workspace-test",
      query: "@bakery",
      requestedQuery: "@bakery",
      maxResults: 10,
      collectionMode: "latest",
      createdAt: "2026-08-10T05:59:00.000Z",
      results: [post],
      dataSource: "recent_cache"
    },
    {
      id: "engagement-live",
      workspaceId: "workspace-test",
      query: "@bakery",
      requestedQuery: "@bakery",
      maxResults: 10,
      collectionMode: "engagement",
      createdAt: "2026-08-10T05:30:00.000Z",
      results: [post]
    },
    {
      id: "latest-live",
      workspaceId: "workspace-test",
      query: "@bakery",
      requestedQuery: "@bakery",
      maxResults: 10,
      collectionMode: "latest",
      createdAt: "2026-08-10T04:00:00.000Z",
      results: [post]
    }
  ];

  assert.equal(selectRecentRunFallback(runs, input, now)?.id, "latest-live");
  assert.equal(selectRecentRunFallback(runs, { ...input, collectionMode: "range" }, now), null);
  assert.equal(selectRecentRunFallback(runs, input, now, 60 * 60_000)?.id, "engagement-live");
});

test("treats a sign-in modal over public Reel anchors as public content", () => {
  assert.equal(classifyInstagramAccess({
    url: "https://www.instagram.com/public_profile/reels/",
    reelAnchorCount: 12,
    postAnchorCount: 0,
    visibleLoginInputCount: 1
  }), "public_content");
});

test("ignores incidental login text when public post anchors exist", () => {
  assert.equal(classifyInstagramAccess({
    url: "https://www.instagram.com/public_profile/",
    reelAnchorCount: 0,
    postAnchorCount: 9,
    visibleLoginInputCount: 0
  }), "public_content");
});

test("classifies a true login-only page with no public anchors", () => {
  assert.equal(classifyInstagramAccess({
    url: "https://www.instagram.com/accounts/login/",
    reelAnchorCount: 0,
    postAnchorCount: 0,
    visibleLoginInputCount: 1
  }), "login_required");
});

test("recovers the requested profile ID from public route HTML", () => {
  const html = String.raw`<script type="application/json">{"meta":{"title":"pickels & sweets (\u0040hathiya_pickels_homemade)"},"page_logging":{"name":"profilePage","params":{"profile_id":"61507532657"}}}</script>`;
  const embed = `<main data-owner-id="61507532657"><a href="https://www.instagram.com/hathiya_pickels_homemade/">Profile</a></main>`;

  assert.equal(publicProfileIdFromHtml(html, "hathiya_pickels_homemade"), "61507532657");
  assert.equal(publicProfileIdFromHtml(embed, "hathiya_pickels_homemade"), "61507532657");
  assert.equal(publicProfileIdFromHtml(html, "different_profile"), null);
});

test("uses an unambiguous exact count from the fresh public Reels query when the grid is hidden", () => {
  const candidates = currentReelsCandidatesFromAuthoritativePayload({
    data: {
      user: {
        edge_owner_to_timeline_media: {
          edges: [{
            node: {
              shortcode: "FreshQueryReel1",
              product_type: "clips",
              video_view_count: 24_638,
              edge_liked_by: { count: 91 },
              edge_media_to_comment: { count: 7 },
              owner: { id: "61507532657", username: "hathiya_pickels_homemade" }
            }
          }]
        }
      }
    }
  }, "hathiya_pickels_homemade");

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].views, 24_638);
  assert.equal(candidates[0].views_exact, true);
  assert.equal(candidates[0].views_fresh, true);
  assert.equal(candidates[0].views_source, "current_reels_payload");
  assert.equal(candidates[0].likes, 91);
  assert.equal(candidates[0].comments_count, 7);
});

test("does not guess when a hidden grid payload exposes conflicting view counters", () => {
  const [candidate] = currentReelsCandidatesFromAuthoritativePayload({
    shortcode: "AmbiguousQueryReel1",
    product_type: "clips",
    play_count: 24_638,
    video_view_count: 22_100,
    owner: { id: "61507532657", username: "hathiya_pickels_homemade" }
  }, "hathiya_pickels_homemade");

  assert.equal(candidate.views, null);
  assert.equal(candidate.views_fresh, false);
  assert.equal(candidate.views_source, null);
});

test("extracts exact current reel counts from nested public GraphQL payloads", () => {
  const views = currentReelViewCandidatesFromPayload({
    data: {
      node: {
        edges: [
          { node: { code: "CurrentReel1", play_count: 14_967_100 } },
          { node: { shortcode: "CurrentReel2", video_view_count: 24_492_436 } }
        ]
      }
    }
  });

  assert.deepEqual(views.get("CurrentReel1"), [{ source: "play_count", value: 14_967_100 }]);
  assert.deepEqual(views.get("CurrentReel2"), [{ source: "video_view_count", value: 24_492_436 }]);
});

test("keeps conflicting view counters separate and selects the one matching the visible label", () => {
  const views = currentReelViewCandidatesFromPayload({
    code: "CurrentReel3",
    play_count: 18_845_321,
    ig_play_count: 19_002_311,
    video_view_count: 17_911_201
  });

  assert.deepEqual(views.get("CurrentReel3"), [
    { source: "play_count", value: 18_845_321 },
    { source: "ig_play_count", value: 19_002_311 },
    { source: "video_view_count", value: 17_911_201 }
  ]);
  assert.deepEqual(selectFreshReelViewMetric("18.8M", views.get("CurrentReel3")!), {
    source: "play_count",
    value: 18_845_321
  });
  assert.equal(selectFreshReelViewMetric("20M", views.get("CurrentReel3")!), null);
});

test("keeps the visible Reels-grid value when a payload exposes a conflicting counter", () => {
  assert.equal(viewDisplayMatchesExactCount("18.8M", 14_967_100), false);
  assert.deepEqual(reconcileVisibleReelView("18.8M", 18_800_000, 14_967_100), {
    views: 18_800_000,
    views_display: "18.8M",
    views_exact: false
  });
});

test("uses an exact count when it agrees with the visible Reels-grid value", () => {
  assert.equal(viewDisplayMatchesExactCount("18.8M", 18_749_999), false);
  assert.equal(viewDisplayMatchesExactCount("18.8M", 18_845_321), true);
  assert.deepEqual(reconcileVisibleReelView("18.8M", 18_800_000, 18_845_321), {
    views: 18_845_321,
    views_display: "18.8M",
    views_exact: true
  });
});

test("formats payload view counts like Instagram when no grid label is available", () => {
  assert.equal(instagramVisibleMetric(2_345_678), "2.3M");
  assert.equal(instagramVisibleMetric(400_200), "400K");
  assert.equal(instagramVisibleMetric(9_593), "9,593");
  assert.deepEqual(reconcileVisibleReelView(null, null, 2_345_678), {
    views: 2_345_678,
    views_display: "2.3M",
    views_exact: true
  });
});

test("prefers the real reel URL for the same shortcode", () => {
  const target = {
    post_url: "https://www.instagram.com/p/CorrectCode1/",
    views: null,
    views_display: null
  };
  mergeCandidateData(target, {
    post_url: "https://www.instagram.com/reel/CorrectCode1/",
    views: 267_000,
    views_display: "267K",
    _views_verified: true,
    _views_exact: false,
    _source: "profile reels"
  });

  assert.equal(target.post_url, "https://www.instagram.com/reel/CorrectCode1/");
  assert.equal(target.views_display, "267K");
});

test("never lets a stale feed counter replace a visible current Reels-grid label", () => {
  const target = {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 2_300_000,
    views_display: "2.3M",
    _views_verified: true,
    _views_exact: false,
    _views_from_grid: true,
    _views_fresh: true,
    _views_source: "current_reels_grid" as const
  };
  mergeCandidateData(target, {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 1_100_000,
    views_display: "1.1M",
    _views_verified: true,
    _views_exact: true,
    _views_fresh: false,
    _views_source: "profile_feed" as const,
    _source: "public profile pagination"
  });

  assert.equal(target.views, 2_300_000);
  assert.equal(target.views_display, "2.3M");
  assert.equal(target._views_from_grid, true);
});

test("lets a visible Reels-grid label correct a conflicting current payload counter", () => {
  const target = {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 1_100_000,
    views_display: "1.1M",
    _views_verified: true,
    _views_exact: true,
    _views_fresh: true,
    _views_source: "current_reels_payload" as const,
    _views_from_grid: false
  };
  mergeCandidateData(target, {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 2_300_000,
    views_display: "2.3M",
    _views_verified: true,
    _views_exact: false,
    _views_fresh: true,
    _views_source: "current_reels_grid" as const,
    _views_from_grid: true,
    _source: "profile reels"
  });

  assert.equal(target.views, 2_300_000);
  assert.equal(target.views_display, "2.3M");
  assert.equal(target._views_from_grid, true);
  assert.equal(target._views_fresh, true);
  assert.equal(target._views_source, "current_reels_grid");
});

test("keeps a fresh exact counter when a current grid label agrees with it", () => {
  const target = {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 2_345_678,
    views_display: "2.3M",
    _views_verified: true,
    _views_exact: true,
    _views_fresh: true,
    _views_source: "current_reels_payload" as const,
    _views_from_grid: false
  };
  mergeCandidateData(target, {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 2_300_000,
    views_display: "2.3M",
    _views_verified: true,
    _views_exact: false,
    _views_fresh: true,
    _views_source: "current_reels_grid" as const,
    _views_from_grid: true,
    _source: "profile reels"
  });

  assert.equal(target.views, 2_345_678);
  assert.equal(target.views_display, "2.3M");
  assert.equal(target._views_exact, true);
  assert.equal(target._views_fresh, true);
  assert.equal(target._views_source, "current_reels_payload");
  assert.equal(target._views_from_grid, false);
});

test("current 24.6K Reels views beat stale 1,759 feed views in every merge order", () => {
  const grid = () => ({
    post_url: "https://www.instagram.com/reel/FreshGrid1/",
    views: 24_600,
    views_display: "24.6K",
    _views_verified: true,
    _views_exact: false,
    _views_fresh: true,
    _views_source: "current_reels_grid" as const,
    _views_from_grid: true,
    _source: "profile reels"
  });
  const feed = () => ({
    post_url: "https://www.instagram.com/reel/FreshGrid1/",
    views: 1_759,
    views_display: "1,759",
    _views_verified: true,
    _views_exact: true,
    _views_fresh: false,
    _views_source: "profile_feed" as const,
    _source: "public profile feed"
  });

  const feedThenGrid = feed();
  mergeCandidateData(feedThenGrid, grid());
  const gridThenFeed = grid();
  mergeCandidateData(gridThenFeed, feed());

  for (const result of [feedThenGrid, gridThenFeed]) {
    assert.equal(result.views, 24_600);
    assert.equal(result.views_display, "24.6K");
    assert.equal(result._views_exact, false);
    assert.equal(result._views_fresh, true);
    assert.equal(result._views_source, "current_reels_grid");
  }
});

test("preserves view-source priority across every source merge permutation", () => {
  const postUrl = "https://www.instagram.com/reel/SourceOrder1/";
  const sources = [
    {
      post_url: postUrl,
      views: 1_500,
      views_display: "1,500",
      _views_verified: true,
      _views_exact: true,
      _views_fresh: false,
      _views_source: "bootstrap" as const
    },
    {
      post_url: postUrl,
      views: 1_759,
      views_display: "1,759",
      _views_verified: true,
      _views_exact: true,
      _views_fresh: false,
      _views_source: "profile_feed" as const
    },
    {
      post_url: postUrl,
      views: 24_000,
      views_display: "24K",
      _views_verified: true,
      _views_exact: false,
      _views_fresh: true,
      _views_source: "post_page" as const
    },
    {
      post_url: postUrl,
      views: 24_600,
      views_display: "24.6K",
      _views_verified: true,
      _views_exact: false,
      _views_fresh: true,
      _views_source: "current_reels_grid" as const,
      _views_from_grid: true
    },
    {
      post_url: postUrl,
      views: 24_638,
      views_display: "24.6K",
      _views_verified: true,
      _views_exact: true,
      _views_fresh: true,
      _views_source: "current_reels_payload" as const
    }
  ];
  const permutations = <T>(items: T[]): T[][] => items.length <= 1
    ? [items]
    : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)])
      .map((rest) => [item, ...rest]));

  for (const order of permutations(sources)) {
    const target = { ...order[0] };
    for (const source of order.slice(1)) mergeCandidateData(target, { ...source });
    assert.equal(target.views, 24_638);
    assert.equal(target.views_display, "24.6K");
    assert.equal(target._views_exact, true);
    assert.equal(target._views_fresh, true);
    assert.equal(target._views_source, "current_reels_payload");
  }
});

test("upgrades a matching current 1.2M grid label with an exact fresh payload count", () => {
  const target = {
    post_url: "https://www.instagram.com/reel/FreshGrid2/",
    views: 1_200_000,
    views_display: "1.2M",
    _views_verified: true,
    _views_exact: false,
    _views_fresh: true,
    _views_source: "current_reels_grid" as const,
    _views_from_grid: true
  };
  mergeCandidateData(target, {
    post_url: target.post_url,
    views: 1_248_713,
    views_display: "1,248,713",
    _views_verified: true,
    _views_exact: true,
    _views_fresh: true,
    _views_source: "current_reels_payload"
  });

  assert.equal(target.views, 1_248_713);
  assert.equal(target.views_display, "1.2M");
  assert.equal(target._views_exact, true);
  assert.equal(target._views_fresh, true);
  assert.equal(target._views_source, "current_reels_payload");
});

test("does not treat a payload-only counter as current without a visible Reels-grid label", () => {
  assert.equal(canUpgradeCurrentReelsGridView({
    post_url: "https://www.instagram.com/reel/PayloadOnly1/",
    views: null,
    views_display: null,
    _views_verified: false,
    _views_exact: false,
    _views_fresh: false,
    _views_source: null
  }), false);
  assert.equal(canUpgradeCurrentReelsGridView({
    post_url: "https://www.instagram.com/reel/GridVisible1/",
    views: 1_200_000,
    views_display: "1.2M",
    _views_verified: true,
    _views_exact: false,
    _views_fresh: true,
    _views_source: "current_reels_grid"
  }), true);
});

test("tracks new Reel shortcodes even when Instagram recycles the same number of DOM anchors", () => {
  const seen = new Set<string>();
  assert.equal(recordUniqueReelShortcodes(seen, Array.from({ length: 12 }, (_, index) => `/reel/First${index}Code/`)), 12);
  assert.equal(recordUniqueReelShortcodes(seen, Array.from({ length: 12 }, (_, index) => `/reel/Second${index}Code/`)), 12);
  assert.equal(seen.size, 24);
});

test("uses current Reels candidates when profile and fallback discovery are empty", () => {
  const reels = [{
    post_url: "https://www.instagram.com/reel/RecoveryReel1/",
    views: 1_200_000,
    views_display: "1.2M",
    _views_verified: true,
    _views_exact: false,
    _views_fresh: true,
    _views_source: "current_reels_grid" as const,
    _source: "profile reels"
  }];
  const merged = mergeProfileDiscoveryCandidates(reels, [], []);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].post_url, reels[0].post_url);
  assert.equal(merged[0]._views_fresh, true);
});

test("maps normal and hovered Reel tile states to the correct metrics", () => {
  assert.deepEqual(profileTileMetrics(["80.8M"], ["7.6M", "12.2K"], true), {
    views_display: "80.8M",
    likes_display: "7.6M",
    comments_display: "12.2K"
  });
  assert.deepEqual(profileTileMetrics(["80.8M"], ["80.8M", "7.6M", "12.2K"], true), {
    views_display: "80.8M",
    likes_display: "7.6M",
    comments_display: "12.2K"
  });
});

test("does not let an anonymous hidden label replace visible grid likes", () => {
  const target = {
    likes: 7_600_000,
    likes_display: "7.6M",
    likes_exact: false,
    likes_hidden: false,
    _likes_verified: true,
    _likes_exact: false
  };
  mergeCandidateData(target, {
    likes: null,
    likes_display: null,
    likes_exact: false,
    likes_hidden: true,
    _likes_verified: true,
    _likes_exact: false,
    _source: "post page"
  });

  assert.equal(target.likes_display, "7.6M");
  assert.equal(target.likes_hidden, false);
});

test("opens only unique final ranking winners for comment enrichment", () => {
  const candidates = [
    {
      post_url: "https://www.instagram.com/reel/TopViews1/",
      views: 100,
      likes: 1,
      comments_count: 1,
      _views_verified: true,
      _views_exact: true,
      _views_fresh: true,
      _views_source: "current_reels_payload" as const,
      _likes_verified: true,
      _comments_verified: true
    },
    {
      post_url: "https://www.instagram.com/reel/TopLikes1/",
      views: 50,
      likes: 100,
      comments_count: 2,
      _views_verified: true,
      _likes_verified: true,
      _comments_verified: true
    },
    {
      post_url: "https://www.instagram.com/p/TopComments1/",
      views: null,
      likes: 50,
      comments_count: 100,
      _likes_verified: true,
      _comments_verified: true
    },
    {
      post_url: "https://www.instagram.com/p/HiddenLikes1/",
      likes: 1_000,
      likes_hidden: true,
      _likes_verified: true
    }
  ];

  assert.deepEqual(
    selectAnalysisEnrichmentCandidates(candidates, 1).map((candidate) => candidate.post_url),
    [
      "https://www.instagram.com/reel/TopViews1/",
      "https://www.instagram.com/reel/TopLikes1/",
      "https://www.instagram.com/p/TopComments1/"
    ]
  );
});

test("treats requested count as output rows while scanning a deeper configurable candidate pool", () => {
  assert.equal(profileAnalysisCandidateTarget(10), 300);
  assert.equal(profileAnalysisCandidateTarget(12), 300);
  assert.equal(profileAnalysisCandidateTarget(50), 300);
});

test("finds a Most Watched winner at Reel position 120", () => {
  const posts = Array.from({ length: 140 }, (_, index) => ({
    username: "deep_profile",
    display_name: "Deep Profile",
    profile_url: "https://www.instagram.com/deep_profile/",
    post_url: `https://www.instagram.com/reel/DepthReel${String(index).padStart(2, "0")}/`,
    thumbnail_url: null,
    comments_count: null,
    comments_display: null,
    comments_exact: false,
    comments_hidden: false,
    likes: null,
    likes_display: null,
    likes_exact: false,
    likes_hidden: false,
    views: index === 119 ? 9_900_000 : 100_000 + index,
    views_display: index === 119 ? "9.9M" : "100K",
    views_exact: false,
    views_fresh: true,
    views_source: "current_reels_grid" as const,
    views_captured_at: "2026-08-08T00:00:00.000Z",
    follower_count: null,
    follower_count_display: null,
    engagement_score: null,
    engagement_rate: null,
    top_comments: [],
    timestamp: new Date(Date.UTC(2026, 7, 8) - index * 60_000).toISOString(),
    caption: null
  }));

  const analysis = buildProfileAnalysis(posts, 3, 0, profileAnalysisCandidateTarget(3));
  assert.equal(analysis.candidate_target, 300);
  assert.equal(analysis.top_watched[0].post_url, posts[119].post_url);
});

test("turns public profile pagination payloads into complete unique candidates", () => {
  const candidates = publicProfileCandidatesFromPayload({
    data: {
      node: {
        polaris_clips_connection: {
          edges: [{
            node: {
              code: "DeepReel1",
              media_type: 2,
              product_type: "clips",
              taken_at: 1_752_000_000,
              play_count: 8_045_321,
              like_count: 745_200,
              comment_count: 12_300,
              image_versions2: { candidates: [{ url: "https://scontent.cdninstagram.com/deep-reel.jpg" }] },
              user: { id: "123456789012345", fbid: "987654321098765", username: "public_profile" }
            }
          }]
        }
      }
    }
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].post_url, "https://www.instagram.com/reel/DeepReel1/");
  assert.equal(candidates[0].thumbnail_url, "https://scontent.cdninstagram.com/deep-reel.jpg");
  assert.equal(candidates[0].views, 8_045_321);
  assert.equal(candidates[0].likes, 745_200);
  assert.equal(candidates[0].comments_count, 12_300);
  assert.equal(candidates[0]._likes_live, true);
  assert.equal(candidates[0]._comments_live, true);
});

test("ranks fresh approximate Reel views while keeping approximate likes and comments excluded", () => {
  const exact = {
    username: "public_profile",
    display_name: "Public Profile",
    profile_url: "https://www.instagram.com/public_profile/",
    post_url: "https://www.instagram.com/reel/ExactReel1/",
    thumbnail_url: null,
    comments_count: 20,
    comments_display: "20",
    comments_exact: true,
    comments_hidden: false,
    likes: 200,
    likes_display: "200",
    likes_exact: true,
    likes_hidden: false,
    views: 934_281,
    views_display: "934K",
    views_exact: true,
    views_fresh: true,
    views_source: "current_reels_payload" as const,
    views_captured_at: "2026-08-08T00:00:01.000Z",
    follower_count: 10_000,
    follower_count_display: "10,000",
    engagement_score: 934_281,
    engagement_rate: 11,
    top_comments: [],
    timestamp: "2026-08-08T00:00:00.000Z",
    caption: "#exact current metrics"
  };
  const approximate = {
    ...exact,
    post_url: "https://www.instagram.com/reel/ApproximateReel1/",
    views: 2_400_000,
    views_display: "2.4M",
    views_exact: false,
    views_fresh: true,
    views_source: "current_reels_grid" as const,
    likes: 900_000,
    likes_display: "900K",
    likes_exact: false,
    comments_count: 90_000,
    comments_display: "90K",
    comments_exact: false
  };

  const analysis = buildProfileAnalysis([approximate, exact], 5);
  assert.equal(analysis.averages.views, 1_667_141);
  assert.equal(analysis.averages.likes, 200);
  assert.equal(analysis.averages.comments, 20);
  assert.deepEqual(analysis.top_watched.map((post) => post.post_url), [approximate.post_url, exact.post_url]);
  assert.deepEqual(analysis.top_liked.map((post) => post.post_url), [exact.post_url]);
  assert.deepEqual(analysis.top_discussed.map((post) => post.post_url), [exact.post_url]);
  assert.deepEqual(engagementValues(approximate), { score: 2_400_000, rate: null });
});

test("never displays an embedded like count when Instagram labels likes as hidden", () => {
  assert.deepEqual(resolvePublicPostCounts({
    actionMetrics: {
      likes: "6",
      comments: null,
      likesHidden: true,
      commentsHidden: false
    },
    description: "6 comments on this post",
    embeddedLikes: [6],
    embeddedComments: [],
    embeddedLikesHidden: true
  }), {
    likes: null,
    likes_display: null,
    likes_exact: false,
    likes_hidden: true,
    comments_count: 6,
    comments_display: "6",
    comments_exact: true,
    comments_hidden: false
  });
});

test("keeps unavailable likes and comments null instead of manufacturing zeroes", () => {
  assert.deepEqual(resolvePublicPostCounts({
    actionMetrics: {
      likes: null,
      comments: null,
      likesHidden: false,
      commentsHidden: false
    },
    description: "Public Instagram post",
    embeddedLikes: [],
    embeddedComments: [],
    embeddedLikesHidden: false
  }), {
    likes: null,
    likes_display: null,
    likes_exact: false,
    likes_hidden: false,
    comments_count: null,
    comments_display: null,
    comments_exact: false,
    comments_hidden: false
  });
});
