import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { detectedExternalBrowserExecutablePath } from "../../engines/external-browser/index.js";
import { thumbnails } from "./chat-ai.js";

const executablePath = detectedExternalBrowserExecutablePath();
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("an attached picture is seen however the app shows it", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  try {
    const page = await browser.newPage();

    // An empty composer with only the user's avatar: nothing attached.
    await page.setContent(`<img class="avatar" src="${PIXEL}" style="width:32px;height:32px"><form><div contenteditable="true">Hello</div></form>`);
    assert.equal(await thumbnails(page), 0, "an avatar is not an attachment");

    // ChatGPT (2026-11): a tile painted with the picture as its background.
    await page.setContent(`<form><div class="tile" style="width:120px;height:120px;background-image:url('${PIXEL}')"></div><div contenteditable="true">Hello</div></form>`);
    assert.equal(await thumbnails(page), 1, "a background-image tile counts");

    // A remove button beside the attachment.
    await page.setContent(`<form><div><span>photo.jpg</span><button aria-label="Remove file">x</button></div></form>`);
    assert.equal(await thumbnails(page), 1, "a 'Remove file' button counts");

    // A plain <img> thumbnail (Claude, Gemini), with its remove button: one picture, counted once.
    await page.setContent(`<form><img alt="photo" src="${PIXEL}" style="width:80px;height:80px"><button aria-label="Remove image">x</button></form>`);
    assert.equal(await thumbnails(page), 1, "one picture shown two ways still counts as one");

    // Three attached copies are three.
    await page.setContent(`<form>${[1, 2, 3].map(() => `<div style="width:100px;height:100px;background-image:url('${PIXEL}')"></div>`).join("")}</form>`);
    assert.equal(await thumbnails(page), 3);
  } finally {
    await browser.close();
  }
});
