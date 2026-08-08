import assert from "node:assert/strict";
import test from "node:test";
import { handleInstagramRequest } from "./api.ts";
import {
  buildProfileAnalysis,
  currentReelViewCandidatesFromPayload,
  engagementValues,
  instagramVisibleMetric,
  liveRequestHeaders,
  mergeCandidateData,
  profileAnalysisCandidateTarget,
  publicProfileCandidatesFromPayload,
  profileTileMetrics,
  reconcileVisibleReelView,
  resolvePublicPostCounts,
  selectAnalysisEnrichmentCandidates,
  selectFreshReelViewMetric,
  viewDisplayMatchesExactCount
} from "./scraper.ts";

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

test("never lets a payload counter replace a visible Reels-grid view label", () => {
  const target = {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 2_300_000,
    views_display: "2.3M",
    _views_verified: true,
    _views_exact: false,
    _views_from_grid: true
  };
  mergeCandidateData(target, {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 1_100_000,
    views_display: "1.1M",
    _views_verified: true,
    _views_exact: true,
    _source: "public profile pagination"
  });

  assert.equal(target.views, 2_300_000);
  assert.equal(target.views_display, "2.3M");
  assert.equal(target._views_from_grid, true);
});

test("lets a visible Reels-grid view label correct an earlier payload counter", () => {
  const target = {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 1_100_000,
    views_display: "1.1M",
    _views_verified: true,
    _views_exact: true,
    _views_live: true,
    _views_from_grid: false
  };
  mergeCandidateData(target, {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 2_300_000,
    views_display: "2.3M",
    _views_verified: true,
    _views_exact: false,
    _views_from_grid: true,
    _source: "profile reels"
  });

  assert.equal(target.views, 2_300_000);
  assert.equal(target.views_display, "2.3M");
  assert.equal(target._views_from_grid, true);
  assert.equal(target._views_live, false);
});

test("keeps a fresh exact counter when a current grid label agrees with it", () => {
  const target = {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 2_345_678,
    views_display: "2.3M",
    _views_verified: true,
    _views_exact: true,
    _views_live: true,
    _views_from_grid: false
  };
  mergeCandidateData(target, {
    post_url: "https://www.instagram.com/reel/DZHamI0CInF/",
    views: 2_300_000,
    views_display: "2.3M",
    _views_verified: true,
    _views_exact: false,
    _views_from_grid: true,
    _source: "profile reels"
  });

  assert.equal(target.views, 2_345_678);
  assert.equal(target.views_display, "2.3M");
  assert.equal(target._views_exact, true);
  assert.equal(target._views_live, true);
  assert.equal(target._views_from_grid, false);
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
      _views_live: true,
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

test("treats requested count as output rows while scanning at least 50 candidates", () => {
  assert.equal(profileAnalysisCandidateTarget(10), 50);
  assert.equal(profileAnalysisCandidateTarget(12), 50);
  assert.equal(profileAnalysisCandidateTarget(50), 50);
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

test("excludes approximate metrics from profile rankings, averages, and engagement", () => {
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
    views: 2_000,
    views_display: "2,000",
    views_exact: true,
    follower_count: 10_000,
    follower_count_display: "10,000",
    engagement_score: 2_000,
    engagement_rate: 11,
    top_comments: [],
    timestamp: "2026-08-08T00:00:00.000Z",
    caption: "#exact current metrics"
  };
  const approximate = {
    ...exact,
    post_url: "https://www.instagram.com/reel/ApproximateReel1/",
    views: 9_000_000,
    views_display: "9M",
    views_exact: false,
    likes: 900_000,
    likes_display: "900K",
    likes_exact: false,
    comments_count: 90_000,
    comments_display: "90K",
    comments_exact: false
  };

  const analysis = buildProfileAnalysis([approximate, exact], 5);
  assert.equal(analysis.averages.views, 2_000);
  assert.equal(analysis.averages.likes, 200);
  assert.equal(analysis.averages.comments, 20);
  assert.deepEqual(analysis.top_watched.map((post) => post.post_url), [exact.post_url]);
  assert.deepEqual(analysis.top_liked.map((post) => post.post_url), [exact.post_url]);
  assert.deepEqual(analysis.top_discussed.map((post) => post.post_url), [exact.post_url]);
  assert.deepEqual(engagementValues(approximate), { score: null, rate: null });
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
