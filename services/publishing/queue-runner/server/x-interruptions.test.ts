import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { detectedExternalBrowserExecutablePath } from "./engines/external-browser/index.js";
import { clickXPostWhenReady, dismissXInterruptions, observeXPostAcceptance, waitForXMediaReady, xAcceptedPostId } from "./services/publishers/x.js";

const executablePath = detectedExternalBrowserExecutablePath();

test("X requires a created post ID rather than treating an HTTP 200 error as success", () => {
  const accepted = { data: { create_tweet: { tweet_results: { result: { rest_id: "2106261496376508582" } } } } };
  assert.equal(xAcceptedPostId(accepted), "2106261496376508582");
  assert.equal(xAcceptedPostId({ ...accepted, errors: [{ code: 187 }] }), null);
  assert.equal(xAcceptedPostId({ data: { create_tweet: {} } }), null);
  assert.equal(xAcceptedPostId(null), null);
});

test("X observes provider acceptance before a notice replaces the composer", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://x.com/**', route => route.fulfill(route.request().url().includes('/CreateTweet')
      ? { contentType: 'application/json', body: JSON.stringify({ data: { create_tweet: { tweet_results: { result: { rest_id: '2106261496376508582' } } } } }) }
      : { contentType: 'text/html', body: '<section role="dialog"><div data-testid="tweetTextarea_0">Post</div></section>' }));
    await page.goto('https://x.com/home');
    const acceptance = observeXPostAcceptance(page);
    try {
      await page.evaluate(async () => {
        await (await fetch('/i/api/graphql/test/CreateTweet', { method: 'POST' })).json();
        document.body.innerHTML = '<section role="dialog"><button>Got it</button></section>';
      });
      for (let attempt = 0; attempt < 20 && !acceptance.evidence.postId; attempt++) await page.waitForTimeout(50);
      assert.equal(acceptance.evidence.postId, '2106261496376508582');
      assert.equal(await page.locator('[data-testid="tweetTextarea_0"]').count(), 0);
    } finally { acceptance.dispose(); }
  } finally { await browser.close(); }
});

test("X closes stacked terms and Premium prompts before clicking the actual Post button", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>
      .overlay{position:fixed;inset:0;background:white;z-index:10}
      #terms{z-index:20}
    </style>
    <section role="dialog" id="composer">
      <div role="textbox" contenteditable="true" data-testid="tweetTextarea_0">Test post</div>
      <div data-testid="attachments">Ready</div>
      <button aria-label="Close" onclick="window.composerClosed=true">Close</button>
      <button data-testid="tweetButton" onclick="window.posted=event.isTrusted">Post</button>
    </section>
    <section role="dialog" id="premium" class="overlay">
      <h1>Don't lose 50% off your first 2 months of Premium</h1>
      <button aria-label="Close" onclick="this.parentElement.remove()">×</button>
    </section>
    <section role="dialog" id="terms" class="overlay">
      <h1>Updates to our Terms of Service</h1>
      <button onclick="this.parentElement.remove()">Got it</button>
    </section>`);
    let submitted = 0;
    await clickXPostWhenReady(page, true, () => { submitted += 1; });
    assert.equal(await page.locator('#terms, #premium').count(), 0);
    assert.equal(await page.locator('#composer').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => ({ posted: (window as any).posted, composerClosed: Boolean((window as any).composerClosed) })), { posted: true, composerClosed: false });
    assert.equal(submitted, 1);
  } finally { await browser.close(); }
});

test("X leaves the composer and sign-in dialogs open when no interruption is present", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<section role="dialog">
      <div contenteditable="true" data-testid="tweetTextarea_0">Premium product announcement</div>
      <button aria-label="Close" onclick="this.parentElement.remove()">Close</button>
    </section><section role="dialog">Sign in to Premium
      <input type="password"><button aria-label="Close" onclick="this.parentElement.remove()">Close</button>
    </section>`);
    await dismissXInterruptions(page);
    assert.equal(await page.getByRole('dialog').count(), 2);
  } finally { await browser.close(); }
});

test("X waits through video uploading and processing despite an enabled Post button and visible preview", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<section role="dialog">
      <div contenteditable="true" data-testid="tweetTextarea_0">Video post</div>
      <div data-testid="attachments">Uploading (57%)</div>
      <button data-testid="tweetButton" onclick="window.stateAtPost=document.querySelector('[data-testid=attachments]').textContent">Post</button>
    </section><div role="progressbar" aria-valuenow="0"></div>`);
    let settled = false;
    const ready = waitForXMediaReady(page, page.getByRole('dialog')).then(() => { settled = true; });
    await page.waitForTimeout(1000);
    assert.equal(settled, false);
    await page.locator('[data-testid="attachments"]').evaluate(element => { element.textContent = 'Processing'; });
    const submit = clickXPostWhenReady(page, true);
    await page.waitForTimeout(1000);
    assert.equal(settled, false);
    assert.equal(await page.evaluate(() => (window as any).stateAtPost), undefined);
    await page.locator('[data-testid="attachments"]').evaluate(element => { element.textContent = 'Ready'; });
    await Promise.all([ready, submit]);
    assert.equal(await page.evaluate(() => (window as any).stateAtPost), 'Ready');
  } finally { await browser.close(); }
});
