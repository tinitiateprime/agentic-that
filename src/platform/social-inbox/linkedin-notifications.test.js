import assert from "node:assert/strict";
import test from "node:test";
import { adminPagesFromLinks, linkedinItemsFromCards, linkedinItemsFromNotifications, linkedinItemsFromPageActivity, linkedinTarget } from "./linkedin-notifications.js";

const CARD = "com.linkedin.voyager.dash.identity.notifications.Card";
const wrap = (url) => `/p1-route/web-view?url=${encodeURIComponent(url)}`;

// Trimmed to the fields used, in the shape LinkedIn's Page Activity returns.
const body = { included: [
  {
    $type: CARD,
    entityUrn: "urn:li:fsd_notificationCard:(COMMENT,urn:li:comment:(activity:7513467465604104193,7513469588395900928))",
    objectUrn: "urn:li:comment:(activity:7513467465604104193,7513469588395900928)",
    headline: { text: "Thanusree Gajendran commented on your company's update" },
    contentPrimaryText: [{ text: "The real shift with Agentic AI is action." }],
    contentSecondaryText: [{ text: "AI THAT DOESN'T JUST ANSWER. IT ACTS." }],
    publishedAt: Date.parse("2026-10-07T05:25:43.507Z"),
    cardAction: { actionTarget: wrap("https://www.linkedin.com/feed/update/urn:li:activity:7513467465604104193?dashCommentUrn=x") },
    headerImage: { actionTarget: wrap("https://www.linkedin.com/in/ACoAABnp") },
  },
  {
    $type: CARD,
    entityUrn: "urn:li:fsd_notificationCard:(SHARE_MENTION,urn:li:activity:7529022106349629440)",
    objectUrn: "urn:li:activity:7529022106349629440",
    headline: { text: "Kranthi Kumar A mentioned your company in an update" },
    contentPrimaryText: [{ text: "Starting a new position at Tinitiate Technologies!" }],
    publishedAt: Date.parse("2026-11-20T10:00:00Z"),
    cardAction: { actionTarget: wrap("https://www.linkedin.com/feed/update/urn:li:activity:7529022106349629440") },
  },
  { $type: CARD, entityUrn: "urn:li:fsd_notificationCard:(SOCIAL_ACTIVITY,urn:li:activity:1)", objectUrn: "urn:li:activity:1", headline: { text: "Kranthi Kumar A reacted to your company's update" }, publishedAt: 1 },
  { $type: CARD, entityUrn: "urn:li:fsd_notificationCard:(VISITOR,urn:li:organization:1)", objectUrn: "urn:li:organization:1", headline: { text: "Tinitiate AI Solutions has 3 new visitors" }, publishedAt: 1 },
  { $type: "com.linkedin.voyager.dash.feed.Hashtag" },
] };

test("Page comments and mentions become inbox items; reactions and visitors don't", () => {
  const items = linkedinItemsFromPageActivity(body, { pageName: "Tinitiate Technologies" });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    platform: "linkedin", kind: "comment", externalId: items[0].externalId,
    authorName: "Thanusree Gajendran", authorUrl: "https://www.linkedin.com/in/ACoAABnp", body: "The real shift with Agentic AI is action.",
    contextText: "AI THAT DOESN'T JUST ANSWER. IT ACTS.", permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7513467465604104193?dashCommentUrn=x",
    receivedAt: "2026-10-07T05:25:43.507Z",
  });
  assert.match(items[0].externalId, /^li:urn:li:comment:\(activity:7513467465604104193,7513469588395900928\):[0-9a-f]{16}$/);
  assert.equal(items[1].kind, "mention");
  assert.equal(items[1].authorName, "Kranthi Kumar A");
  assert.equal(items[1].contextText, "Mentions Tinitiate Technologies");
  assert.deepEqual(linkedinItemsFromPageActivity({}), []);
});

