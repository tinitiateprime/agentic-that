import assert from "node:assert/strict";
import test from "node:test";
import { handleFacebookRequest, prepareFacebookScrapeInput } from "./api.ts";
import {
  buildFacebookProfileAnalysis,
  classifyFacebookAccess,
  facebookDiscoveryPlan,
  facebookRangeCoverage,
  facebookScrapeRange,
  facebookPageTimelinePluginUrl,
  facebookProfileTabUrl,
  facebookUrlType,
  facebookPayloadCandidates,
  facebookCandidatesFromScripts,
  candidateMatchesProfile,
  targetProfileKey,
  facebookMatchesKeyword,
  facebookSearchPostUrls,
  facebookNavigationHeaders,
  facebookPostIdentity,
  facebookPostDetailsFromHtml,
  facebookPostDetailsMapFromHtml,
  facebookPostTimestampsFromHtml,
  facebookVisibleTimestamp,
  normalizeFacebookQuery,
  parseFacebookCount,
  parseFacebookReelViewLabel,
  selectFacebookPrimaryResults,
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
  assert.equal(keyword.startUrl, "https://www.facebook.com/search/posts/?q=launch%20news");
  assert.equal(keyword.fallbackStartUrl, undefined);
  assert.equal(keyword.label, "launch news");

  const hashtag = normalizeFacebookQuery({ query: "#launch", inputMode: "keyword" });
  assert.equal(hashtag.startUrl, "https://www.facebook.com/hashtag/launch");
  assert.equal(hashtag.fallbackStartUrl, "https://www.facebook.com/search/posts/?q=%23launch");

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
  assert.equal(facebookProfileTabUrl("https://facebook.com/profile.php?id=123", "reels"), "https://www.facebook.com/profile.php?id=123&sk=reels_tab");
  assert.equal(facebookProfileTabUrl("https://facebook.com/people/Example/123/", "reels"), "https://www.facebook.com/profile.php?id=123&sk=reels_tab");
});

test("uses a Reels-only discovery path for Most Viewed profiles", () => {
  assert.deepEqual(facebookDiscoveryPlan({ collectionMode: "engagement" }, "profile"), {
    initialTab: "reels",
    collectAll: false,
    collectTimelinePlugin: false,
    collectReels: true,
    reelsArePrimary: true,
  });
  assert.deepEqual(facebookDiscoveryPlan({ collectionMode: "latest" }, "profile"), {
    initialTab: "all",
    collectAll: true,
    collectTimelinePlugin: true,
    collectReels: true,
    reelsArePrimary: false,
  });
});

