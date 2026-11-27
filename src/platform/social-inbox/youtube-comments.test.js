import assert from "node:assert/strict";
import test from "node:test";
import { relativeTime, studioCommentsUrl, youtubeCommentsFromStudio } from "./youtube-comments.js";

// Trimmed to the fields used, in the shape YouTube Studio's get_comments returns.
const thread = ({ id, author, message, ago, own = false, video = "SQL basics", videoId = "abc123" }) => ({
  commentThreadRenderer: { comment: { commentRenderer: {
    commentId: id,
    authorText: { simpleText: author },
    authorEndpoint: { urlEndpoint: { url: `http://www.youtube.com/${author}` } },
    contentText: { runs: [{ text: message }] },
    publishedTimeText: { simpleText: ago },
    authorIsChannelOwner: own,
    videoThumbnail: { commentVideoThumbnailRenderer: {
      title: { simpleText: video },
      viewCommentButton: { buttonRenderer: { navigationEndpoint: { urlEndpoint: { url: `https://www.youtube.com/watch?v=${videoId}&lc=${id}` } } } },
    } },
  } } },
});

test("Studio comments become inbox items; the channel's own comments are skipped", () => {
  const now = Date.parse("2026-11-27T10:00:00Z");
  const body = { contents: { itemSectionRenderer: { contents: [
    thread({ id: "UgzA", author: "@asha", message: "Is part 2 out?", ago: "2 hours ago" }),
    thread({ id: "UgzB", author: "@tinitiate", message: "Thanks all!", ago: "1 hour ago", own: true }),
    { continuationItemRenderer: {} },
  ] } } };
  const items = youtubeCommentsFromStudio(body, { now });
  assert.deepEqual(items, [{
    platform: "youtube", kind: "comment", externalId: "yt:UgzA", authorName: "@asha", authorUrl: "https://www.youtube.com/@asha",
    body: "Is part 2 out?", contextText: "SQL basics", permalink: "https://www.youtube.com/watch?v=abc123&lc=UgzA",
    receivedAt: "2026-11-27T08:00:00.000Z", ownComment: false,
  }]);
  assert.equal(youtubeCommentsFromStudio(body, { now, includeOwn: true }).length, 2);
  assert.deepEqual(youtubeCommentsFromStudio({}), []);
});

test("relative times and the Studio address", () => {
  const now = Date.parse("2026-11-27T10:00:00Z");
  assert.equal(relativeTime("23 seconds ago", now), "2026-11-27T09:59:37.000Z");
  assert.equal(relativeTime("3 days ago (edited)", now), "2026-11-24T10:00:00.000Z");
  assert.equal(relativeTime("yesterday", now), null);
  const url = new URL(studioCommentsUrl("UC123"));
  assert.equal(url.pathname, "/channel/UC123/comments/inbox");
  assert.deepEqual(JSON.parse(url.searchParams.get("filter")).map((filter) => filter.name), ["SORT_BY", "ENGAGED_STATUS"]);
});
