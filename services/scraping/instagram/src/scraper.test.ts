import assert from "node:assert/strict";
import test from "node:test";
import { currentReelViewsFromPayload } from "./scraper.ts";

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
