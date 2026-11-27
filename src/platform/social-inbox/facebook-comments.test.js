import assert from "node:assert/strict";
import test from "node:test";
import { facebookDocuments, facebookItemsFromReel, reelIdsFromLinks } from "./facebook-comments.js";

// Trimmed to the fields used, in the shape a reel's comment data arrives.
const comment = (id, { name = "Hello Uhfh", authorId = "61593507754763", text, depth = 0, created = 1795767162 } = {}) => ({
  id: Buffer.from(`comment:${id}`).toString("base64"), legacy_fbid: id, depth, body: { text }, author: { id: authorId, name }, created_time: created,
});
const response = [
  JSON.stringify({ data: { viewer: {} } }),
  JSON.stringify({ data: { reels_feedback_renderer: { story: { feedback: { comment_list_renderer: { feedback: { comment_rendering_instance_for_feed_location: { comments: { edges: [
    { node: { ...comment("1111789158569819", { text: "good informative content, please post more 😀" }), feedback: { parent: { id: "x" } } } },
    { node: comment("1111789158569820", { name: "Tintiate Kaushik", authorId: "61589589437834", text: "Thank you!", depth: 1 }) },
    { node: comment("1111789158569821", { name: "Asha", authorId: "61500000000001", text: "Which course is this?", depth: 1 }) },
  ] } } } } } } } } }),
].join("\n");

test("reel comments become inbox items; the account's own replies are skipped", () => {
  const items = facebookItemsFromReel(facebookDocuments(response), { reelId: "1160929579819299", ownerId: "61589589437834" });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    platform: "facebook", kind: "comment", externalId: "fb:1111789158569819", authorName: "Hello Uhfh", authorUrl: "https://www.facebook.com/61593507754763",
    body: "good informative content, please post more 😀", contextText: "Comment on your reel",
    permalink: "https://www.facebook.com/reel/1160929579819299/?comment_id=1111789158569819", receivedAt: "2026-11-27T08:12:42.000Z",
  });
  assert.equal(items[1].kind, "reply");
  assert.deepEqual(facebookItemsFromReel(facebookDocuments("not json\n{}"), { reelId: "1" }), []);
});

test("reel links, newest first, without repeats", () => {
  assert.deepEqual(reelIdsFromLinks(["/reel/?s=tab", "/reel/1160929579819299/?s=x", "/reel/3016761075337169/?s=x", "/reel/1160929579819299/"], 6), ["1160929579819299", "3016761075337169"]);
  assert.deepEqual(reelIdsFromLinks(["/reel/111111/", "/reel/222222/", "/reel/333333/"], 2), ["111111", "222222"]);
});
