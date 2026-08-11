import assert from "node:assert/strict";
import test from "node:test";
import { handleFacebookRequest, prepareFacebookScrapeInput } from "./api.ts";
import {
  buildFacebookProfileAnalysis,
  classifyFacebookAccess,
  facebookPageTimelinePluginUrl,
  facebookProfileTabUrl,
  facebookUrlType,
  facebookPayloadCandidates,
  facebookNavigationHeaders,
  facebookPostIdentity,
  facebookVisibleTimestamp,
  normalizeFacebookQuery,
  parseFacebookCommentsText,
  parseFacebookCount,
  parseFacebookReelViewLabel,
  type FacebookPost,
} from "./scraper.ts";

function post(overrides: Partial<FacebookPost> = {}): FacebookPost {
  return {
    post_id: "1",
    post_url: "https://www.facebook.com/example/posts/1",
    author_name: "Example",
    author_url: "https://www.facebook.com/example",
    profile_type: "page",
    content: "A useful #Launch update about automation",
    media_type: "image",
    thumbnail_url: null,
    timestamp: new Date().toISOString(),
    reactions_count: 120,
    reactions_display: "120",
    reactions_exact: true,
    comments_count: 12,
    comments_display: "12",
    comments_exact: true,
    top_comments: [],
    views_count: null,
    views_display: null,
    views_exact: false,
    follower_count: 1_000,
    follower_count_display: "1K",
    follower_count_exact: false,
    engagement_score: 132,
    metric_source: "current_page_payload",
    captured_at: new Date().toISOString(),
    ...overrides,
  };
}

test("normalizes Facebook Page, public profile, keyword, and post inputs", () => {
  const page = normalizeFacebookQuery({ query: "@AgenticThat", inputMode: "profile", profileType: "page" });
  assert.equal(page.mode, "profile");
  assert.equal(page.startUrl, "https://www.facebook.com/AgenticThat/");
  assert.equal(page.profileType, "page");

  const profile = normalizeFacebookQuery({ query: "https://m.facebook.com/profile.php?id=123", inputMode: "profile_url", profileType: "public_profile" });
  assert.equal(profile.startUrl, "https://www.facebook.com/profile.php?id=123");
  assert.equal(profile.profileType, "public_profile");

  const keyword = normalizeFacebookQuery({ query: "launch news", inputMode: "keyword" });
  assert.equal(keyword.startUrl, "https://www.facebook.com/hashtag/launchnews");
  assert.equal(keyword.fallbackStartUrl, "https://www.facebook.com/search/posts/?q=launch%20news");
  assert.equal(keyword.label, "launch news");

  const hashtag = normalizeFacebookQuery({ query: "#launch", inputMode: "keyword" });
  assert.equal(hashtag.startUrl, "https://www.facebook.com/hashtag/launch");
  assert.equal(hashtag.fallbackStartUrl, undefined);

  const direct = normalizeFacebookQuery({ query: "https://facebook.com/example/posts/42?__cft__=tracking", inputMode: "post_url" });
  assert.equal(direct.mode, "post");
  assert.doesNotMatch(direct.startUrl, /__cft__/);

  const linkedProfile = normalizeFacebookQuery({
    query: "https://www.facebook.com/peaktylerr?__cft__[0]=tracking&__tn__=-]C%2CP-R",
    inputMode: "profile_url",
    profileType: "public_profile",
  });
  assert.equal(linkedProfile.startUrl, "https://www.facebook.com/peaktylerr");
  assert.equal(linkedProfile.targetProfileUrl, "https://www.facebook.com/peaktylerr");
});

