import assert from "node:assert/strict";
import test from "node:test";
import { buildInsights } from "./insights.js";

const post = (overrides) => ({ platformLabel: "Instagram", type: "", text: "", engagement: 10, engagementRate: 2, ...overrides });

test("says nothing when there are no posts", () => {
  assert.deepEqual(buildInsights({ posts: [], totals: { posts: 0, engagement: 0 } }), []);
});

test("reports the trend against the period before and fewer posts", () => {
  const posts = [post({}), post({})];
  const insights = buildInsights({ posts, totals: { posts: 2, engagement: 50 }, previous: { posts: 6, engagement: 100 } });
  assert.match(insights.find((entry) => entry.id === "trend").text, /down 50%/);
  assert.match(insights.find((entry) => entry.id === "frequency").text, /4 times fewer/);
});

test("ignores small changes", () => {
  const insights = buildInsights({ posts: [post({})], totals: { posts: 1, engagement: 105 }, previous: { posts: 1, engagement: 100 } });
  assert.equal(insights.find((entry) => entry.id === "trend"), undefined);
});

test("compares post types only when each has enough posts and the gap is real", () => {
  const posts = [post({ type: "Reel", engagementRate: 6 }), post({ type: "Reel", engagementRate: 6 }), post({ type: "Photo", engagementRate: 2 }), post({ type: "Photo", engagementRate: 2 }), post({ type: "Story", engagementRate: 1 })];
  const type = buildInsights({ posts, totals: { posts: 5, engagement: 50 } }).find((entry) => entry.id === "type");
  assert.match(type.text, /^Reel posts get 3× the engagement rate of Photo posts/);

  const close = [post({ type: "Reel", engagementRate: 2.2 }), post({ type: "Reel", engagementRate: 2.2 }), post({ type: "Photo", engagementRate: 2 }), post({ type: "Photo", engagementRate: 2 })];
  assert.equal(buildInsights({ posts: close, totals: { posts: 4, engagement: 40 } }).find((entry) => entry.id === "type"), undefined);
});

test("names a standout post and the best time", () => {
  const posts = [post({ text: "Launch day!", engagement: 100 }), post({ engagement: 5 }), post({ engagement: 5 })];
  const insights = buildInsights({ posts, totals: { posts: 3, engagement: 110 }, bestSlots: [{ weekday: "Tuesday", daypart: "Evening", averageRate: 4.2 }] });
  assert.match(insights.find((entry) => entry.id === "standout").text, /^"Launch day!" got 2.7× your average/);
  assert.match(insights.find((entry) => entry.id === "time").text, /Tuesday evening/);
});

test("does not recommend a time nobody engaged with", () => {
  const posts = [post({ engagementRate: 0 }), post({ engagementRate: 0 })];
  const insights = buildInsights({ posts, totals: { posts: 2, engagement: 20 }, bestSlots: [{ weekday: "Tuesday", daypart: "Night", averageRate: 0 }] });
  assert.equal(insights.find((entry) => entry.id === "time"), undefined);
});

test("explains an export with no engagement at all", () => {
  const insights = buildInsights({ posts: [post({ engagement: 0 })], totals: { posts: 1, engagement: 0 } });
  assert.deepEqual(insights.map((entry) => entry.id), ["no-engagement"]);
});
