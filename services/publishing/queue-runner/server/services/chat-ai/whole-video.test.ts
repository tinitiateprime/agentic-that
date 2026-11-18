import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import express from "express";
import { chromium, type Page } from "playwright-core";
import { signServiceAccessToken } from "../../../../../../lib/service-access-token.js";
import { detectedExternalBrowserExecutablePath } from "../../engines/external-browser/index.js";
import { AiLimitError, attachVideo, VideoNotAcceptedError, waitForVideoUpload } from "./chat-ai.js";
import { cannotWatchVideo, masterPrompt, parseAnswer, splitPrompt } from "./master-prompt.js";
import { PROVIDERS, videoRefusalNotice, type ProviderSpec } from "./providers.js";
import { removeStagedVideo, stagedVideo, stagedVideoExtension, stageVideo } from "./staged-video.js";

process.env.PUBLISH_QUEUE_BROWSER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "whole-video-test-"));

const executablePath = detectedExternalBrowserExecutablePath();
const spec: ProviderSpec = { ...PROVIDERS.claude, fileInput: ["input[type='file']"], attachButtons: [], attachMenuItems: [], send: ["#send"] };
const videoFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "whole-video-file-")), "post-video.mp4");
fs.writeFileSync(videoFile, "not really a video");

async function withApp(script: string, run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main id="chat">Ask anything</main><input type="file"><button id="send" disabled>Send</button><script>const input = document.querySelector("input"); const chat = document.querySelector("#chat"); const send = document.querySelector("#send"); input.addEventListener("change", () => { ${script} });</script>`);
    await run(page);
  } finally {
    await browser.close();
  }
}

test("an app's refusal is recognised, and text already on the page is not", () => {
  for (const text of ["This file is too large to upload.", "Video exceeds the 5 minute limit", "Unable to upload this video", "Upload failed", "Videos longer than 5 minutes aren't available on your plan"]) assert.ok(videoRefusalNotice(text), text);
  assert.equal(videoRefusalNotice("Your video is too long for free accounts.", "Your video is too long for free accounts."), null);
  assert.equal(videoRefusalNotice("Upload files\nAdd photos\npost-video\nAsk anything"), null);
});

test("an AI that took the file but can't watch it is caught, and normal posts are not", () => {
  assert.equal(cannotWatchVideo("CANNOT_WATCH_VIDEO"), true);
  assert.equal(cannotWatchVideo("I can't watch the video you attached, but here are some ideas."), true);
  assert.equal(cannotWatchVideo("I'm unable to directly view video files."), true);
  assert.equal(cannotWatchVideo("=== YOUTUBE TITLE ===\nPython Lists Explained\nWatch this video and stop being confused!"), false);
  assert.equal(cannotWatchVideo(`${"Great post. ".repeat(60)} I can't watch the video.`), false, "only the opening counts");
});

test("the prompt offers the video itself and keeps the sections for apps asked plainly first", () => {
  const prompt = masterPrompt({ platforms: ["youtube"], mediaKind: "video", imageCount: 0, durationSeconds: 896, videoAttached: true });
  assert.match(prompt, /video \(14:56 long\), attached to this message/);
  assert.match(prompt, /reply with only CANNOT_WATCH_VIDEO/);
  assert.match(prompt, /real times in the video/);
  assert.match(splitPrompt(prompt)!.ask, /CANNOT_WATCH_VIDEO/);
  const answer = "=== YOUTUBE TITLE ===\nLists\n=== YOUTUBE DESCRIPTION ===\nIntro\n0:00 Start\n1:00 Lists\n2:00 Loops\n=== YOUTUBE TAGS ===\npython";
  assert.match(String(parseAnswer(answer, ["youtube"], { realTimes: true, durationSeconds: 896 }).results.youtube?.description), /1:00 Lists/);
});