test("recognizes supported Facebook URL families", () => {
  assert.equal(facebookUrlType("https://facebook.com/example"), "profile");
  assert.equal(facebookUrlType("https://facebook.com/example/posts/1"), "post");
  assert.equal(facebookUrlType("https://facebook.com/reel/1"), "post");
  assert.equal(facebookUrlType("https://facebook.com/share/r/example"), "post");
  assert.equal(facebookUrlType("https://fb.watch/example"), "post");
  assert.equal(facebookUrlType("https://facebook.com/groups/405375007916372"), null);
  assert.equal(facebookUrlType("https://facebook.com/events/123"), null);
  assert.equal(facebookUrlType("https://example.com/example/posts/1"), null);
});

test("does not force cache-bypass headers that make Facebook return an empty profile document", () => {
  assert.deepEqual(facebookNavigationHeaders(), { "Accept-Language": "en-US,en;q=0.9" });
  assert.equal("Cache-Control" in facebookNavigationHeaders(), false);
  assert.equal("Pragma" in facebookNavigationHeaders(), false);
});

test("uses the canonical URL as identity when Facebook emits conflicting internal IDs", () => {
  assert.equal(
    facebookPostIdentity(post({ post_id: "first" })),
    facebookPostIdentity(post({ post_id: "second" })),
  );
});

test("builds explicit All and Reels profile tab URLs", () => {
  assert.equal(facebookProfileTabUrl("https://facebook.com/AgenticThat/reels/", "all"), "https://www.facebook.com/AgenticThat/");
  assert.equal(facebookProfileTabUrl("https://facebook.com/AgenticThat/", "reels"), "https://www.facebook.com/AgenticThat/reels/");
  assert.equal(facebookProfileTabUrl("https://facebook.com/profile.php?id=123", "reels"), "https://www.facebook.com/profile.php?id=123&sk=reels");
});

test("builds an anonymous official Page timeline URL without losing numeric profile IDs", () => {
  const named = new URL(facebookPageTimelinePluginUrl("https://facebook.com/RBRRealtors")!);
  assert.equal(named.pathname, "/plugins/page.php");
  assert.equal(named.searchParams.get("href"), "https://www.facebook.com/RBRRealtors");
  assert.equal(named.searchParams.get("tabs"), "timeline");

  const numeric = new URL(facebookPageTimelinePluginUrl("https://facebook.com/profile.php?id=61581379487938")!);
  assert.equal(numeric.searchParams.get("href"), "https://www.facebook.com/profile.php?id=61581379487938");
});

test("normalizes relative visible timestamps against the current run", () => {
  assert.equal(facebookVisibleTimestamp("19h", "2026-08-11T12:00:00.000Z"), "2026-08-10T17:00:00.000Z");
  assert.equal(facebookVisibleTimestamp("2 days", "2026-08-11T12:00:00.000Z"), "2026-08-09T12:00:00.000Z");
  assert.equal(facebookVisibleTimestamp("not a date", "2026-08-11T12:00:00.000Z"), null);
});

test("parses compact public Facebook metrics without manufacturing missing numbers", () => {
  assert.equal(parseFacebookCount("1.2K reactions"), 1_200);
  assert.equal(parseFacebookCount("3.4M views"), 3_400_000);
  assert.equal(parseFacebookCount("987 comments"), 987);
  assert.equal(parseFacebookCount("Comments"), null);
});

test("parses only visible Reels-grid view labels and records compact precision", () => {
  assert.deepEqual(parseFacebookReelViewLabel("35K views"), { count: 35_000, display: "35K", exact: false });
  assert.deepEqual(parseFacebookReelViewLabel("31M"), { count: 31_000_000, display: "31M", exact: false });
  assert.deepEqual(parseFacebookReelViewLabel("987 views"), { count: 987, display: "987", exact: true });
  assert.equal(parseFacebookReelViewLabel("Beautiful Reel"), null);
});

test("does not use payload view fields because views come from the Reels grid", () => {
  const ambiguous = facebookPayloadCandidates({
    permalink_url: "https://facebook.com/example/posts/1",
    creation_time: 1_700_000_000,
    message: { text: "Example" },
    view_count: 20,
  });
  assert.equal(ambiguous[0]?.views_count, undefined);
  const video = facebookPayloadCandidates({
    permalink_url: "https://facebook.com/example/videos/2",
    creation_time: 1_700_000_000,
    message: { text: "Video" },
    video: { view_count: 2_400 },
  });
  assert.equal(video[0]?.views_count, undefined);
});

