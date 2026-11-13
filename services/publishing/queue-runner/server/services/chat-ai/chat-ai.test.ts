import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { signServiceAccessToken } from "../../../../../../lib/service-access-token.js";
import { masterPrompt, parseAnswer } from "./master-prompt.js";
import { PROVIDERS, isAiProvider, looksLikeHumanCheck, onAppPage } from "./providers.js";

// Keep the test away from the real Companion profiles.
process.env.PUBLISH_QUEUE_BROWSER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chat-ai-test-"));

const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

test("master prompt: short, no writing rules, the post's details and one marker per part", () => {
  const prompt = masterPrompt({
    platforms: ["instagram", "youtube"], mediaKind: "carousel", imageCount: 3,
    description: "AWS data engineering course", brandName: "Tinitiate AI", location: "Hyderabad", businessDetails: "Live projects, free trial sessions",
  });
  assert.match(prompt, /^Give me the best of the best, 10\/10 social media SEO for this post, for Instagram and YouTube\. You know what to do\./);
  assert.match(prompt, /carousel of 3 images/);
  assert.match(prompt, /About the post: AWS data engineering course/);
  assert.match(prompt, /Brand: Tinitiate AI\nLocation: Hyderabad\nAbout the business: Live projects, free trial sessions/);
  assert.deepEqual(prompt.match(/^=== .+ ===$/gm), ["=== INSTAGRAM CAPTION ===", "=== INSTAGRAM HASHTAGS ===", "=== INSTAGRAM ALT TEXT ===", "=== YOUTUBE TITLE ===", "=== YOUTUBE DESCRIPTION ===", "=== YOUTUBE TAGS ==="]);
  assert.ok(prompt.length < 900, "a master prompt, not a rule book");
  assert.ok(!/About the post|Brand:/.test(masterPrompt({ platforms: ["facebook"], mediaKind: "image", imageCount: 1 })), "empty details are left out");
  assert.match(masterPrompt({ platforms: ["facebook"], mediaKind: "video", imageCount: 5, durationSeconds: 42 }), /video \(0:42 long\); the attached images are frames/);
});

test("answers are split into each app's parts, however the AI formats the markers", () => {
  const answer = [
    "Here is your 10/10 SEO pack!",
    "",
    "**=== INSTAGRAM CAPTION ===**",
    "Master AWS data engineering with AI ☁️",
    "",
    "Build real pipelines.",
    "",
    "### === INSTAGRAM HASHTAGS ===",
    "#AWSDataEngineering #DataEngineering #TinitiateAI #AWSDataEngineering",
    "=== INSTAGRAM ALT TEXT ===",
    "Poster for the Tinitiate AI AWS data engineering course.",
    "---",
    "===YOUTUBE TITLE===",
    "AWS Data Engineering with AI | Tinitiate AI",
    "=== YOUTUBE DESCRIPTION ===",
    "```",
    "Learn AWS data engineering.",
    "```",
    "=== YOUTUBE TAGS ===",
    "aws data engineering, aws glue, #AmazonS3",
    "- data pipelines",
  ].join("\n");
  const { results, complete } = parseAnswer(answer, ["instagram", "youtube"]);
  assert.equal(complete, true);
  assert.equal(results.instagram!.caption, "Master AWS data engineering with AI ☁️\n\nBuild real pipelines.");
  assert.deepEqual(results.instagram!.hashtags, ["#AWSDataEngineering", "#DataEngineering", "#TinitiateAI"], "duplicates removed");
  assert.equal(results.instagram!.altText, "Poster for the Tinitiate AI AWS data engineering course.");
  assert.equal(results.instagram!.fullText, "Master AWS data engineering with AI ☁️\n\nBuild real pipelines.\n\n#AWSDataEngineering #DataEngineering #TinitiateAI");
  assert.equal(results.youtube!.title, "AWS Data Engineering with AI | Tinitiate AI");
  assert.equal(results.youtube!.description, "Learn AWS data engineering.", "code fences removed");
  assert.deepEqual(results.youtube!.tags, ["aws data engineering", "aws glue", "AmazonS3", "data pipelines"]);
});

