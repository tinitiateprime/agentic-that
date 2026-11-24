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

test("X length is counted the way X counts it: emoji 2, links 23", async () => {
  const { xLength } = await import("./post-text.js");
  assert.equal(xLength("Hello"), 5);
  assert.equal(xLength("Hi 🚀"), 5, "an emoji counts 2");
  assert.equal(xLength("See https://example.com/a/very/long/path/that/goes/on?and=on"), 4 + 23, "a link counts 23");
  assert.equal(xLength("नमस्ते"), 6, "Devanagari counts 1 per character, like Latin");
  assert.equal(xLength("你好"), 4, "Chinese counts 2 per character");
});

test("AI text over X's 280 drops hashtags first, then is shortened at a sentence", async () => {
  const { postTextFor, xLength } = await import("./post-text.js");
  const post = "Our new data science batch starts Monday with live projects, mentors and placement support for every learner.";
  const tags = ["#DataScience", "#Python", "#MachineLearning", "#Careers", "#Hyderabad", "#LearnToCode", "#AI", "#Tech", "#Jobs", "#Upskill", "#Students", "#Training", "#Bootcamp", "#Analytics", "#BigData", "#Coding", "#CareerGrowth", "#OnlineLearning", "#Mentorship", "#Projects"];
  const fitted = postTextFor("x", { post, hashtags: tags }, "image");
  assert.ok(xLength(fitted.text) <= 280, `fits: ${xLength(fitted.text)}`);
  assert.ok(fitted.text.startsWith(post), "the post itself is kept whole");
  assert.ok(fitted.text.includes("#DataScience"), "the first hashtags are kept");
  assert.match(fitted.note, /hashtags? removed to fit X's 280/);

  const long = `${"We teach real projects. ".repeat(14)}Join the batch today and build a portfolio that gets you hired faster than ever before`;
  const short = postTextFor("x", { post: long, hashtags: ["#AI"] }, "image");
  assert.ok(xLength(short.text) <= 280, `fits: ${xLength(short.text)}`);
  assert.match(short.text, /projects\.$/, "cut at the end of a full sentence");
  assert.match(short.note, /Shortened to fit X's 280/);
});

test("text within the limit is unchanged and has no note", async () => {
  const { postTextFor } = await import("./post-text.js");
  const result = postTextFor("x", { post: "Batch 5 is open", hashtags: ["#AI"] }, "image");
  assert.deepEqual(result, { text: "Batch 5 is open\n\n#AI" });
  const instagram = postTextFor("instagram", { caption: "x".repeat(2300), hashtags: ["#a"] }, "image");
  assert.ok(instagram.text.length <= 2200);
  assert.ok(instagram.note);
  assert.equal(postTextFor("youtube", { title: "T".repeat(150), description: "D" }, "video").title.length, 100);
});
