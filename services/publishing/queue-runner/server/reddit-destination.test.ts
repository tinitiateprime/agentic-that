import assert from "node:assert/strict";
import test from "node:test";
import { isValidRedditDestination, normalizeSubreddit, redditDestinationLabel, requireRedditOptions, resolveRedditDestination } from "../shared/reddit-options.js";
import { redditOptionsSchema } from "../shared/schema.js";
import { redditSubmitUrl } from "./services/publishers/reddit.js";

test("profile destinations survive intake, schema validation, and submit URL construction", () => {
  for (const input of ["u/Creative-Alarm-3814", "/u/Creative-Alarm-3814/", "r/u_Creative-Alarm-3814", "u_Creative-Alarm-3814"]) {
    const options = requireRedditOptions("reddit", { reddit: { subreddit: input, title: "Profile post" } })!.reddit;
    assert.equal(options.subreddit, "u_Creative-Alarm-3814");
    assert.equal(redditOptionsSchema.parse({ subreddit: input, title: "Profile post" }).subreddit, options.subreddit);
    assert.equal(redditSubmitUrl(options.subreddit, "text"), "https://www.reddit.com/r/u_Creative-Alarm-3814/submit/?type=TEXT");
    assert.equal(redditSubmitUrl(input, "media"), "https://www.reddit.com/r/u_Creative-Alarm-3814/submit/?type=IMAGE");
    assert.equal(redditDestinationLabel(options.subreddit), "u/Creative-Alarm-3814");
  }
});

test("My profile resolves per executing account and fails closed without a username", () => {
  assert.equal(normalizeSubreddit(" /u/me/ "), "u/me");
  assert.equal(redditOptionsSchema.parse({ subreddit: "u/me", title: "Profile post" }).subreddit, "u/me");
  assert.equal(redditDestinationLabel("u/me"), "My profile");
  assert.equal(resolveRedditDestination("u/me", "Creative-Alarm-3814"), "u_Creative-Alarm-3814");
  assert.equal(resolveRedditDestination("u/me", "Other_Account"), "u_Other_Account");
  assert.throws(() => resolveRedditDestination("u/me"), /identify/);
  assert.throws(() => redditSubmitUrl("u/me", "text"), /identify/);
  assert.throws(() => resolveRedditDestination("u/Creative-Alarm-3814", "Other_Account"), /own profile/);
  assert.equal(resolveRedditDestination("u/creative-alarm-3814", "Creative-Alarm-3814"), "u_creative-alarm-3814");
});

test("community validation stays strict while profiles accept hyphens and a 20 character username", () => {
  for (const input of ["marketing", "r/marketing", "u/" + "a".repeat(20)]) assert.equal(isValidRedditDestination(input), true, input);
  for (const input of ["", "a", "bad-name", "a".repeat(22), "u/ab", "u/" + "a".repeat(21), "u/bad name", "u/foo?bar", "https://reddit.com/u/foo", "u/foo/submit"]) {
    assert.equal(isValidRedditDestination(input), false, input);
    assert.equal(redditOptionsSchema.safeParse({ subreddit: input, title: "Title" }).success, false, input);
  }
  assert.equal(resolveRedditDestination("r/marketing", "Someone"), "marketing");
  assert.equal(redditDestinationLabel("marketing"), "r/marketing");
});
