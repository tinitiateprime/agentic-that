import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { detectedExternalBrowserExecutablePath } from "./engines/external-browser/index.js";
import { isRedditComposerDestination, openRedditComposer, postToReddit, submitAndConfirm } from "./services/publishers/reddit.js";
import type { PlatformUpload } from "../shared/schema.js";

const executablePath = detectedExternalBrowserExecutablePath();
const username = "Creative-Alarm-3814";

async function fixture(page: Page, destination: string, wrongSelection = false, activeUsername = username) {
  const label = destination.startsWith("u_") ? `u/${destination.slice(2)}` : `r/${destination}`;
  const submitPath = destination.startsWith("u_") ? `/user/${destination.slice(2)}/submit/` : `/r/${destination}/submit/`;
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname.startsWith("reddit-uploaded-media")) return route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, body: "uploaded" });
    if (url.hostname !== "www.reddit.com") return route.abort();
    if (url.pathname === "/api/me.json") return route.fulfill({ json: { data: { name: activeUsername } } });
    if (url.pathname === "/comments/abc123.json") return route.fulfill({ json: [{ data: { children: [{ data: {} }] } }, { data: { children: [] } }] });
    return route.fulfill({ contentType: "text/html", body: `<!doctype html>
      <input placeholder="Search Reddit" aria-label="Search Reddit">
      <a href="/submit" onclick="record('create')">Create</a>
      ${url.pathname === "/submit" ? `
        <button onclick="record('picker');document.querySelector('dialog').showModal()">Select Community</button>
        <dialog aria-label="Choose community"><h2>Choose community</h2>
          <input placeholder="Search" onfocus="record('search-focused')" oninput="searchProfiles(this)">
          <div id="results" hidden>
            <button onclick="record('wrong');location.href='/r/wrong/submit/'">${label}-other</button>
            <button onclick="selectDestination()">${label}</button>
          </div>
        </dialog>` : url.pathname.endsWith("/submit/") ? `
        <button>${label}</button><textarea name="title" oninput="record('title')"></textarea>
        <shreddit-composer><div contenteditable="true" role="textbox" aria-label="Body" oninput="record('body');setTimeout(enablePost,900)"></div></shreddit-composer>
        <post-composer-standalone-toolbar>
          <button onclick="document.querySelector('#media').click()">Image</button>
          <button onclick="document.querySelector('#media').click()">Video</button>
          <input id="media" type="file" hidden onchange="uploadMedia()">
        </post-composer-standalone-toolbar>
        <button id="inner-post-submit-button" disabled aria-disabled="true" onclick="submitPost()">Post</button>` : ""}
      <script>
        function record(step) { const steps=JSON.parse(sessionStorage.getItem('steps') || '[]');steps.push(step);sessionStorage.setItem('steps',JSON.stringify(steps)); }
        function searchProfiles(input) {
          record('search:' + input.value);
          if (document.activeElement === input && input.value === ${JSON.stringify(destination.startsWith("u_") ? "u/" : label)}) {
            setTimeout(() => document.querySelector('#results').hidden=false,100);
          }
        }
        function enablePost() { record('enabled'); const button=document.querySelector('#inner-post-submit-button');button.disabled=false;button.setAttribute('aria-disabled','false'); }
        function selectDestination() { record('select:' + ${JSON.stringify(label)});location.href=${JSON.stringify(wrongSelection ? "/r/wrong/submit/" : submitPath)}; }
        async function uploadMedia() {
          record('attach');
          await fetch('https://reddit-uploaded-media.s3-accelerate.amazonaws.com/', {method:'POST',body:'fixture media'});
          record('uploaded');
        }
        function submitPost() {
          sessionStorage.setItem('content',JSON.stringify({title:document.querySelector('[name=title]').value,body:document.querySelector('[contenteditable]').textContent,files:document.querySelector('#media').files.length}));
          record('post');location.href='/user/${activeUsername}/comments/abc123/fixture/';
        }
      </script>` });
  });
}

test("composer verification accepts only the intended Reddit submit destination", () => {
  assert.equal(isRedditComposerDestination(`https://www.reddit.com/user/${username}/submit/`, `u_${username}`), true);
  assert.equal(isRedditComposerDestination(`https://www.reddit.com/r/u_${username}/submit/`, `u_${username}`), true);
  for (const url of [`https://www.reddit.com/user/${username}-other/submit/`, "https://www.reddit.com/r/test/submit/", `https://reddit.com.evil.test/user/${username}/submit/`, `https://www.reddit.com/user/${username}/`]) {
    assert.equal(isRedditComposerDestination(url, `u_${username}`), false, url);
  }
});

