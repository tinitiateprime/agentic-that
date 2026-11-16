import assert from "node:assert/strict";
import test from "node:test";
import { explainRedditProblem, isRedditMediaUploadResponse, redditPostIdFromUrl, redditSubmitUrl, summarizeRemovalNote } from "./services/publishers/reddit.js";

test("a community's automatic removal is explained with its own reason", () => {
  const note = "Hi, Creative-Alarm-3814,\n\nYour post has been automatically removed.\n\nPlease participate around reddit by commenting on other posts before you jump straight to submitting.\n\nYour account should be at least three months old with a decent amount of positive karma from commenting before posting submissions in our community.\n\n*I am a bot, and this action was performed automatically.*";
  const summary = summarizeRemovalNote(note);
  assert.match(summary, /^Your post has been automatically removed\./);
  assert.match(summary, /three months old/);
  assert.doesNotMatch(summary, /I am a bot|Hi,/);
});

test("Reddit posts are confirmed from the post page or the community page Reddit returns to", () => {
  assert.equal(redditPostIdFromUrl("https://www.reddit.com/r/test/comments/1xxmhjn/my_title/"), "1xxmhjn");
  assert.equal(redditPostIdFromUrl("https://www.reddit.com/r/test/?created=t3_1xxmntn&createdPostType=image"), "1xxmntn");
  assert.equal(redditPostIdFromUrl("https://www.reddit.com/r/test/submit/?type=TEXT"), "");
  assert.equal(redditSubmitUrl("r/Marketing/", "text"), "https://www.reddit.com/r/Marketing/submit/?type=TEXT");
});

test("only Reddit's own media bucket answering 2xx counts as a finished upload", () => {
  assert.equal(isRedditMediaUploadResponse("POST", "https://reddit-uploaded-media.s3-accelerate.amazonaws.com/", 201), true);
  assert.equal(isRedditMediaUploadResponse("POST", "https://reddit-uploaded-video.s3-accelerate.amazonaws.com/", 204), true);
  assert.equal(isRedditMediaUploadResponse("POST", "https://reddit-uploaded-media.s3-accelerate.amazonaws.com/", 403), false);
  assert.equal(isRedditMediaUploadResponse("POST", "https://www.reddit.com/svc/shreddit/graphql", 200), false);
});

test("Reddit's refusals are explained in plain words", () => {
  assert.match(explainRedditProblem("Please add flair to your post") || "", /requires a post flair/);
  assert.match(explainRedditProblem("You're doing that too much. Try again in 9 minutes.") || "", /limiting this account/);
  assert.match(explainRedditProblem("Your account is too new to post here") || "", /karma or an older account/);
  assert.equal(explainRedditProblem("Drafts"), null);
});