test("returns visible Reel rankings even without timeline posts or timestamps", () => {
  const reels = [
    post({ post_id: "low", post_url: "https://facebook.com/reel/low", timestamp: null, views_count: 2_000, views_display: "2K", metric_source: "visible_reels_grid" }),
    post({ post_id: "high", post_url: "https://facebook.com/reel/high", timestamp: null, views_count: 35_000, views_display: "35K", metric_source: "visible_reels_grid" }),
    post({ post_id: "missing", post_url: "https://facebook.com/reel/missing", timestamp: null, views_count: null, views_display: null, metric_source: "visible_reels_grid" }),
  ];
  const results = selectFacebookPrimaryResults([], reels, "engagement", "profile", 2);
  assert.deepEqual(results.map(item => item.views_count), [35_000, 2_000]);
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

test("maps exact public Reel publish times to their matching Reel IDs", () => {
  const html = String.raw`{\"post_context\":{\"publish_time\":1786419294,\"story_fbid\":[\"1072164168798057\"]}}`;
  const timestamps = facebookPostTimestampsFromHtml(html);
  assert.equal(timestamps.get("1072164168798057"), "2026-08-11T03:34:54.000Z");
});

test("extracts a Reel's exact date, reactions, and comments from its public page payload", () => {
  const html = '{"post_context":{"publish_time":1785383166,"story_fbid":["848442524868794"]},"unified_reactors":{"count":1544},"feedback":{"total_comment_count":33},"tracking":"{\\"top_level_post_id\\":\\"848442524868794\\"}"}';
  assert.deepEqual(facebookPostDetailsFromHtml(html, "848442524868794"), {
    timestamp: "2026-07-30T03:46:06.000Z",
    reactionsCount: 1544,
    commentsCount: 33,
  });
});

test("correlates exact metrics for every Reel in one public grid payload", () => {
  const html = [
    '{"unified_reactors":{"count":1544},"feedback":{"total_comment_count":33},"post_context":{"publish_time":1785383166,"story_fbid":["848442524868794"]},"tracking":"{\\"top_level_post_id\\":\\"848442524868794\\"}"}',
    '{"likers":{"count":6794},"feedback":{"total_comment_count":174},"post_context":{"publish_time":1741870652,"story_fbid":["1851328741938963"]},"tracking":"{\\"video_id\\":\\"1851328741938963\\"}"}',
  ].join("|");
  const details = facebookPostDetailsMapFromHtml(html, ["848442524868794", "1851328741938963"]);
  assert.deepEqual(details.get("848442524868794"), {
    timestamp: "2026-07-30T03:46:06.000Z",
    reactionsCount: 1544,
    commentsCount: 33,
  });
  assert.deepEqual(details.get("1851328741938963"), {
    timestamp: "2025-03-13T12:57:32.000Z",
    reactionsCount: 6794,
    commentsCount: 174,
  });
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

test("uses exact Facebook range boundaries and detects incomplete history scans", () => {
  const range = facebookScrapeRange({
    query: "example",
    collectionMode: "range",
    rangeType: "month",
    rangeFrom: "2026-02",
    rangeTo: "2026-03",
    timezoneOffsetMinutes: -330,
  });
  assert.equal(new Date(range.start).toISOString(), "2026-01-31T18:30:00.000Z");
  assert.equal(new Date(range.end).toISOString(), "2026-03-31T18:29:59.999Z");

  assert.equal(facebookRangeCoverage([
    "2026-04-02T00:00:00.000Z",
    "2026-03-10T00:00:00.000Z",
  ], range, 2).complete, false);
  assert.equal(facebookRangeCoverage([
    "2026-01-31T18:00:00.000Z",
    "2026-04-02T00:00:00.000Z",
  ], range, 5).reached_range_start, false);
  assert.equal(facebookRangeCoverage([
    "2026-03-10T00:00:00.000Z",
    "2026-01-31T18:15:00.000Z",
    "2026-01-31T18:00:00.000Z",
  ], range, 5).complete, true);
  assert.throws(() => prepareFacebookScrapeInput({
    mode: "profile",
    query: "example",
    collection_mode: "range",
    range_type: "date",
    range_from: "2026-02-30",
    range_to: "2026-03-01",
  }), /valid Facebook post range/);
});

test("Facebook health endpoint reports public-browser mode with no API token", async () => {
  const response = await handleFacebookRequest(new Request("http://localhost/api/scraping/facebook/health"));
  assert.equal(response.status, 200);
  const data = await response.json() as { scraper?: { mode?: string; apiTokens?: boolean } };
  assert.equal(data.scraper?.mode, "public-browser");
  assert.equal(data.scraper?.apiTokens, false);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
});

test("numeric, people, and canonical p URLs identify the same profile without accepting other authors", () => {
  const target = "https://facebook.com/profile.php?id=61575247137390";
  for (const author_url of ["https://facebook.com/61575247137390", "https://facebook.com/people/New-York-Beauty/61575247137390/", "https://facebook.com/p/New-York-Beauty-61575247137390/"]) {
    assert.equal(targetProfileKey(author_url), targetProfileKey(target));
    assert.equal(candidateMatchesProfile({ author_url }, target), true);
  }
  assert.equal(candidateMatchesProfile({ author_url: "https://facebook.com/another" }, target), false);
  assert.equal(candidateMatchesProfile({ author_url: "https://facebook.com/renamed" }, target, ["https://facebook.com/renamed"]), true);
});

test("numeric profile scraping retains the public-index fallback path", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("./scraper.ts", import.meta.url), "utf8"));
  assert.match(source, /public_profile_index/);
  assert.match(source, /site:facebook\.com\/permalink\.php/);
});

test("public embedded JSON joins only matching story, owner, feedback, and video fragments", () => {
  const scripts = [
    JSON.stringify({ story: { id: "story-1", post_id: "111", creation_time: 1788553682, url: "https://facebook.com/reel/42/", actors: [{ id: "123" }], feedback: { id: "feedback-1" } } }),
    JSON.stringify({ story: { id: "story-1", message: { text: "A #cricket video" } }, owner: { id: "123", name: "Creator", url: "https://facebook.com/people/Creator/123/", followers: { count: 150001 } } }),
    JSON.stringify({ feedback: { id: "feedback-1", subscription_target_id: "111", reaction_count: { count: 82 }, total_comment_count: 2 }, video: { __typename: "Video", id: "42", url: "https://facebook.com/reel/42/", publish_time: 1788553682, owner: { id: "123" }, video_view_count: 3210 } }),
    JSON.stringify({ feedback: { id: "feedback-2", subscription_target_id: "222", reaction_count: { count: 999999 }, total_comment_count: 9999 }, video: { __typename: "Video", id: "99", url: "https://facebook.com/reel/99/", publish_time: 1788553682, owner: { id: "456" }, video_view_count: 87654 } }),
    "not JSON",
  ];
  const posts = facebookCandidatesFromScripts(scripts).filter(post => post.post_url === "https://www.facebook.com/reel/42/");
  assert.ok(posts.some(post => post.content === "A #cricket video" && post.reactions_count === 82 && post.comments_count === 2));
  assert.ok(posts.some(post => post.views_count === 3210 && post.views_exact));
  assert.ok(posts.every(post => post.author_name === "Creator" && post.follower_count === 150001));
  assert.ok(posts.every(post => post.reactions_count !== 999999 && post.views_count !== 87654));
});

test("missing and null feedback stays unknown; a measured zero is preserved", () => {
  const [missing] = facebookPayloadCandidates({ url: "https://facebook.com/test/posts/123", creation_time: 1788553682, reaction_count: null, comment_count: null });
  assert.equal(missing.reactions_count, null);
  assert.equal(missing.comments_count, null);
  const [zero] = facebookPayloadCandidates({ url: "https://facebook.com/test/posts/123", creation_time: 1788553682, reaction_count: { count: 0 }, comment_count: 0 });
  assert.equal(zero.reactions_count, 0);
  assert.equal(zero.comments_count, 0);
});

test("search discovery accepts Facebook permalinks, unwraps redirects, and rejects unrelated hosts", () => {
  const urls = facebookSearchPostUrls('<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.facebook.com%2Freel%2F123%2F">Result</a><a href="https://www.facebook.com/test/posts/pfbid123">Post</a><a href="https://evil.test/reel/333/">Bad</a><a href="https://facebook.com/test">Profile</a>');
  assert.deepEqual(urls, ["https://www.facebook.com/reel/123/", "https://www.facebook.com/test/posts/pfbid123"]);
  assert.equal(facebookMatchesKeyword("A #cricket highlight", "#cricket"), true);
  assert.equal(facebookMatchesKeyword("A #cricketnews highlight", "#cricket"), false);
  assert.equal(facebookMatchesKeyword("Latest news from the launch", "launch news"), true);
  assert.equal(facebookMatchesKeyword("Latest #CricketNews", "cricket news"), true);
  assert.equal(facebookMatchesKeyword("Latest launches", "launch"), false);
  assert.equal(facebookMatchesKeyword(null, "news"), false);
  assert.deepEqual(facebookSearchPostUrls('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.facebook.com%2Freel%2F123%2F&amp;rut=tracking">Reel</a>'), ["https://www.facebook.com/reel/123/"]);
});
