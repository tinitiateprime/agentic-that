import assert from "node:assert/strict";
import test from "node:test";
import { postTextFor } from "./post-text.js";

test("each app gets its own ready-to-post text from the AI's answer", () => {
  assert.equal(postTextFor("instagram", { caption: "New batch starts Monday.", hashtags: ["#data", "#python"] }, "image").text, "New batch starts Monday.\n\n#data #python");
  assert.equal(postTextFor("x", { post: "Batch 5 is open", hashtags: ["#AI"] }, "image").text, "Batch 5 is open\n\n#AI");
  assert.equal(postTextFor("linkedin", { post: "We're hiring" }, "image").text, "We're hiring");
  assert.deepEqual(postTextFor("youtube", { title: "Batch 5", description: "Join us" }, "image"), { text: "Join us", title: "" }, "a photo is a Community post: no title");
  assert.equal(postTextFor("youtube", { title: "Batch 5", description: "Join us" }, "video").title, "Batch 5");
  assert.deepEqual(postTextFor("reddit", { title: "Free class", post: "Details inside", subreddits: ["r/learnpython", "r/datascience"] }, "image"), { text: "Details inside", title: "Free class", subreddit: "u/me" });
  assert.equal(postTextFor("facebook", null, "image"), null);
});