test("extracts visible Facebook comment samples after the comment sort control", () => {
  const comments = parseFacebookCommentsText(`Swiss View's post\nSwitzerland\nMost relevant\nJamil Afghan · 12h\nI love you swiss 🌹❤️\nLike\nReply\nJawhar Parvin\n16h\nGorgeous ❤️❤️\nLike\nReply`, "2026-08-11T12:00:00.000Z");
  assert.deepEqual(comments.map(comment => [comment.author_name, comment.text]), [
    ["Jamil Afghan", "I love you swiss 🌹❤️"],
    ["Jawhar Parvin", "Gorgeous ❤️❤️"],
  ]);
  assert.equal(comments[0]?.timestamp, "2026-08-11T00:00:00.000Z");
});

test("classifies public content before incidental login controls", () => {
  assert.equal(classifyFacebookAccess({ url: "https://facebook.com/example", articleCount: 1, postLinkCount: 0, visibleLoginInputCount: 2, bodyText: "Log in" }), "public_content");
  assert.equal(classifyFacebookAccess({ url: "https://facebook.com/login", articleCount: 0, postLinkCount: 0, visibleLoginInputCount: 1, bodyText: "Log in" }), "login_required");
  assert.equal(classifyFacebookAccess({ url: "https://facebook.com/missing", articleCount: 0, postLinkCount: 0, visibleLoginInputCount: 0, bodyText: "This content isn't available" }), "not_found");
});

test("builds analysis from known metrics and preserves unavailable values", () => {
  const posts = [
    post(),
    post({ post_id: "2", post_url: "https://facebook.com/example/posts/2", reactions_count: null, reactions_display: null, reactions_exact: false }),
  ];
  const reels = [post({ post_id: "2", post_url: "https://facebook.com/reel/2", media_type: "reel", reactions_count: null, reactions_display: null, reactions_exact: false, views_count: 2_000, views_display: "2K", metric_source: "visible_reels_grid" })];
  const analysis = buildFacebookProfileAnalysis(posts, "page", "https://facebook.com/example", "Example", 1_000, "1K", "2026-08-11T12:00:00.000Z", reels);
  assert.equal(analysis.averages.reactions, 120);
  assert.equal(analysis.averages.views, 2_000);
  assert.equal(analysis.analyzed_reels, 1);
  assert.equal(analysis.top_viewed.length, 1);
  assert.equal(analysis.patterns.hashtags[0]?.label, "#launch");
  assert.match(analysis.accuracy.reactions, /1\/2 exact/);
});

test("server and Companion input contracts bound counts and ranges identically", () => {
  const input = prepareFacebookScrapeInput({ mode: "profile", profile_type: "public_profile", query: "example", max_results: 500, collection_mode: "engagement", timezone_offset_minutes: 9999 });
  assert.equal(input.maxResults, 50);
  assert.equal(input.profileType, "public_profile");
  assert.equal(input.timezoneOffsetMinutes, 840);
  assert.equal(prepareFacebookScrapeInput({ mode: "profile", query: "example", comparison_mode: true }).skipComments, true);
  assert.throws(() => prepareFacebookScrapeInput({ mode: "keyword", query: "news", collection_mode: "engagement" }), /Profile analysis/);
});

test("Facebook health endpoint reports public-browser mode with no API token", async () => {
  const response = await handleFacebookRequest(new Request("http://localhost/api/scraping/facebook/health"));
  assert.equal(response.status, 200);
  const data = await response.json() as { scraper?: { mode?: string; apiTokens?: boolean } };
  assert.equal(data.scraper?.mode, "public-browser");
  assert.equal(data.scraper?.apiTokens, false);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
});
