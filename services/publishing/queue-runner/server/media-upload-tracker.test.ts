import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { detectedExternalBrowserExecutablePath } from "./engines/external-browser/index.js";
import { isFacebookMediaUpload, isYouTubeMediaUpload, mediaUploadState, mediaUploadTimeoutMs, trackMediaUpload, waitForMediaUploadFinished } from "./services/publishers/media-upload-tracker.js";
import { isPlatformRefusal, PlatformRefusedError } from "./services/publishing-errors.js";
import { xRefusalMessage } from "./services/publishers/x.js";

const executablePath = detectedExternalBrowserExecutablePath();
const snapshot = (values: Partial<ReturnType<ReturnType<typeof trackMediaUpload>["snapshot"]>>) => ({ started: 1, inFlight: 0, failed: 0, lastActivityAt: 1000, lastRequestFailed: false, ...values });

test("only the apps' own upload hosts count as a video transfer", () => {
  assert.equal(isYouTubeMediaUpload("POST", "https://upload.youtube.com/upload/studio?upload_id=1"), true);
  assert.equal(isYouTubeMediaUpload("GET", "https://upload.youtube.com/upload/studio"), false);
  assert.equal(isYouTubeMediaUpload("POST", "https://studio.youtube.com/youtubei/v1/upload/createvideo"), false);
  assert.equal(isFacebookMediaUpload("POST", "https://vupload-edge.facebook.com/ajax/video/upload/requests/receive/"), true);
  assert.equal(isFacebookMediaUpload("POST", "https://rupload.facebook.com/fb_video/abc"), true);
  assert.equal(isFacebookMediaUpload("POST", "https://www.facebook.com/api/graphql/"), false);
});

test("a transfer is finished only after a quiet moment with nothing in flight", () => {
  assert.equal(mediaUploadState(snapshot({ inFlight: 1 }), 99_000, 10_000), "sending");
  assert.equal(mediaUploadState(snapshot({ started: 0, lastActivityAt: 0 }), 99_000, 10_000), "not_seen");
  assert.equal(mediaUploadState(snapshot({}), 5_000, 10_000), "settling");
  assert.equal(mediaUploadState(snapshot({}), 11_000, 10_000), "finished");
  assert.equal(mediaUploadState(snapshot({ failed: 1, lastRequestFailed: true }), 11_000, 10_000), "failed");
  assert.equal(mediaUploadTimeoutMs(1024), 15 * 60_000);
});

test("the browser stays open until the last chunk of a video has been sent", { skip: !executablePath }, async context => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  let finishedChunks = 0;
  await page.route("https://upload.youtube.com/**", async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    finishedChunks += 1;
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "ok" });
  });
  await page.route("https://app.example/", route => route.fulfill({ contentType: "text/html", body: "<title>app</title>" }));
  await page.goto("https://app.example/");
  const transfer = trackMediaUpload(page, isYouTubeMediaUpload);
  await page.evaluate(async () => {
    void (async () => {
      for (let chunk = 0; chunk < 3; chunk += 1) await fetch("https://upload.youtube.com/upload/studio", { method: "POST", body: "chunk" });
    })();
  });
  await waitForMediaUploadFinished(page, transfer, { app: "YouTube", sizeBytes: 1024, quietMs: 1200 });
  transfer.dispose();
  assert.equal(finishedChunks, 3);
});

test("a clear refusal is told apart from an unknown result and from account limits", () => {
  assert.equal(isPlatformRefusal(new PlatformRefusedError("too long")), true);
  assert.equal(isPlatformRefusal(new Error("timeout")), false);
  assert.equal(xRefusalMessage({ errors: [{ message: "Authorization: Your media is too long." }] }), "Your media is too long.");
  assert.equal(xRefusalMessage({ errors: [{ message: "Rate limit exceeded" }] }), null);
  assert.equal(xRefusalMessage({ data: {} }), null);
});