test("links and admin Pages", () => {
  assert.equal(linkedinTarget(wrap("https://www.linkedin.com/feed/update/1")), "https://www.linkedin.com/feed/update/1");
  assert.equal(linkedinTarget(wrap("https://evil.example/")), "");
  assert.equal(linkedinTarget("/in/abc"), "https://www.linkedin.com/in/abc");
  assert.deepEqual(adminPagesFromLinks([
    { href: "https://www.linkedin.com/company/117884053/admin/", text: "Tinitiate AI Solutions" },
    { href: "https://www.linkedin.com/company/117884053/admin/notifications/", text: "Activity 0" },
    { href: "https://www.linkedin.com/company/107235202/admin/", text: " Tinitiate Technologies " },
  ]), [{ id: "117884053", name: "Tinitiate AI Solutions" }, { id: "107235202", name: "Tinitiate Technologies" }]);
});

test("a member's own notifications: comments on their posts, not suggestions", () => {
  const items = linkedinItemsFromNotifications({ included: [
    {
      $type: CARD,
      entityUrn: "urn:li:fsd_notificationCard:(COMMENTED_ON_YOUR_UPDATE,urn:li:ugcPost:7528731913767849984)",
      objectUrn: "urn:li:notificationV2:(urn:li:member:1759297225,COMMENTED_ON_YOUR_UPDATE,urn:li:ugcPost:7528731913767849984)",
      headline: { text: "Test Tester commented on your post." },
      contentPrimaryText: [{ text: "it is very easy to understand each and every step of sql topics" }],
      contentSecondaryText: [{ text: "Strong SQL skills start with understanding the data" }],
      publishedAt: Date.parse("2026-11-27T07:25:13.436Z"),
      cardAction: { actionTarget: "/feed/update/urn:li:ugcPost:7528731913767849984" },
    },
    {
      $type: CARD,
      entityUrn: "urn:li:fsd_notificationCard:(CONTENT_YOU_MAYBE_INTERESTED_IN,urn:li:uniqueSuffix:(urn:li:none,KGq))",
      objectUrn: "urn:li:notificationV2:(urn:li:member:1,CONTENT_YOU_MAYBE_INTERESTED_IN,x)",
      headline: { text: "Suggested for you: my freelance status is already clearly mentioned in my CV." },
      contentPrimaryText: [{ text: "anything" }],
      publishedAt: 1,
    },
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].authorName, "Test Tester");
  assert.equal(items[0].contextText, "Strong SQL skills start with understanding the data");
  assert.equal(items[0].permalink, "https://www.linkedin.com/feed/update/urn:li:ugcPost:7528731913767849984");
});

test("cards drawn on the page: the newest comments, with the post's opening cut off", () => {
  const now = Date.parse("2026-11-28T05:00:00Z");
  const items = linkedinItemsFromCards([
    {
      texts: [
        "Ahhaha Jahahsha commented on your post.",
        "Learning data engineering is very important in todays time 🚀 Engineer Your Future with AI",
        "🚀 Engineer Your Future with AI! Ready to build a career in Data Engineering, AI, Machine Learning",
        "1 comment",
        "17h",
      ],
      links: [
        "https://www.linkedin.com/in/ahhaha-jahahsha-aa0675411/",
        "https://www.linkedin.com/feed/update/urn:li:ugcPost:7512021065766944768/?commentUrn=urn%3Ali%3Acomment%3A7532042218363092992&dashCommentUrn=urn%3Ali%3Afsd_comment%3A%287532042218363092992%2Curn%3Ali%3AugcPost%3A7512021065766944768%29",
      ],
    },
    { texts: ["Suggested for you: my status is clearly mentioned in my CV.", "anything"], links: ["https://www.linkedin.com/feed/update/urn:li:activity:1/"] },
    { texts: ["Someone from Greater Hyderabad Area viewed your profile."], links: [] },
  ], { now });
  assert.equal(items.length, 1);
  assert.equal(items[0].authorName, "Ahhaha Jahahsha");
  assert.equal(items[0].body, "Learning data engineering is very important in todays time");
  assert.match(items[0].externalId, /^li:urn:li:comment:7532042218363092992:[0-9a-f]{16}$/);
  assert.equal(items[0].authorUrl, "https://www.linkedin.com/in/ahhaha-jahahsha-aa0675411/");
  assert.equal(items[0].receivedAt, "2026-11-27T12:00:00.000Z");
  assert.match(items[0].contextText, /^🚀 Engineer Your Future with AI!/);
});