test("Instagram's 5-hashtag limit: stated as a fact in the prompt and kept in the result", () => {
  assert.match(masterPrompt({ platforms: ["instagram"], mediaKind: "image", imageCount: 1 }), /Instagram now allows at most 5 hashtags per post\./);
  assert.ok(!/5 hashtags/.test(masterPrompt({ platforms: ["linkedin"], mediaKind: "image", imageCount: 1 })), "only for the apps it applies to");
  const twenty = Array.from({ length: 20 }, (_, index) => `#Tag${index + 1}`).join(" ");
  const { results } = parseAnswer(`=== INSTAGRAM CAPTION ===\nHi\n=== INSTAGRAM HASHTAGS ===\n${twenty}\n=== INSTAGRAM ALT TEXT ===\nAlt\n=== LINKEDIN POST ===\nPost\n=== LINKEDIN HASHTAGS ===\n${twenty}`, ["instagram", "linkedin"]);
  assert.deepEqual(results.instagram!.hashtags, ["#Tag1", "#Tag2", "#Tag3", "#Tag4", "#Tag5"], "the AI's strongest five, in its order");
  assert.equal((results.linkedin!.hashtags as string[]).length, 20, "other apps keep what the AI chose");
});

test("Gemini's source chips (post-1.jpg, + 1) never reach the post", () => {
  const answer = "=== FACEBOOK POST ===\nDon't just store data, build data systems! 💡   \npost-1.jpg\n\nJoin our program.   \npost-1.jpg\n+ 1\n\nVisit www.tinitiateai.com\n=== FACEBOOK HASHTAGS ===\n#DataEngineering";
  const { results } = parseAnswer(answer, ["facebook"]);
  assert.equal(results.facebook!.post, "Don't just store data, build data systems! 💡\n\nJoin our program.\n\nVisit www.tinitiateai.com");
});

test("ChatGPT's card headings (an app name on its own line) never reach the post", () => {
  const answer = "Instagram\n=== INSTAGRAM CAPTION ===\nAI that only answers is becoming yesterday's AI.\n=== INSTAGRAM HASHTAGS ===\n#AgenticAI\n=== INSTAGRAM ALT TEXT ===\nInfographic explaining how Agentic AI works.\n\nFacebook\n=== FACEBOOK POST ===\nHow does Agentic AI work? Visit Instagram or Facebook to learn more.\n=== FACEBOOK HASHTAGS ===\n#AgenticAI";
  const { results } = parseAnswer(answer, ["instagram", "facebook"]);
  assert.equal(results.instagram!.altText, "Infographic explaining how Agentic AI works.");
  assert.equal(results.facebook!.post, "How does Agentic AI work? Visit Instagram or Facebook to learn more.", "app names inside sentences stay");
});

test("hashtags written at the end of the caption are not repeated in Copy everything", () => {
  const answer = "=== INSTAGRAM CAPTION ===\nHow does #AgenticAI work?\n\nSave this post. 🚀\n\n#AgenticAI #AIAgents\n#FutureOfAI\n=== INSTAGRAM HASHTAGS ===\n#AgenticAI #AIAgents #FutureOfAI\n=== INSTAGRAM ALT TEXT ===\nAlt";
  const { results } = parseAnswer(answer, ["instagram"]);
  assert.equal(results.instagram!.caption, "How does #AgenticAI work?\n\nSave this post. 🚀", "inline hashtags in sentences stay");
  assert.equal(results.instagram!.fullText, "How does #AgenticAI work?\n\nSave this post. 🚀\n\n#AgenticAI #AIAgents #FutureOfAI");
});

