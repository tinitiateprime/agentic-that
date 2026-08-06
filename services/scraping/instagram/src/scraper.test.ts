import assert from "node:assert/strict";
import test from "node:test";
import {
  currentReelViewsFromPayload,
  mergeCandidateData,
  reconcileVisibleReelView,
  resolvePublicPostCounts,
  viewDisplayMatchesExactCount
} from "./scraper.ts";

test("extracts exact current reel counts from nested public GraphQL payloads", () => {
  const views = currentReelViewsFromPayload({
    data: {
      node: {
        edges: [
          { node: { code: "CurrentReel1", play_count: 14_967_100 } },
          { node: { shortcode: "CurrentReel2", video_view_count: 24_492_436 } }
        ]
      }
    }
  });

  assert.equal(views.get("CurrentReel1"), 14_967_100);
  assert.equal(views.get("CurrentReel2"), 24_492_436);
});

test("uses the largest explicit counter without converting compact display text", () => {
  const views = currentReelViewsFromPayload({
    code: "CurrentReel3",
    play_count: 14_967_100,
    video_view_count: 14_900_000,
    display_text: "14.9M"
  });

  assert.equal(views.get("CurrentReel3"), 14_967_100);
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
  assert.equal(viewDisplayMatchesExactCount("18.8M", 18_845_321), true);
  assert.deepEqual(reconcileVisibleReelView("18.8M", 18_800_000, 18_845_321), {
    views: 18_845_321,
    views_display: "18,845,321",
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
    likes_hidden: true,
    comments_count: 6,
    comments_hidden: false
  });
});
