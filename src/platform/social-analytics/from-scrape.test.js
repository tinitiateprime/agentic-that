import assert from "node:assert/strict";
import test from "node:test";
import { checkProfileLink, matchKeys, normalizeLink, postsFromScrape } from "./from-scrape.js";

const shared = (left, right) => left.some((key) => right.includes(key));

test("Instagram scrape results become posts with only the numbers the page showed", () => {
  const posts = postsFromScrape("instagram", { run: { results: [
    { username: "tinitiate", post_url: "https://www.instagram.com/p/Dd_62zuzXOE/", caption: "Launch day", timestamp: "2026-10-02T16:33:07.000Z", likes: 120, likes_hidden: false, comments_count: 8, comments_hidden: false, views: null },
    { username: "tinitiate", post_url: "https://www.instagram.com/reel/Abc123/", caption: "", timestamp: null, likes: null, likes_hidden: true, comments_count: 3, views: 5400 },
    { username: "tinitiate", post_url: "https://www.instagram.com/p/Dd_62zuzXOE/", likes: 1 },
    { post_url: "https://www.instagram.com/tinitiate/" },
  ] } });
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], {
    postKey: "https://www.instagram.com/p/Dd_62zuzXOE/", account: "tinitiate", permalink: "https://www.instagram.com/p/Dd_62zuzXOE/",
    text: "Launch day", type: "Post", publishedAt: "2026-10-02T16:33:07.000Z", metrics: { likes: 120, comments: 8 },
  });
  assert.equal(posts[1].type, "Reel");
  assert.deepEqual(posts[1].metrics, { comments: 3, views: 5400 }, "hidden likes are not 0");
});

test("Facebook scrape results map reactions to likes", () => {
  const [post] = postsFromScrape("facebook", { results: [
    { post_id: "1234567890", post_url: "https://www.facebook.com/tinitiate/posts/1234567890", author_name: "Tinitiate", content: "Hello", media_type: "video", timestamp: "2026-11-01T10:00:00Z", reactions_count: 40, comments_count: 2, views_count: 900 },
  ] });
  assert.equal(post.postKey, "1234567890");
  assert.equal(post.type, "Video");
  assert.deepEqual(post.metrics, { likes: 40, comments: 2, views: 900 });
});

test("a scraped post is recognised as the same post as the exported one", () => {
  // Meta's export keys Instagram posts by media id; the link has the shortcode.
  const exported = matchKeys("instagram", "17912345678901234", "https://www.instagram.com/reel/Dd_62zuzXOE/?igsh=abc");
  const scraped = matchKeys("instagram", "https://www.instagram.com/p/Dd_62zuzXOE/", "https://www.instagram.com/p/Dd_62zuzXOE/");
  assert.ok(shared(exported, scraped));
  assert.ok(!shared(exported, matchKeys("instagram", "x", "https://www.instagram.com/p/Other1/")));

  const fbExport = matchKeys("facebook", "100200300_1234567890", "");
  const fbScrape = matchKeys("facebook", "1234567890", "https://m.facebook.com/tinitiate/posts/1234567890/");
  assert.ok(shared(fbExport, fbScrape));
  assert.ok(shared(matchKeys("facebook", "", "https://www.facebook.com/permalink.php?story_fbid=pfbid0abc&id=1"), matchKeys("facebook", "", "https://facebook.com/permalink.php?id=1&story_fbid=pfbid0abc")));
});

test("links are compared without tracking bits", () => {
  assert.equal(normalizeLink("https://www.instagram.com/p/abc/?igsh=x#y"), "instagram.com/p/abc");
  assert.equal(normalizeLink("not a link"), "");
});

test("profile links are checked and tidied", () => {
  assert.deepEqual(checkProfileLink("instagram", "@tinitiate"), { url: "https://www.instagram.com/tinitiate/" });
  assert.deepEqual(checkProfileLink("instagram", "instagram.com/tinitiate?igsh=1"), { url: "https://www.instagram.com/tinitiate/" });
  assert.match(checkProfileLink("instagram", "https://www.instagram.com/p/abc/").error, /profile link/);
  assert.deepEqual(checkProfileLink("facebook", "https://m.facebook.com/tinitiate/?ref=1"), { url: "https://www.facebook.com/tinitiate" });
  assert.deepEqual(checkProfileLink("facebook", "https://www.facebook.com/profile.php?id=61550000000000"), { url: "https://www.facebook.com/profile.php?id=61550000000000" });
  assert.match(checkProfileLink("facebook", "https://www.facebook.com/groups/abc").error, /Page link/);
});
