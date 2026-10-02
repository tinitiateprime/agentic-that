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
