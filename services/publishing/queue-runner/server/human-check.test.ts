import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Page } from "playwright-core";
import { detectedExternalBrowserExecutablePath } from "./engines/external-browser/index.js";
import { createHumanCheckGuard, HUMAN_CHECK_TEXT, humanCheckOnPage, isHumanCheckUrl } from "./services/publishers/human-check.js";
import { uploadPartsInPipeline, type UploadPart } from "../src/lib/part-upload-pipeline.js";

const executablePath = detectedExternalBrowserExecutablePath();

async function withPage(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  try { await run(await browser.newPage()); } finally { await browser.close(); }
}

test("verification pages and wording are recognised, ordinary posts are not", () => {
  for (const url of ["https://www.facebook.com/checkpoint/1501092823525282/", "https://www.instagram.com/challenge/AbC/", "https://www.linkedin.com/checkpoint/challenge/x", "https://x.com/account/access", "https://accounts.google.com/v3/signin/challenge/pwd"]) assert.equal(isHumanCheckUrl(url), true, url);
  for (const url of ["https://www.instagram.com/", "https://www.linkedin.com/feed/", "https://studio.youtube.com/channel/UC1/videos/upload", "https://x.com/home"]) assert.equal(isHumanCheckUrl(url), false, url);
  for (const text of ["Confirm you're human", "Verify it's you", "Let's do a quick security check", "Enter the confirmation code", "Two-factor authentication", "Prove your humanity"]) assert.match(text, HUMAN_CHECK_TEXT, text);
  for (const text of ["Start a post", "Python Lists Explained", "Verify your data before you publish a report", "Create new post"]) assert.doesNotMatch(text, HUMAN_CHECK_TEXT, text);
});

test("a real challenge is seen, but the small reCAPTCHA badge and post text are ignored", { skip: !executablePath }, async () => {
  await withPage(async page => {
    await page.setContent('<iframe src="about:blank#recaptcha" title="reCAPTCHA badge" style="width:256px;height:60px"></iframe><p>Please verify you are human in this caption text</p>');
    assert.equal(await humanCheckOnPage(page), null);
    await page.setContent('<iframe title="captcha challenge" style="width:400px;height:300px"></iframe>');
    assert.equal(await humanCheckOnPage(page), "CAPTCHA");
    await page.setContent("<h2>Confirm you're human</h2>");
    assert.equal(await humanCheckOnPage(page), "Confirm you're human");
  });
});

test("the window is shown for a verification, and posting resumes once the person finishes", { skip: !executablePath }, async () => {
  await withPage(async page => {
    await page.setContent("<h1>Verify it's you</h1>");
    const events: string[] = [];
    const notices: Array<string | null> = [];
    const guard = createHumanCheckGuard({
      page,
      app: "Instagram",
      onNotice: (notice) => notices.push(notice),
      session: {
        update: async (activity) => { events.push(String(activity.state)); },
        showForHuman: async () => { events.push("shown"); },
        hideAfterHuman: async () => { events.push("hidden"); },
      },
    });
    setTimeout(() => { void page.setContent("<h1>Home</h1>"); }, 700);
    assert.equal(await guard.settle(20_000), "cleared");
    guard.stop();
    assert.deepEqual(events, ["needs_you", "shown", "hidden", "publishing"]);
    assert.match(String(notices[0]), /^Needs you: complete the Instagram verification/);
    assert.equal(notices.at(-1), null);
  });
});

test("nothing waits when no verification is showing, and an unfinished one times out", { skip: !executablePath }, async () => {
  await withPage(async page => {
    const session = { update: async () => undefined };
    await page.setContent("<h1>Home</h1>");
    const quiet = createHumanCheckGuard({ page, app: "X", session });
    assert.equal(await quiet.settle(5_000), "none");
    quiet.stop();
    await page.setContent("<h1>Are you a robot?</h1>");
    const stuck = createHumanCheckGuard({ page, app: "X", session });
    assert.equal(await stuck.settle(1_500), "timed_out");
    stuck.stop();
  });
});

test("pieces keep uploading while earlier ones are confirmed, within the server's window", async () => {
  const chunkSize = 100;
  const parts: UploadPart[] = Array.from({ length: 30 }, (_, index) => ({ index, offset: index * chunkSize, byteSize: chunkSize }));
  let confirmed = 0;
  let uploadingDuringConfirm = 0;
  let confirmingNow = false;
  let active = 0;
  let mostAtOnce = 0;
  const confirmedBatches: number[][] = [];
  let lastProgress = 0;
  const offset = await uploadPartsInPipeline<string>({
    parts,
    startOffset: 0,
    chunkSize,
    concurrency: 6,
    authorize: async (batch) => {
      assert.ok(batch.length <= 8);
      assert.ok(batch.at(-1)!.offset < confirmed + 8 * chunkSize, "never asks past the server's limit");
      await new Promise((resolve) => setTimeout(resolve, 2));
      return batch.map((part) => `signed-${part.index}`);
    },
    upload: async (part, signed, onLoaded) => {
      assert.equal(signed, `signed-${part.index}`);
      active += 1;
      mostAtOnce = Math.max(mostAtOnce, active);
      if (confirmingNow) uploadingDuringConfirm += 1;
      await new Promise((resolve) => setTimeout(resolve, 4));
      onLoaded(part.byteSize);
      active -= 1;
    },
    confirm: async (batch) => {
      assert.equal(batch[0].offset, confirmed, "confirmed in order, with no gap");
      confirmingNow = true;
      confirmedBatches.push(batch.map((part) => part.index));
      await new Promise((resolve) => setTimeout(resolve, 12));
      confirmingNow = false;
      confirmed = batch.at(-1)!.offset + chunkSize;
      return confirmed;
    },
    onProgress: (bytes) => { lastProgress = bytes; },
  });
  assert.equal(offset, 3000);
  assert.equal(lastProgress, 3000);
  assert.deepEqual(confirmedBatches.flat(), parts.map((part) => part.index));
  assert.ok(mostAtOnce > 1 && mostAtOnce <= 6, `ran ${mostAtOnce} at once`);
  assert.ok(uploadingDuringConfirm > 0, "uploads carried on during a confirmation");
});

test("a failed piece stops the upload with its own error", async () => {
  const parts: UploadPart[] = Array.from({ length: 12 }, (_, index) => ({ index, offset: index * 10, byteSize: 10 }));
  await assert.rejects(uploadPartsInPipeline<string>({
    parts,
    startOffset: 0,
    chunkSize: 10,
    authorize: async (batch) => batch.map(() => "signed"),
    upload: async (part) => { if (part.index === 3) throw new Error("network dropped"); },
    confirm: async (batch) => batch.at(-1)!.offset + 10,
  }), /network dropped/);
});