test("a missing part is reported, so the website can show the full answer instead", () => {
  const { results, complete } = parseAnswer("Sure! Here's a caption: Hello world #Hi", ["facebook"]);
  assert.equal(complete, false);
  assert.equal(results.facebook!.post, "");
});

test("sign-in and human-check detection", () => {
  assert.equal(onAppPage(PROVIDERS.chatgpt, "https://chatgpt.com/"), true);
  assert.equal(onAppPage(PROVIDERS.chatgpt, "https://chatgpt.com/auth/login"), false);
  assert.equal(onAppPage(PROVIDERS.claude, "https://claude.ai/login?returnTo=%2Fnew"), false);
  assert.equal(onAppPage(PROVIDERS.claude, "https://claude.ai/new"), true);
  assert.equal(onAppPage(PROVIDERS.gemini, "https://accounts.google.com/signin/v2"), false);
  assert.equal(onAppPage(PROVIDERS.gemini, "https://gemini.google.com/app"), true);
  assert.equal(onAppPage(PROVIDERS.gemini, "not a url"), false);
  assert.equal(looksLikeHumanCheck("Just a moment...", "https://chatgpt.com/"), true);
  assert.equal(looksLikeHumanCheck("ChatGPT", "https://chatgpt.com/", ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x"]), true);
  assert.equal(looksLikeHumanCheck("Google", "https://www.google.com/sorry/index?continue=x"), true);
  assert.equal(looksLikeHumanCheck("ChatGPT", "https://chatgpt.com/c/123"), false);
  assert.equal(isAiProvider("claude"), true);
  assert.equal(isAiProvider("copilot"), false);
});

test("routes: status is open, everything else needs a valid AgenticThat token", async () => {
  const { registerAiRoutes } = await import("./chat-ai-routes.js");
  const app = express();
  registerAiRoutes(app);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api/social-seo/ai`;
  try {
    const status = await (await fetch(`${base}/status`)).json();
    assert.equal(status.ok, true);
    assert.deepEqual(status.providers.map((entry: { id: string; connected: boolean }) => [entry.id, entry.connected]), [["chatgpt", false], ["claude", false], ["gemini", false]]);

    const json = { "Content-Type": "application/json" };
    assert.equal((await fetch(`${base}/connect`, { method: "POST", headers: json, body: JSON.stringify({ provider: "chatgpt" }) })).status, 401);
    assert.equal((await fetch(`${base}/generate`, { method: "POST", headers: { ...json, Authorization: "Bearer forged.token.value" }, body: "{}" })).status, 401);
    const wrongAudience = signServiceAccessToken({ audience: "scraping", subject: "u1", workspaceId: "w1" });
    assert.equal((await fetch(`${base}/disconnect`, { method: "POST", headers: { ...json, Authorization: `Bearer ${wrongAudience}` }, body: JSON.stringify({ provider: "claude" }) })).status, 401);

    const token = signServiceAccessToken({ audience: "social-seo", subject: "u1", workspaceId: "w1" });
    const headers = { ...json, Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${base}/connect`, { method: "POST", headers, body: JSON.stringify({ provider: "copilot" }) })).status, 400);
    assert.equal((await fetch(`${base}/generate`, { method: "POST", headers, body: JSON.stringify({ platforms: ["myspace"], images: [IMAGE], mediaKind: "image" }) })).status, 400);
    assert.equal((await fetch(`${base}/generate`, { method: "POST", headers, body: JSON.stringify({ platforms: ["instagram"], images: ["data:text/html;base64,PHNjcmlwdD4="], mediaKind: "image" }) })).status, 400, "only image data is accepted");
    const none = await fetch(`${base}/generate`, { method: "POST", headers, body: JSON.stringify({ platforms: ["instagram"], images: [IMAGE], mediaKind: "image" }) });
    assert.equal(none.status, 409, "nothing is sent until an AI is connected");
  } finally {
    server.close();
  }
});
