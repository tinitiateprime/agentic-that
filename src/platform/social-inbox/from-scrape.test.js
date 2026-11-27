import assert from "node:assert/strict";
import test from "node:test";
import { commentsFromScrape, inboxView, instagramHandle, snoozeUntil } from "./from-scrape.js";

test("Instagram comments become inbox items, without the company's own replies", () => {
  const stored = { run: { results: [
    { username: "tinitiate.ai", post_url: "https://www.instagram.com/p/Dfq4WBkpGY5/", caption: "Comment your answer below!", top_comments: [
      { username: "asha_k", text: "Option B for sure", timestamp: "2026-11-13T10:00:00Z" },
      { username: "Tinitiate.AI", text: "Thanks Asha!" },
      { username: "", text: "no author" },
      { username: "asha_k", text: "Option B for sure", timestamp: "2026-11-13T10:00:00Z" },
    ] },
    { username: "tinitiate.ai", post_url: "https://www.instagram.com/reel/Df1ogKYpSOk/", top_comments: [] },
  ] } };
  const items = commentsFromScrape("instagram", stored, { profileUrl: "https://www.instagram.com/tinitiate.ai/" });
  assert.equal(items.length, 1);
  assert.deepEqual({ ...items[0], externalId: items[0].externalId.slice(0, 3) }, {
    platform: "instagram", kind: "comment", externalId: "ig:", authorName: "asha_k", authorUrl: "https://www.instagram.com/asha_k/",
    body: "Option B for sure", contextText: "Comment your answer below!", permalink: "https://www.instagram.com/p/Dfq4WBkpGY5/", receivedAt: "2026-11-13T10:00:00.000Z",
  });
  // The same comment seen again tomorrow gets the same id, so it isn't added twice.
  assert.equal(commentsFromScrape("instagram", stored, { profileUrl: "https://www.instagram.com/tinitiate.ai/" })[0].externalId, items[0].externalId);
});

test("Facebook comments skip the Page's own replies", () => {
  const items = commentsFromScrape("facebook", { results: [
    { author_name: "Tinitiate", post_url: "https://www.facebook.com/tinitiate/posts/1", content: "New batch", top_comments: [
      { author_name: "Ravi", text: "Fees?", timestamp: null, time: "2h" },
      { author_name: "Tinitiate", text: "Sent you a message" },
    ] },
  ] });
  assert.deepEqual(items.map((item) => [item.authorName, item.body, item.receivedAt]), [["Ravi", "Fees?", null]]);
});

test("handles and views", () => {
  assert.equal(instagramHandle("https://www.instagram.com/Tinitiate.AI/"), "tinitiate.ai");
  const now = Date.parse("2026-11-27T06:00:00Z");
  assert.equal(inboxView({ status: "done" }, "u1", now), "done");
  assert.equal(inboxView({ status: "open", snoozedUntil: "2026-11-27T09:00:00Z" }, "u1", now), "snoozed");
  assert.equal(inboxView({ status: "open", snoozedUntil: "2026-11-27T05:00:00Z", assignedTo: "u1" }, "u1", now), "mine");
  assert.equal(inboxView({ status: "open", assignedTo: "u2" }, "u1", now), "open");
});

test("snoozes end at 9 am the company's time", () => {
  const now = new Date("2026-11-27T18:00:00Z"); // 11:30 pm in India
  assert.equal(snoozeUntil("1h", now).toISOString(), "2026-11-27T19:00:00.000Z");
  assert.equal(snoozeUntil("tomorrow", now, -330).toISOString(), "2026-11-28T03:30:00.000Z"); // 9 am IST on the 28th
  assert.equal(snoozeUntil("week", now, -330).toISOString(), "2026-12-04T03:30:00.000Z");
  assert.equal(snoozeUntil("nonsense", now), null);
});