test("Create and Select Community choose the exact community through the picker", { skip: !executablePath }, async context => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  await fixture(page, "marketing");
  await page.goto("https://www.reddit.com/");
  await openRedditComposer(page, "marketing");
  assert.equal(page.url(), "https://www.reddit.com/r/marketing/submit/");
  const steps: string[] = await page.evaluate(() => JSON.parse(sessionStorage.getItem("steps")!));
  assert.deepEqual(steps.filter(step => !step.startsWith("search:")), ["create", "picker", "search-focused", "select:r/marketing"]);
  assert.ok(steps.includes("search:r/marketing"));
});

test("Reddit never clicks or marks submitted while Post remains disabled", { skip: !executablePath }, async context => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  context.after(() => browser.close());
  for (const disabledAttribute of ['disabled', 'aria-disabled="true"']) {
    const page = await browser.newPage();
    await page.setContent(`<button id="inner-post-submit-button" ${disabledAttribute} onclick="window.clicked=true">Post</button>`);
    let submissions = 0;
    await assert.rejects(submitAndConfirm(page, "Title", () => { submissions++; }, 50), /stayed disabled/);
    assert.equal(await page.evaluate(() => Boolean((window as any).clicked)), false);
    assert.equal(submissions, 0);
    await page.close();
  }
});

test("a picker opening the wrong destination stops before content entry", { skip: !executablePath }, async context => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  await fixture(page, `u_${username}`, true);
  await page.goto("https://www.reddit.com/");
  await assert.rejects(openRedditComposer(page, `u_${username}`, 1000), /No post was submitted/);
  assert.equal(await page.locator('[name="title"]').inputValue(), "");
});

for (const format of ["text", "image", "video"] as const) {
  test(`profile ${format} publishing selects the profile before content, upload and one Post click`, { skip: !executablePath }, async context => {
    const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
    context.after(() => browser.close());
    const directory = await mkdtemp(path.join(os.tmpdir(), "reddit-composer-"));
    const previousDirectory = process.env.PUBLISH_QUEUE_UPLOAD_DIR;
    const previousRemovalWindow = process.env.REDDIT_REMOVAL_CHECK_MS;
    process.env.PUBLISH_QUEUE_UPLOAD_DIR = directory;
    process.env.REDDIT_REMOVAL_CHECK_MS = "1";
    context.after(async () => {
      if (previousDirectory === undefined) delete process.env.PUBLISH_QUEUE_UPLOAD_DIR; else process.env.PUBLISH_QUEUE_UPLOAD_DIR = previousDirectory;
      if (previousRemovalWindow === undefined) delete process.env.REDDIT_REMOVAL_CHECK_MS; else process.env.REDDIT_REMOVAL_CHECK_MS = previousRemovalWindow;
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected fixture directory");
      await rm(directory, { recursive: true, force: true });
    });
    const fileName = format === "text" ? "" : `fixture.${format === "image" ? "png" : "mp4"}`;
    if (fileName) await writeFile(path.join(directory, fileName), "fixture file");
    const page = await browser.newPage();
    const accountUsername = format === "video" ? "Another-Test-Account" : username;
    await fixture(page, `u_${accountUsername}`, false, accountUsername);
    let submissions = 0;
    await postToReddit(page, {
      postFormat: format, fileName, mimeType: format === "text" ? "text/plain" : format === "image" ? "image/png" : "video/mp4",
      caption: "Exact profile body", platformOptions: { reddit: { subreddit: format === "image" ? `u/${accountUsername}` : "u/me", title: "Exact profile title" } },
    } as PlatformUpload, { onFinalActionSubmitted: () => { submissions++; } });
    const steps: string[] = await page.evaluate(() => JSON.parse(sessionStorage.getItem("steps")!));
    assert.deepEqual(steps.filter(step => !step.startsWith("search:")).slice(0, 4), ["create", "picker", "search-focused", `select:u/${accountUsername}`]);
    assert.deepEqual(steps.filter(step => step.startsWith("search:")), ["search:u", "search:u/"]);
    assert.ok(steps.indexOf("enabled") < steps.indexOf("post"));
    assert.equal(steps.filter(step => step === "post").length, 1);
    if (format !== "text") assert.ok(steps.indexOf("uploaded") < steps.indexOf("post"));
    assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem("content")!)), { title: "Exact profile title", body: "Exact profile body", files: format === "text" ? 0 : 1 });
    assert.equal(submissions, 1);
  });
}
