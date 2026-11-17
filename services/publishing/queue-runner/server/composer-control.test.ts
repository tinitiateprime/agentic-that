import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { detectedExternalBrowserExecutablePath } from "./engines/external-browser/index.js";
import { clickCreateButton } from "./services/publishers/instagram.js";
import { clickStartPost } from "./services/publishers/linkedin.js";

const executablePath = detectedExternalBrowserExecutablePath();

test("Instagram opens its composer when Create is outside a compact viewport", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
    await page.setContent(`<style>body{overflow:hidden}a{position:fixed;top:500px}</style>
      <a href="#" role="link" onclick="document.querySelector('#composer').hidden=false">Create</a>
      <section id="composer" hidden>Create new post<input type="file"></section>`);
    await clickCreateButton(page);
    assert.equal(await page.locator('#composer').isVisible(), true);
  } finally { await browser.close(); }
});

test("Instagram falls back to the Create new icon and selects Post from that menu", { skip: !executablePath }, async context => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <a hidden>Create</a>
    <button onclick="window.wrongPost=true">Post</button>
    <div tabindex="0" onclick="if(event.isTrusted){window.createClicks=(window.createClicks||0)+1;document.querySelector('#menu').hidden=false}">
      <svg aria-label="Create new" width="32" height="32"><rect width="32" height="32" /></svg>
    </div>
    <section id="menu" hidden><span>Create new</span>
      <div role="button" tabindex="0" onclick="if(event.isTrusted){window.postClicks=(window.postClicks||0)+1;document.querySelector('#composer').hidden=false}">Post</div>
      <button onclick="window.wrongFormat=true">Reel</button><button onclick="window.wrongFormat=true">Story</button>
    </section>
    <section id="composer" role="dialog" hidden>Create new post<input type="file"></section>`);
  await clickCreateButton(page);
  assert.equal(await page.locator("#composer").isVisible(), true);
  assert.deepEqual(await page.evaluate(() => ({ create: (window as any).createClicks, post: (window as any).postClicks, wrong: Boolean((window as any).wrongPost || (window as any).wrongFormat) })), { create: 1, post: 1, wrong: false });
});

test("Instagram uses an already open Create new menu without clicking the trigger again", { skip: !executablePath }, async context => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <button aria-label="Create new" onclick="window.closedMenu=true;document.querySelector('#menu').hidden=true">Open</button>
    <section id="menu"><span>Create new</span><button onclick="document.querySelector('#composer').hidden=false">Post</button></section>
    <section id="composer" hidden>Create new post<input type="file"></section>`);
  await clickCreateButton(page);
  assert.equal(await page.locator("#composer").isVisible(), true);
  assert.equal(await page.evaluate(() => Boolean((window as any).closedMenu)), false);
});

test("Instagram's usual Create entry still selects Post from its menu", { skip: !executablePath }, async context => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <button onclick="document.querySelector('#menu').hidden=false">Create</button>
    <section id="menu" role="menu" hidden><button role="menuitem" onclick="document.querySelector('#composer').hidden=false">Post</button></section>
    <section id="composer" hidden>Create new post<input type="file"></section>`);
  await clickCreateButton(page);
  assert.equal(await page.locator("#composer").isVisible(), true);
});

test("LinkedIn opens an editor that requires a trusted browser click", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<button onclick="if(event.isTrusted)document.querySelector('#composer').hidden=false">Start a post</button>
      <section id="composer" hidden><div class="tiptap ProseMirror" contenteditable="true"></div></section>`);
    await page.getByRole('button', { name: 'Start a post' }).evaluate((element: HTMLElement) => element.click());
    assert.equal(await page.locator('#composer').isVisible(), false);
    await clickStartPost(page);
    assert.equal(await page.locator('#composer').isVisible(), true);
  } finally { await browser.close(); }
});