test("the video is saved privately once, and removed afterwards", async () => {
  assert.equal(stagedVideoExtension("video/mp4; codecs=avc1"), "mp4");
  assert.equal(stagedVideoExtension("text/html"), null);
  const first = await stageVideo(Readable.from([Buffer.from("first")]), "mp4");
  const second = await stageVideo(Readable.from([Buffer.from("second!")]), "webm");
  assert.equal(fs.existsSync(first.file), false, "an unused earlier video is deleted");
  assert.equal(stagedVideo(first.id), null);
  assert.equal(stagedVideo(second.id)?.sizeBytes, 7);
  assert.equal(path.basename(second.file), "post-video.webm");
  await removeStagedVideo(second.id);
  assert.equal(fs.existsSync(second.file), false);
});

test("routes: a video needs a token and a video type, and a missing one falls back", async () => {
  const { registerAiRoutes } = await import("./chat-ai-routes.js");
  const app = express();
  registerAiRoutes(app);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/social-seo/ai`;
  const Authorization = `Bearer ${signServiceAccessToken({ audience: "social-seo", subject: "u1", workspaceId: "w1" })}`;
  try {
    assert.equal((await fetch(`${base}/video`, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: "video" })).status, 401);
    assert.equal((await fetch(`${base}/video`, { method: "POST", headers: { "Content-Type": "text/html", Authorization }, body: "video" })).status, 413);
    const saved = await fetch(`${base}/video`, { method: "POST", headers: { "Content-Type": "video/mp4", Authorization }, body: "video" });
    const { videoId } = await saved.json() as { videoId: string };
    assert.ok(stagedVideo(videoId));
    await removeStagedVideo(videoId);
    const json = { "Content-Type": "application/json", Authorization };
    assert.equal((await fetch(`${base}/generate`, { method: "POST", headers: json, body: JSON.stringify({ platforms: ["x"], images: [], mediaKind: "video" }) })).status, 400, "a post needs a photo or a video");
  } finally {
    server.close();
  }
});

test("a video the app accepts is sent only after its upload finishes", { skip: !executablePath }, async () => {
  await withApp(`chat.textContent = "post-video.mp4"; setTimeout(() => { send.disabled = false; }, 1500);`, async (page) => {
    const attachment = await attachVideo(page, spec, videoFile);
    assert.equal(await page.locator("#send").isDisabled(), true);
    await waitForVideoUpload(page, spec, attachment, 1000);
    assert.equal(await page.locator("#send").isEnabled(), true);
  });
});

test("an app that says its uploads are used up is recognised while attaching the video", { skip: !executablePath }, async () => {
  await withApp(`chat.textContent = "Get Plus for more uploads. Or wait 20 hours to upload again";`, async (page) => {
    await assert.rejects(attachVideo(page, spec, videoFile), (error: Error) => error instanceof AiLimitError && /20 hours/.test(error.message));
  });
});

test("a video the app refuses, ignores or removes moves on to speech and pictures", { skip: !executablePath }, async () => {
  await withApp(`chat.textContent = "This file is too large to upload.";`, async (page) => {
    await assert.rejects(attachVideo(page, spec, videoFile), (error: Error) => error instanceof VideoNotAcceptedError && /too large/.test(error.message));
  });
  await withApp("", async (page) => {
    await assert.rejects(attachVideo(page, spec, videoFile, 800), VideoNotAcceptedError);
  });
  await withApp(`chat.textContent = "post-video.mp4"; setTimeout(() => { chat.textContent = "Ask anything"; }, 800);`, async (page) => {
    const attachment = await attachVideo(page, spec, videoFile);
    await assert.rejects(waitForVideoUpload(page, spec, attachment, 1000), /removed the video/);
  });
  await withApp(`chat.textContent = "post-video.mp4";`, async (page) => {
    const attachment = await attachVideo(page, spec, videoFile);
    await assert.rejects(waitForVideoUpload(page, spec, attachment, 1000, undefined, 1500), /in time/);
  });
});
