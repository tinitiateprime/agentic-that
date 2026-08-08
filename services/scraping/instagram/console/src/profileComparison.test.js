import assert from "node:assert/strict";
import test from "node:test";
import {
  buildComparisonReport,
  canonicalPostKey,
  extractHashtags,
  normalizeProfileInput,
  pinSelectedPosts,
  postsFromComparisonJob
} from "./profileComparison.js";

const post = (code, username, values = {}) => ({
  username,
  display_name: username,
  profile_url: `https://www.instagram.com/${username}/`,
  post_url: `https://www.instagram.com/reel/${code}/?utm_source=test`,
  thumbnail_url: `https://images.example/${code}.jpg`,
  timestamp: values.timestamp || "2026-08-01T10:00:00.000Z",
  caption: values.caption || "New arrival #Retail #Local",
  follower_count: values.followers || 1000,
  follower_count_display: String(values.followers || 1000),
  views: values.views ?? 100,
  views_display: values.viewsDisplay || String(values.views ?? 100),
  views_exact: values.viewsExact ?? true,
  views_fresh: values.viewsFresh ?? true,
  views_source: values.viewsFresh === false ? "profile_feed" : "current_reels_grid",
  likes: values.likes ?? 20,
  likes_display: String(values.likes ?? 20),
  likes_exact: true,
  likes_hidden: false,
  comments_count: values.comments ?? 5,
  comments_display: String(values.comments ?? 5),
  comments_exact: true,
  comments_hidden: false,
  top_comments: values.topComments || []
});

test("normalizes usernames and Instagram profile URLs", () => {
  assert.equal(normalizeProfileInput(" @Brand.Name "), "brand.name");
  assert.equal(normalizeProfileInput("https://www.instagram.com/Brand.Name/?hl=en"), "brand.name");
  assert.equal(normalizeProfileInput("https://example.com/brand"), "");
  assert.equal(normalizeProfileInput("https://www.instagram.com/reel/ABC/"), "");
});

test("uses recent job order and most-viewed analysis rankings", () => {
  const older = post("OLD", "brand", { timestamp: "2026-07-01T00:00:00Z", views: 900 });
  const newer = post("NEW", "brand", { timestamp: "2026-08-01T00:00:00Z", views: 100 });
  assert.deepEqual(postsFromComparisonJob({ results: [older, newer] }, "recent", 2).map((item) => canonicalPostKey(item.post_url)), ["reel:NEW", "reel:OLD"]);
  assert.deepEqual(postsFromComparisonJob({ analysis: { top_watched: [older, newer] } }, "views", 1).map((item) => canonicalPostKey(item.post_url)), ["reel:OLD"]);
  assert.deepEqual(
    postsFromComparisonJob({ results: [older], analysis: { top_watched: [] } }, "views", 1)
      .map((item) => canonicalPostKey(item.post_url)),
    ["reel:OLD"]
  );
});

test("ranks fresh current view values by count regardless of exact precision", () => {
  const exact = post("EXACT", "brand", { views: 500, viewsExact: true });
  const approximateHigh = post("APPROX_HIGH", "brand", { views: 2_000, viewsExact: false });
  const approximateLow = post("APPROX_LOW", "brand", { views: 1_000, viewsExact: false });

  assert.deepEqual(
    postsFromComparisonJob({
      results: [approximateLow, approximateHigh],
      analysis: { top_watched: [exact] }
    }, "views", 3).map((item) => canonicalPostKey(item.post_url)),
    ["reel:APPROX_HIGH", "reel:APPROX_LOW", "reel:EXACT"]
  );
});

test("does not let stale feed views outrank fresh current Reels views", () => {
  const stale = post("STALE", "brand", { views: 9_000_000, viewsExact: true, viewsFresh: false });
  const fresh = post("FRESH", "brand", { views: 850_000, viewsExact: false, viewsFresh: true });

  assert.deepEqual(
    postsFromComparisonJob({ results: [stale, fresh] }, "views", 2)
      .map((item) => canonicalPostKey(item.post_url)),
    ["reel:FRESH"]
  );
});

test("does not present recent regular posts as Most Viewed", () => {
  const regularPost = post("POST_ONLY", "brand", { views: null, viewsExact: false });
  regularPost.post_url = "https://www.instagram.com/p/POST_ONLY/";
  regularPost.views = null;
  regularPost.views_display = null;

  assert.deepEqual(
    postsFromComparisonJob({ results: [regularPost], analysis: { top_watched: [] } }, "views", 3)
      .map((item) => canonicalPostKey(item.post_url)),
    []
  );
});

test("pins selected posts in selection order", () => {
  const posts = [post("A", "brand"), post("B", "brand"), post("C", "brand")];
  const ordered = pinSelectedPosts(posts, ["reel:C", "reel:B"]);
  assert.deepEqual(ordered.map((item) => canonicalPostKey(item.post_url)), ["reel:C", "reel:B", "reel:A"]);
});

test("extracts unique normalized hashtags", () => {
  assert.deepEqual(extractHashtags("#Retail #retail #New_Arrival"), ["#retail", "#new_arrival"]);
});

test("builds an evidence-grounded benchmark and preserves visible labels", () => {
  const first = post("ONE", "first", { views: 2_300_000, viewsDisplay: "2.3M", likes: 100, comments: 20 });
  const second = post("TWO", "second", { views: 400_000, viewsDisplay: "400K", likes: 200, comments: 30 });
  const report = buildComparisonReport({
    selectionMode: "views",
    capturedAt: "2026-08-07T00:00:00.000Z",
    businessContext: {
      business_name: "Shop",
      business_type: "Retail",
      target_customer: "Local families",
      goal: "Increase repeat purchases"
    },
    profiles: [
      { id: "one", username: "first", role: "own", posts: [first], selectedKeys: ["reel:ONE"], analysis: null },
      { id: "two", username: "second", role: "competitor", posts: [second], selectedKeys: ["reel:TWO"], analysis: null }
    ]
  });

  assert.equal(report.selection_mode, "most_viewed");
  assert.equal(report.profiles[0].selected_posts[0].views.display, "2.3M");
  assert.equal(report.benchmark.leaders.views.username, "first");
  assert.equal(report.benchmark.posts_selected, 2);
  assert.deepEqual(report.benchmark.shared_hashtags, [
    { label: "#local", profile_count: 2 },
    { label: "#retail", profile_count: 2 }
  ]);
  assert.equal(report.advisor_context_ready, true);
  assert.equal(report.evidence.length, 2);
});

test("keeps unavailable metrics as N/A data instead of converting them to zero", () => {
  const unavailable = post("NONE", "brand", { views: null });
  unavailable.views = null;
  unavailable.views_display = null;
  const report = buildComparisonReport({
    selectionMode: "recent",
    businessContext: {},
    excludedProfiles: [{ value: "@failed_brand", error: "Public data unavailable" }],
    profiles: [{
      id: "brand",
      username: "brand",
      role: "competitor",
      posts: [unavailable],
      selectedKeys: ["reel:NONE"],
      analysis: null
    }]
  });

  assert.equal(report.profiles[0].selected_posts[0].views.value, null);
  assert.equal(report.profiles[0].averages.views, null);
  assert.equal(report.benchmark.leaders.views, null);
  assert.deepEqual(report.excluded_profiles, [{ username: "failed_brand", reason: "Public data unavailable" }]);
});
