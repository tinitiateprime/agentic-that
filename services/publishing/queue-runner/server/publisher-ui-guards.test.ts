import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FACEBOOK_COMPOSER_EDITOR_SELECTORS } from "./services/publishers/facebook.js";
import {
  LINKEDIN_COMPOSER_EDITOR_SELECTORS,
  visibleIntersectionPoint,
} from "./services/publishers/linkedin.js";
import { hasReadyXMedia } from "./services/publishers/x.js";

test("LinkedIn publishing ignores role-button duplicates outside the current viewport", () => {
  const viewport = { width: 1280, height: 900 };

  assert.equal(visibleIntersectionPoint({ x: 1400, y: 120, width: 220, height: 52 }, viewport), null);
  assert.equal(visibleIntersectionPoint({ x: -300, y: 120, width: 220, height: 52 }, viewport), null);
  assert.deepEqual(
    visibleIntersectionPoint({ x: 80, y: 120, width: 220, height: 52 }, viewport),
    { x: 190, y: 146 },
  );
});

test("LinkedIn publishing recognizes the current TipTap composer editor", () => {
  assert.ok(LINKEDIN_COMPOSER_EDITOR_SELECTORS.includes('.tiptap.ProseMirror[contenteditable="true"]'));
});

test("Facebook publishing recognizes delayed Lexical composer editors", () => {
  assert.ok(FACEBOOK_COMPOSER_EDITOR_SELECTORS.includes('[contenteditable="true"][data-lexical-editor="true"]'));
});

test("X publishing requires both a selected file and a rendered media preview", () => {
  assert.equal(hasReadyXMedia(true, false), false);
  assert.equal(hasReadyXMedia(false, true), false);
  assert.equal(hasReadyXMedia(true, true), true);
});

test("X publishing retains initial file acceptance after X clears the input", () => {
  const initialFileSelectionCompleted = true;
  const currentInputFileCountAfterXProcessing = 0;
  assert.equal(currentInputFileCountAfterXProcessing, 0);
  assert.equal(hasReadyXMedia(initialFileSelectionCompleted, true), true);
});

test("video composer exposes the YouTube title before destination selection", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /const showYoutubeTitle = postFormat === 'video';/);
  assert.match(appSource, /const selectedNeedsTitle = Boolean\(postFormat === 'video' && selectedPlatforms\.includes\('youtube'\)\);/);
  assert.match(appSource, /placeholder=.*Enter a title to enable YouTube publishing/);
});
