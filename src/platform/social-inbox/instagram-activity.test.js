import assert from "node:assert/strict";
import test from "node:test";
import { instagramCommentText, instagramItemsFromActivity } from "./instagram-activity.js";

// Trimmed to the fields used, in the shape Instagram's activity data arrives.
const story = (notif, { username = "ahhahajahahsha2026", text, destination, shortcode = "DgPM_Wzsehi", timestamp = 1795767089.1779 } = {}) => ({
  __typename: "XDTActivityFeedStory", notif_name: notif,
  args: { timestamp, destination, media: shortcode ? { shortcode } : null, text, users: username ? [{ username }] : null, profile_name: username },
});

test("comments and mentions become inbox items; likes and notices don't", () => {
  const items = instagramItemsFromActivity({ data: { xdt_activity_inbox: {
    new_stories: [story("mentioned_comment", { username: "asha", text: "asha mentioned you in a comment: @tinitiate.ai is great", destination: "comments_v2?media_id=1&target_comment_id=17922663480459999" })],
    old_stories: [
      story("comment", { text: "ahhahajahahsha2026 commented: i want a referal please help e out 👏", destination: "comments_v2?media_id=4039504521149409378&target_comment_id=17922663480459753&permalink_enabled=True" }),
      story("comment_like", { text: "someone liked your comment: hi", destination: "comments_v2?media_id=1&target_comment_id=17922663480450000" }),
      story("qp_ig_nf_generic", { username: null, text: "Reminder: Review our Terms and Privacy Policy", destination: "webview?x=1", shortcode: null }),
    ],
  } } });
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, "mention");
  assert.equal(items[0].body, "@tinitiate.ai is great");
  assert.deepEqual(items[1], {
    platform: "instagram", kind: "comment", externalId: "ig:c:17922663480459753", authorName: "ahhahajahahsha2026",
    authorUrl: "https://www.instagram.com/ahhahajahahsha2026/", body: "i want a referal please help e out 👏", contextText: "Comment on your post",
    permalink: "https://www.instagram.com/p/DgPM_Wzsehi/c/17922663480459753/", receivedAt: "2026-11-27T08:11:29.177Z",
  });
  assert.deepEqual(instagramItemsFromActivity({}), []);
});

test("the comment's own words are kept", () => {
  assert.equal(instagramCommentText("asha commented: nice: really", "asha"), "nice: really");
  assert.equal(instagramCommentText("asha replied to your comment: thanks", "asha"), "thanks");
});
