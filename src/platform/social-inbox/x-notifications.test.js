import assert from "node:assert/strict";
import test from "node:test";
import { withoutLeadingMentions, xItemsFromNotifications } from "./x-notifications.js";

// Trimmed to the fields used, in the shape X's NotificationsTimeline returns.
const entry = (element, tweet) => ({ entryId: `notification-${tweet?.rest_id || "x"}`, content: { clientEventInfo: { element }, itemContent: { tweet_results: { result: tweet } } } });
const tweet = (id, { name = "Kaushik", handle = "seernu293", text, replyTo = null, wrapped = false } = {}) => {
  const result = { rest_id: id, core: { user_results: { result: { core: { name, screen_name: handle } } } }, legacy: { full_text: text, created_at: "Fri Nov 27 08:08:25 +0000 2026", in_reply_to_status_id_str: replyTo } };
  return wrapped ? { __typename: "TweetWithVisibilityResults", tweet: result } : result;
};
const body = (entries) => ({ data: { viewer_v2: { user_results: { result: { notification_timeline: { timeline: { instructions: [{ type: "TimelineClearCache" }, { entries: [{ entryId: "cursor-top-1" }, ...entries] }] } } } } } } });

test("replies and mentions become inbox items; likes and follows don't", () => {
  const items = xItemsFromNotifications(body([
    entry("user_replied_to_your_tweet", tweet("2126226624219865091", { text: "@testingka07 thats very useful, Thanks for that🤝", replyTo: "2126" })),
    entry("user_mentioned_you", tweet("2126226624219865092", { name: "Asha", handle: "asha", text: "Loved the talk by @testingka07", wrapped: true })),
    entry("users_liked_your_tweet", tweet("2126226624219865093", { text: "your own post" })),
    entry("user_replied_to_your_tweet", tweet("2126226624219865091", { text: "duplicate" })),
  ]));
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    platform: "x", kind: "reply", externalId: "x:2126226624219865091", authorName: "Kaushik (@seernu293)", authorUrl: "https://x.com/seernu293",
    body: "thats very useful, Thanks for that🤝", contextText: "Reply to your post", permalink: "https://x.com/seernu293/status/2126226624219865091",
    receivedAt: "2026-11-27T08:08:25.000Z",
  });
  assert.equal(items[1].kind, "mention");
  assert.equal(items[1].body, "Loved the talk by @testingka07");
  assert.deepEqual(xItemsFromNotifications({}), []);
});

test("leading @names are dropped only at the start", () => {
  assert.equal(withoutLeadingMentions("@a @b hello @c"), "hello @c");
  assert.equal(withoutLeadingMentions("@onlyname"), "@onlyname");
});
